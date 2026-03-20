import maplibregl, {type CustomRenderMethodInput, MapMouseEvent, OverscaledTileID} from 'maplibre-gl';
import { applyShadowLitMaterial, decomposeObject, parseUrl, prepareModelForRender, transformModel } from '../model/objModel.ts';
import type { ShadowLitMaterial } from '../shadow/ShadowLitMaterial.ts';
import { clampZoom, getMetersPerExtentUnit, latlonToLocal, tileLocalToLatLon } from '../convert/map_convert.ts';
import { getSharedShadowPass, ShadowMapPass } from "../shadow/ShadowMapPass.ts";
import type {
    Custom3DTileRenderLayer,
    LightGroupOption,
    ModelData,
    PickHit,
    ReflectionCasterLayer,
    ShadowCasterLayer,
    ShadowPair,
    ShadowUserData,
    UserData
} from '../Interface.ts'
import * as THREE from 'three';
import { MaplibreShadowMesh } from "../shadow/ShadowGeometry.ts";
import { BatchedModelSource } from '../source/BatchedModelSource.ts';
import { getSharedRenderer } from "../SharedRenderer.ts";
import { getSharedReflectionPass, ReflectionPass } from '../water/ReflectionPass.ts';

export type ThreeDTileLayerOpts = {
    id: string;
    applyGlobeMatrix: boolean;
    minZoom: number,
    maxZoom: number,
}

export type DataTileInfoForThreeDLayer = {
    sceneTile: THREE.Scene;
    shadowLitMaterials: ShadowLitMaterial[];
    shadowMaterials: ShadowPair[];
}

export class ThreeDTileLayer implements Custom3DTileRenderLayer, ShadowCasterLayer, ReflectionCasterLayer {
    id: string;
    visible: boolean = true;
    onPick?: (info: PickHit) => void;
    onPickfail?: () => void;
    pickEnabled: boolean = true;
    layerSourceCastShadow: Custom3DTileRenderLayer | null = null;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;
    tileSize: number = 512;
    private map: maplibregl.Map | null = null;
    private source: BatchedModelSource | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private camera: THREE.Camera | null = null;
    private minZoom: number;
    private maxZoom: number;
    private raycaster = new THREE.Raycaster();
    private tileCache: Map<string, DataTileInfoForThreeDLayer> = new Map<string, DataTileInfoForThreeDLayer>();
    private applyGlobeMatrix: boolean | false = false;
    private readonly _tmpLightDir = new THREE.Vector3();
    private shadowMapPass: ShadowMapPass | null = null;
    private reflectionPass: ReflectionPass | null = null;
    private _visibleTiles: OverscaledTileID[] = [];
    private _currentZoom = 0;
    useOrchestrator = false;
    constructor(opts: ThreeDTileLayerOpts & { onPick?: (info: PickHit) => void } & { onPickfail?: () => void }) {
        this.id = opts.id;
        this.applyGlobeMatrix = opts.applyGlobeMatrix;
        this.minZoom = opts.minZoom;
        this.maxZoom = opts.maxZoom;
        this.onPick = opts.onPick;
        this.onPickfail = opts.onPickfail;
    }
    setLightOption(option: LightGroupOption) {
        const { directional, hemisphere, ambient } = option;
        for (const [, tile] of this.tileCache) {
            for (const mat of tile.shadowLitMaterials) {
                if (directional) {
                    if (directional.intensity !== undefined)
                        mat.uniforms.diffuseIntensity.value = directional.intensity;
                    if (directional.color !== undefined)
                        mat.setLightColor(new THREE.Color(directional.color));
                }
                if (hemisphere) {
                    if (hemisphere.skyColor !== undefined)
                        mat.setSkyColor(new THREE.Color(hemisphere.skyColor));
                    if (hemisphere.groundColor !== undefined)
                        mat.setGroundColor(new THREE.Color(hemisphere.groundColor));
                    if (hemisphere.intensity !== undefined)
                        mat.setLighting(hemisphere.intensity, mat.uniforms.diffuseIntensity.value);
                }
                if (ambient) {
                    if (ambient.intensity !== undefined)
                        mat.setLighting(ambient.intensity, mat.uniforms.diffuseIntensity.value);
                    if (ambient.color !== undefined)
                        mat.setLightColor(new THREE.Color(ambient.color));
                }
            }
        }
    }

    setBatchedSource(b_source: BatchedModelSource): void {
        this.source = b_source;
        this.source.registerUnLoadTile((tile_key: string) => {
            if (this.tileCache.has(tile_key)) {
                console.log('delete tile key');
                this.tileCache.delete(tile_key);
            }
        });
    }

