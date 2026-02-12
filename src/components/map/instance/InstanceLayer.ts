import maplibregl, {MapMouseEvent,} from 'maplibre-gl';
import {bakeWorldAndConvertYupToZup, createLightGroup, loadModelFromGlb,} from '../model/objModel.ts';
import {clampZoom, getMetersPerExtentUnit, tileLocalToLatLon} from '../convert/map_convert.ts';
import type {
    Custom3DTileRenderLayer,
    LatLon,
    LightGroup,
    LightGroupOption,
    PickHit,
    SunOptions,
    SunParamater
} from '../Interface.ts'
import * as THREE from 'three';
import {InstancedMesh} from 'three';
import {CustomVectorSource} from "../source/CustomVectorSource.ts"
import {buildShadowMatrix, calculateSunDirectionMaplibre} from "../shadow/ShadowHelper.ts";
import InstancedGroupMesh from "./InstancedGroupMesh.ts";

export type InstanceLayerOpts = {
    id: string;
    applyGlobeMatrix: boolean;
    minZoom: number;
    maxZoom: number;
    sourceLayer: string,
    sun?: SunOptions;
    objectUrl: string[],
}

export type DataTileInfoForInstanceLayer = {
    sceneTile: THREE.Scene;
}

export class InstanceLayer implements Custom3DTileRenderLayer {
    id: string;
    visible: boolean = true;
    onPick?: (info: PickHit) => void;
    onPickfail?: () => void;
    sourceLayer: string;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;
    tileSize: number = 512;
    private vectorSource: CustomVectorSource | null = null;
    private tileCache: Map<string, DataTileInfoForInstanceLayer> = new Map<string, DataTileInfoForInstanceLayer>();
    private objectUrls: string[];
    private shadowMaterial: THREE.MeshBasicMaterial | null = null;
    private mapObj3d: Map<string, THREE.Object3D> = new Map<string, THREE.Object3D>();
    //private raycaster = new THREE.Raycaster();
    private sun: SunParamater | null | undefined;
    private map: maplibregl.Map | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private camera: THREE.Camera | null = null;
    private applyGlobeMatrix: boolean | false = false;
    private light: LightGroup | null = null;
    private currentScene: THREE.Scene | null = null;
    private baseMatrix = new THREE.Matrix4();
    private shadowMatrix = new THREE.Matrix4();
    private finalMatrix = new THREE.Matrix4();
    private sunVector = new THREE.Vector3();
    private minZoom: number;
    private maxZoom: number;

    constructor(opts: InstanceLayerOpts & { onPick?: (info: PickHit) => void } & { onPickfail?: () => void }) {
        this.id = opts.id;
        this.applyGlobeMatrix = opts.applyGlobeMatrix;
        this.onPick = opts.onPick;
        this.onPickfail = opts.onPickfail;
        this.sourceLayer = opts.sourceLayer;
        this.objectUrls = opts.objectUrl;
        if (opts.sun) {
            this.sun = {
                altitude: opts.sun.altitude,
                azimuth: opts.sun.azimuth,
                sun_dir: calculateSunDirectionMaplibre(THREE.MathUtils.degToRad(opts.sun.altitude),
                    THREE.MathUtils.degToRad(opts.sun.azimuth)),
                shadow: opts.sun.shadow
            }
        }
        const dirLight = (this.sun?.sun_dir ?? new THREE.Vector3(0.5, 0.5, 0.5)).clone().normalize();
        if (this.sun) {
            this.light = createLightGroup(dirLight);
        }
        this.shadowMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.1,
            depthWrite: false,
            stencilWrite: true,
            stencilFunc: THREE.EqualStencilFunc,
            stencilRef: 0,
            stencilZPass: THREE.IncrementStencilOp,
            side: THREE.DoubleSide
        });
        this.minZoom = opts.minZoom ?? 0;
        this.maxZoom = opts.maxZoom ?? 19;
    }

    onAdd(map: maplibregl.Map, gl: WebGLRenderingContext): void {
        this.map = map;
        this.camera = new THREE.Camera();
        this.camera.matrixAutoUpdate = false;
        this.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true,
            stencil: true,
        });
        this.renderer.autoClear = false;
        map.on('click', this.handleClick);
        //load glb file
        this.objectUrls.forEach((url) => {
            loadModelFromGlb(url).then((model_data) => {
                if (model_data.object3d) {
                    const object3d = model_data.object3d;
                    bakeWorldAndConvertYupToZup(object3d);
                    if (!this.mapObj3d.has(url)) {
                        this.mapObj3d.set(url, object3d);
                    }
                }
            });
        })
    }

    onRemove(): void {
        this.renderer?.dispose();
        this.renderer = null;
        this.camera = null;
        this.map = null;
    }

    setVectorSource(source: CustomVectorSource): void {
        this.vectorSource = source;
        this.vectorSource.registerUnLoadTile((tile_key: string) => {
            if (this.tileCache.has(tile_key)) {
                console.log('delete tile key');
                this.tileCache.delete(tile_key);
            }
        });
    }

    private tileKey(x: number, y: number, z: number): string {
        return `${z}/${x}/${y}`;
    }

    setLightOption(option: LightGroupOption) {
        if (!this.light) return;
        const {directional, hemisphere, ambient} = option;
        if (directional) {
            const l = this.light.dirLight;
            if (directional.intensity !== undefined)
                l.intensity = directional.intensity;
            if (directional.color !== undefined)
                l.color.set(directional.color);
            if (directional.direction !== undefined)
                l.target.position.copy(
                    directional.direction.clone().multiplyScalar(10000)
                );
        }
        if (hemisphere) {
            const l = this.light.hemiLight;
            if (hemisphere.intensity !== undefined)
                l.intensity = hemisphere.intensity;
            if (hemisphere.skyColor !== undefined)
                l.color.set(hemisphere.skyColor);
            if (hemisphere.groundColor !== undefined)
                l.groundColor.set(hemisphere.groundColor);
        }
        if (ambient) {
            const l = this.light.ambientLight;
            if (ambient.intensity !== undefined)
                l.intensity = ambient.intensity;
            if (ambient.color !== undefined)
                l.color.set(ambient.color);
        }
    }

    prerender(): void {
        if (!this.map || !this.vectorSource || !(this.objectUrls.length === this.mapObj3d.size) || this.mapObj3d.size === 0) {
            return;
        }
        if (this.map.getZoom() < this.minZoom) return;
        const zoom = clampZoom(
            this.vectorSource.minZoom,
            this.vectorSource.maxZoom,
            Math.round(this.map.getZoom())
        );

        const visibleTiles = this.map.coveringTiles({
            tileSize: this.tileSize,
            minzoom: zoom,
            maxzoom: zoom,
            roundZoom: true,
        });

        // Cache tiles and check readiness
        for (const tile of visibleTiles) {
            const canonicalID = tile.canonical;
            const vectorTile = this.vectorSource.getTile(tile, {
                build_triangle: true,
            });
            const tile_key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            if (vectorTile.state === 'loaded') {
                const layer = vectorTile.data?.layers[this.sourceLayer];
                if (!layer) {
                    continue;
                }
                let tileDataInfo = this.tileCache.get(tile_key);
                if (tileDataInfo) continue;
                if (!tileDataInfo) {
                    //create tile data info
                    const scene = new THREE.Scene();
                    tileDataInfo = {
                        sceneTile: scene
                    };
                    //const dirLight = (this.sun?.sun_dir ?? new THREE.Vector3(0.5, 0.5, 0.5)).clone().normalize();
                    //createLightGroup(scene, dirLight);
                    this.tileCache.set(tile_key, tileDataInfo);
                }
                const count = layer.features.length;
                if (count === 0) continue;

                const mapNumber = new Map<string, number>();
                for (const key of this.mapObj3d.keys()) {
                    mapNumber.set(key, 0);
                }
                this.distribute(mapNumber, this.mapObj3d.size, count);
                const instanceGroups: InstancedGroupMesh[] = [];
                for (const [key, object_count] of mapNumber) {
                    const obj3d = this.mapObj3d.get(key);
                    if (!obj3d) continue;
                    const instancedObject3d = new InstancedGroupMesh(obj3d as THREE.Group, object_count);
                    instancedObject3d.name = `instancedMesh_${key}`;
                    obj3d.traverse((child) => {
                        if (child instanceof THREE.Mesh) {
                            if (this.shadowMaterial) {
                                const instanceShadow = new InstancedMesh(child.geometry, this.shadowMaterial, object_count);
                                instanceShadow.name = `instanceShadowMesh_${key}`;
                                tileDataInfo?.sceneTile.add(instanceShadow);
                            }
                        }
                    });
                    tileDataInfo.sceneTile.add(instancedObject3d);
                    instanceGroups.push(instancedObject3d);
                }
                //shadow obj
                for (const [index, feature] of layer.features.entries()) {
                    const point = feature.geometry[0][0];
                    const lat_lon: LatLon = tileLocalToLatLon(
                        canonicalID.z,
                        canonicalID.x,
                        canonicalID.y,
                        point.x,
                        point.y,
                    );
                    const scaleUnit = getMetersPerExtentUnit(lat_lon.lat, canonicalID.z);
                    const matrix = new THREE.Matrix4();
                    const scale = new THREE.Vector3(
                        scaleUnit,
                        -scaleUnit,
                        1
                    );
                    const position = new THREE.Vector3(point.x, point.y, 0);
                    const rotation = new THREE.Quaternion()
                        .setFromAxisAngle(
                            new THREE.Vector3(1, 0, 0),
                            0
                        );
                    matrix.compose(position, rotation, scale);
                    const groupIndex = index % instanceGroups.length;
                    const instanceIndex = Math.floor(index / instanceGroups.length);
                    instanceGroups[groupIndex].setUserDataAt(instanceIndex, {
                        scale_unit: scaleUnit
                    });
                    instanceGroups[groupIndex].setMatrixAt(instanceIndex, matrix);
                }
            }
        }
    }

    private handleClick = (e: MapMouseEvent) => {
        console.log(e);
        /*if (!this.map || !this.camera || !this.renderer || !this.visible) {
            return;
        }
        // to NDC [-1..1]
        const canvas = this.map.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((e.point.x) / rect.width) * 2 - 1,
            -(((e.point.y) / rect.height) * 2 - 1),
        );
        // lấy visible tiles + tile entries đã build scene
        const zoom = clampZoom(this.editorLevel, this.editorLevel, Math.round(this.map.getZoom()));
        const visibleTiles = (this.map).coveringTiles({
            tileSize: this.tileSize,
            minzoom: zoom,
            maxzoom: zoom,
            roundZoom: true,
        }) as OverscaledTileID[];
        const tr = (this.map).transform;
        if (!tr?.getProjectionData) {
            return;
        }
        let bestHit: {
            dist: number;
            tileKey: string;
            overScaledTileID: OverscaledTileID,
            group: THREE.Object3D
        } | null = null;
        for (const tid of visibleTiles) {
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
        this.map.triggerRepaint();*/
    };

    distribute(mapNumber: Map<string, number>, object_size: number, feature_size: number) {
        const quotient = Math.floor(feature_size / object_size); // 2
        const remainder = feature_size % feature_size;
        for (const key of mapNumber.keys()) {
            mapNumber.set(key, quotient);
        }
        let count = 0;
        for (const key of mapNumber.keys()) {
            if (count >= remainder) break;
            mapNumber.set(key, mapNumber.get(key)! + 1);
            count++;
        }
    }

    render(): void {
        if (!this.map || !this.camera || !this.renderer || !this.visible || !this.vectorSource || !this.light) {
            return;
        }
        this.renderer.clearStencil();
        const zoom = clampZoom(this.vectorSource.minZoom,
            this.vectorSource.maxZoom,
            Math.round(this.map.getZoom()));
        const visibleTiles = this.map.coveringTiles({
            tileSize: this.tileSize,
            minzoom: zoom,
            maxzoom: zoom,
            roundZoom: true,
        });
        const tr = this.map.transform;
        for (const tile of visibleTiles) {
            const tile_key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            const projectionData = tr.getProjectionData({
                overscaledTileID: tile,
                applyGlobeMatrix: this.applyGlobeMatrix,
            });
            const tileInfo = this.tileCache.get(tile_key);
            if (tileInfo) {
                const tileMatrix = projectionData.mainMatrix;
                this.camera.projectionMatrix = new THREE.Matrix4().fromArray(tileMatrix);
                if (this.currentScene != tileInfo.sceneTile) {
                    if (this.currentScene) {
                        this.currentScene.remove(this.light);
                    }
                    tileInfo.sceneTile.add(this.light);
                    this.currentScene = tileInfo.sceneTile;
                }
                this.updateShadow(tileInfo.sceneTile);
                this.renderer.resetState();
                this.renderer.render(tileInfo.sceneTile, this.camera);
            }
        }
    }

    private updateShadow(scene: THREE.Scene) {
        const sun_dir = this.sun?.sun_dir;
        if (!sun_dir) {
            return;
        }
        for (const [key] of this.mapObj3d) {
            const instanceMesh = scene.getObjectByName(`instancedMesh_${key}`) as InstancedGroupMesh;
            const instanceShadowMesh = scene.getObjectByName(`instanceShadowMesh_${key}`) as InstancedMesh;
            if (instanceShadowMesh) {
                const count = instanceShadowMesh.count;
                for (let i = 0; i < count; ++i) {
                    const scaleUnit: number = instanceMesh.getUserDataAt(i)?.scale_unit as number;
                    if (scaleUnit) {
                        instanceMesh.getMatrixAt(i, this.baseMatrix);
                        this.sunVector.set(sun_dir.x, sun_dir.y, -sun_dir.z / scaleUnit);
                        buildShadowMatrix(this.sunVector, 0, this.shadowMatrix);
                        this.finalMatrix.multiplyMatrices(this.shadowMatrix, this.baseMatrix);
                        instanceShadowMesh.setMatrixAt(i, this.finalMatrix);
                    }
                }
            }
            instanceShadowMesh.instanceMatrix.needsUpdate = true;
        }
    }
}