    onAdd(map: maplibregl.Map, gl: WebGLRenderingContext): void {
        this.map = map;
        this.camera = new THREE.Camera();
        this.camera.matrixAutoUpdate = false;
        this.renderer = getSharedRenderer(map.getCanvas(), gl);
        if (!this.shadowMapPass) {
            this.shadowMapPass = getSharedShadowPass(8192);
        }
        const canvas = map.getCanvas();
        if (!this.reflectionPass) {
            this.reflectionPass = getSharedReflectionPass(canvas.width * 0.5, canvas.height * 0.5);
        }
        map.on('click', this.handleClick);
    }

    onRemove(): void {
        this.map?.off('click', this.handleClick);
        this.renderer = null;
        this.camera = null;
        this.map = null;
    }

    private tileKey(x: number, y: number, z: number): string {
        return `${z}/${x}/${y}`;
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
    }

    setPickEnabled(enabled: boolean): void {
        this.pickEnabled = enabled;
    }

    private handleClick = (e: MapMouseEvent) => {
        if (!this.pickEnabled) return;
        if (!this.map || !this.camera || !this.renderer || !this.visible) {
            return;
        }
        // to NDC [-1..1]
        const canvas = this.map.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((e.point.x) / rect.width) * 2 - 1,
            -(((e.point.y) / rect.height) * 2 - 1),
        );
        const tr = this.map.transform;
        if (!tr?.getProjectionData) {
            return;
        }
        let bestHit: {
            dist: number;
            tileKey: string;
            overScaledTileID: OverscaledTileID,
            group: THREE.Object3D
        } | null = null;
        for (const tid of this._visibleTiles) {
            const canonicalTileID = tid.canonical;
            const key = this.tileKey(canonicalTileID.x, canonicalTileID.y, canonicalTileID.z);
            const tile = this.tileCache.get(key);
            if (!tile?.sceneTile) {
                continue;
            }

            const proj = tr.getProjectionData({
                overscaledTileID: tid,
                applyGlobeMatrix: this.applyGlobeMatrix,
            });

            // ---- manual ray from MVP inverse ----
            const mvp = new THREE.Matrix4().fromArray(proj.mainMatrix);
            const inv = mvp.clone().invert();

            const pNear = new THREE.Vector4(ndc.x, ndc.y, -1, 1).applyMatrix4(inv);
            pNear.multiplyScalar(1 / pNear.w);

            const pFar = new THREE.Vector4(ndc.x, ndc.y, 1, 1).applyMatrix4(inv);
            pFar.multiplyScalar(1 / pFar.w);

            const origin = new THREE.Vector3(pNear.x, pNear.y, pNear.z);
            const direction = new THREE.Vector3(pFar.x, pFar.y, pFar.z).sub(origin).normalize();

            this.raycaster.ray.origin.copy(origin);
            this.raycaster.ray.direction.copy(direction);

            const hits = this.raycaster.intersectObjects(tile.sceneTile.children, true);
            if (hits.length) {
                const h0 = hits[0];
                let obj: THREE.Object3D | null = h0.object;
                while (obj && !obj.userData?.isModelRoot) {
                    obj = obj.parent as THREE.Object3D;
                }
                if (obj) {
                    if (!bestHit || h0.distance < bestHit.dist) {
                        bestHit = {
                            dist: h0.distance,
                            tileKey: key,
                            overScaledTileID: tid,
                            group: obj
                        };
                    }
                }
            }
        }

        if (!bestHit) {
            if (this.onPickfail) {
                this.onPickfail();
            }
            this.map.triggerRepaint();
            return;
        }
        const obj = bestHit.group;
        this.onPick?.({
            dist: bestHit.dist,
            tileKey: bestHit.tileKey,
            object: obj,
            overScaledTileId: bestHit.overScaledTileID
        });
        this.map.triggerRepaint();
    };

    private getTileData(key: string): DataTileInfoForThreeDLayer {
        let tileData = this.tileCache.get(key);
        if (!tileData) {
            const scene = new THREE.Scene();
            tileData = {
                sceneTile: scene,
                shadowLitMaterials: [],
                shadowMaterials: [],
            }
            this.tileCache.set(key, tileData);
        }
        return tileData;
    }

    prerender(): void {
        if (!this.map || !this.source) {
            return;
        }
        this._currentZoom = clampZoom(
            this.source.minZoom,
            this.source.maxZoom,
            Math.round(this.map.getZoom())
        );
        this._visibleTiles = this.map.coveringTiles({
            tileSize: this.tileSize,
            minzoom: this._currentZoom,
            maxzoom: this._currentZoom,
            roundZoom: true,
        });
        for (const tile of this._visibleTiles) {
            const tileData = this.source.getTile(tile);
            if (tileData.state !== 'loaded') {
                continue;
            }
            const tile_key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            let tileDataInfo = this.tileCache.get(tile_key);
            if (!tileDataInfo) {
                const scene = new THREE.Scene();
                tileDataInfo = {
                    sceneTile: scene,
                    shadowMaterials: [],
                    shadowLitMaterials: [],
                }
                if (tileData.data) {
                    tileDataInfo.sceneTile.add(tileData.data);
                    // Mark direct children as model roots for raycaster pick
                    const latlon = tileLocalToLatLon(
                        tile.canonical.z, tile.canonical.x, tile.canonical.y,
                        4096, 4096
                    );
                    const scaleUnit = getMetersPerExtentUnit(latlon.lat, tile.canonical.z);
                    const tileCoord = { x: tile.canonical.x, y: tile.canonical.y, z: tile.canonical.z };
                    for (const child of tileData.data.children) {
                        child.userData.isModelRoot = true;
                        child.userData.scaleUnit = scaleUnit;
                        child.userData.tile = tileCoord;
                    }
                    tileData.data.traverse((child: THREE.Object3D) => {
                        if (child instanceof THREE.Mesh) {
                            const shadowLitMats = applyShadowLitMaterial(child);
                            tileDataInfo!.shadowLitMaterials.push(...shadowLitMats);
                            const shadowMesh = new MaplibreShadowMesh(child);
                            shadowMesh.userData = { scale_unit: scaleUnit };
                            shadowMesh.matrixAutoUpdate = false;
                            tileDataInfo!.sceneTile.add(shadowMesh);
                            tileDataInfo!.shadowMaterials.push({ scaleUnit, shadowMesh });
                        }
                    });
                }
                this.tileCache.set(tile_key, tileDataInfo);
            }
        }
    }

    renderReflection(renderer: THREE.WebGLRenderer, reflectionMatrix: THREE.Matrix4, worldSize: number): void {
        if (!this.reflectionPass || !this.renderer || !this.map) return;
        const tr = this.map.transform;
        const tilesWithShadow: DataTileInfoForThreeDLayer[] = [];
        for (const tile of this._visibleTiles) {
            const key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            const tileInfo = this.tileCache.get(key);
            if (!tileInfo || tileInfo.shadowMaterials.length === 0) continue;
            tilesWithShadow.push(tileInfo);
            for (const pair of tileInfo.shadowMaterials) {
                pair.shadowMesh.visible = false;
            }
        }
        this.reflectionPass.reflectionPass(
            renderer,
            this._visibleTiles,
            worldSize,
            (tile) => this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z),
            (key) => {
                const tileCache = this.tileCache.get(key);
                const scene = tileCache?.sceneTile;
                if (!scene) return undefined;
                return {
                    scene,
                    shadowLitMats: tileCache.shadowLitMaterials
                };
            },
            tr,
        );
        for (const tileInfo of tilesWithShadow) {
            for (const pair of tileInfo.shadowMaterials) {
                pair.shadowMesh.visible = true;
            }
        }
    }

    renderShadowDepth(renderer: THREE.WebGLRenderer, worldSize: number): void {
        if (!this.shadowMapPass || !this.map) return;
        const tilesWithShadow: DataTileInfoForThreeDLayer[] = [];
        for (const tile of this._visibleTiles) {
            const key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            const tileInfo = this.tileCache.get(key);
            if (!tileInfo || tileInfo.shadowMaterials.length === 0) continue;
            tilesWithShadow.push(tileInfo);
            for (const pair of tileInfo.shadowMaterials) {
                pair.shadowMesh.visible = false;
            }
        }
        this.shadowMapPass.shadowPassNoClear(
            renderer,
            this._visibleTiles,
            worldSize,
            (tile) => this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z),
            (key) => this.tileCache.get(key)?.sceneTile,
        );
        for (const tileInfo of tilesWithShadow) {
            for (const pair of tileInfo.shadowMaterials) {
                pair.shadowMesh.visible = true;
            }
        }
    }

    shadowPass(tr: any, visibleTiles: OverscaledTileID[]): void {
        if (!this.shadowMapPass || !this.renderer) return;
        const tilesWithShadow: DataTileInfoForThreeDLayer[] = [];
        for (const tile of visibleTiles) {
            const key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            const tileInfo = this.tileCache.get(key);
            if (!tileInfo || tileInfo.shadowMaterials.length === 0) continue;
            tilesWithShadow.push(tileInfo);
            for (const pair of tileInfo.shadowMaterials) {
                pair.shadowMesh.visible = false;
            }
        }
        this.shadowMapPass.shadowPass(
            this.renderer,
            visibleTiles,
            tr.worldSize,
            (tile) => this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z),
            (key) => this.tileCache.get(key)?.sceneTile,
            this.id,
        );
        for (const tileInfo of tilesWithShadow) {
            for (const pair of tileInfo.shadowMaterials) {
                pair.shadowMesh.visible = true;
            }
        }
    }

    mainPass(tr: any, visibleTiles: OverscaledTileID[]) {
        if (!this.renderer || !this.camera) return;
        this.renderer.resetState();
        if (!this.layerSourceCastShadow) {
            this.renderer.clearStencil();
        }
        for (const tile of visibleTiles) {
            const tile_key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            const tileInfo = this.tileCache.get(tile_key);
            if (!tileInfo) continue;
            if (!tileInfo.sceneTile) continue;
            const projectionData = tr.getProjectionData({
                overscaledTileID: tile,
                applyGlobeMatrix: this.applyGlobeMatrix,
            });
            if (tileInfo) {
                const tileMatrix = projectionData.mainMatrix;
                this.camera.projectionMatrix = new THREE.Matrix4().fromArray(tileMatrix);
                this.updateShadowLitMaterials(tileInfo, tile_key);
                //this.updateShadow(tileInfo.sceneTile);
                this.renderer.render(tileInfo.sceneTile, this.camera);
            }
        }
    }

    render(_gl: WebGLRenderingContext, _args: CustomRenderMethodInput): void {
        if (!this.map || !this.camera || !this.renderer || !this.visible || !this.source) {
            return;
        }
        if (this.map.getZoom() < this.minZoom) return;
        const tr = this.map.transform;
         if (!this.useOrchestrator) {
            this.shadowPass(tr, this._visibleTiles);
        }
        this.mainPass(tr, this._visibleTiles);
    }

    containsObject(object: THREE.Object3D | null): boolean {
        if (!object) {
            return false;
        }
        for (const [, tileData] of this.tileCache) {
            if (tileData.sceneTile.children.includes(object)) {
                return true;
            }
        }
        return false;
    }

    getShadowParam() {
        return undefined;
    }

    getShadowMapPass(): ShadowMapPass | null {
        if (!this.shadowMapPass) {
            this.shadowMapPass = getSharedShadowPass(8192);
        }
        return this.shadowMapPass;
    }

    setLayerSourceCastShadow(source: Custom3DTileRenderLayer): void {
        this.layerSourceCastShadow = source;
    }

    /** Find the OverscaledTileID for a given tile key from current visible tiles */
    getOverscaledTileID(tileKey: string): OverscaledTileID | null {
        for (const tile of this._visibleTiles) {
            const key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            if (key === tileKey) return tile;
        }
        return null;
    }

    private updateShadowLitMaterials(tileInfo: DataTileInfoForThreeDLayer, tileKey: string) {
        if (!this.shadowMapPass) return;
        const sd = this.shadowMapPass.sunDir;
        const shadowMap = this.shadowMapPass.getRenderTarget();
        const lightMatrix = this.shadowMapPass.lightMatrices.get(tileKey);
        this._tmpLightDir.set(-sd.x, -sd.y, sd.z);
        const tod = this.shadowMapPass.timeOfDayColors;
        for (const mat of tileInfo.shadowLitMaterials) {
            mat.update(lightMatrix, shadowMap, this._tmpLightDir);
            mat.setLightColor(tod.lightColor);
            mat.setSkyColor(tod.skyColor);
            mat.setGroundColor(tod.groundColor);
            mat.setShadowColor(tod.shadowColor);
            mat.setLighting(tod.ambient, tod.diffuseIntensity);
        }
        for (const pair of tileInfo.shadowMaterials) {
            const shadow_mesh = pair.shadowMesh;
            const scaleUnit = pair.scaleUnit;
            shadow_mesh.update(this._tmpLightDir.x, this._tmpLightDir.y, this._tmpLightDir.z / scaleUnit);
        }
    }
}
