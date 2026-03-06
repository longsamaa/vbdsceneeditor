import maplibregl, {type CustomRenderMethodInput, MapMouseEvent, OverscaledTileID} from 'maplibre-gl';
import {bakeWorldAndConvertYupToZup, createLightGroup, loadModelFromGlb, applyShadowLitMaterial} from '../model/objModel.ts';
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
import {ShadowLitMaterial} from "../shadow/ShadowLitMaterial.ts"
import {ShadowMapPass,getSharedShadowPass} from "../shadow/ShadowMapPass.ts";
import {getSharedRenderer} from "../SharedRenderer.ts";
import {
    calculateTileMatrixThree,
} from "../shadow/ShadowCamera.ts";

export type InstanceLayerOpts = {
    id: string;
    applyGlobeMatrix: boolean;
    minZoom: number;
    maxZoom: number;
    sourceLayer: string,
    sun?: SunOptions;
    objectUrl: string[],
}

export type InstanceShadowPair = {
    instanceMesh: InstancedGroupMesh;
    shadowMesh: InstancedMesh;
}

export type DataTileInfoForInstanceLayer = {
    sceneTile: THREE.Scene;
    shadowLitMaterials: ShadowLitMaterial[];
    instanceShadowPairs: InstanceShadowPair[];
}

export class InstanceLayer implements Custom3DTileRenderLayer {
    id: string;
    visible: boolean = true;
    onPick?: (info: PickHit) => void;
    onPickfail?: () => void;
    layerSourceCastShadow: Custom3DTileRenderLayer | null = null;
    sourceLayer: string;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;
    tileSize: number = 512;
    private vectorSource: CustomVectorSource | null = null;
    private tileCache: Map<string, DataTileInfoForInstanceLayer> = new Map<string, DataTileInfoForInstanceLayer>();
    private objectUrls: string[];
    private shadowMaterial: THREE.Material | null = null;
    private mapObj3d: Map<string, THREE.Object3D> = new Map<string, THREE.Object3D>();
    //private raycaster = new THREE.Raycaster();
    private sun: SunParamater | null | undefined;
    private map: maplibregl.Map | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private camera: THREE.Camera | null = null;
    private applyGlobeMatrix: boolean | false = false;
    private light: LightGroup | null = null;
    private baseMatrix = new THREE.Matrix4();
    private shadowMatrix = new THREE.Matrix4();
    private finalMatrix = new THREE.Matrix4();
    private sunVector = new THREE.Vector3();
    private minZoom: number;
    private maxZoom: number;
    //shadow-pass object //
    private shadowMapPass: ShadowMapPass | null = null;
    private readonly _projMatrix = new THREE.Matrix4();
    private _visibleTiles: OverscaledTileID[] = [];
    private readonly _tmpLightDir = new THREE.Vector3();
    
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
                    polygonOffset: true,
                    polygonOffsetFactor: 4,
                    polygonOffsetUnits: 4,
                    transparent: true,
                    opacity: 0.4,
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

    private calShadowMatrix(_args: CustomRenderMethodInput){
        if(!this.map || !this.sun || !this.shadowMapPass) return;
        const tr = this.map.transform;
        this.shadowMapPass.calShadowMatrix(tr, this.sun.altitude, this.sun.azimuth);
    }
 

    onAdd(map: maplibregl.Map, gl: WebGLRenderingContext): void {
        this.map = map;
        this.camera = new THREE.Camera();
        this.camera.matrixAutoUpdate = false;
        this.renderer = getSharedRenderer(map.getCanvas(), gl);
        map.on('click', this.handleClick);
        if(!this.shadowMapPass)
        {
            this.shadowMapPass = getSharedShadowPass(8192); 
        }
        //load glb file
        this.objectUrls.forEach((url) => {
            loadModelFromGlb(url).then((model_data) => {
                if (model_data.object3d) {
                    const object3d = model_data.object3d;
                    bakeWorldAndConvertYupToZup(object3d);
                    object3d.traverse((child) => {
                        if (child instanceof THREE.Mesh) {
                            applyShadowLitMaterial(child);
                        }
                    });

                    if (!this.mapObj3d.has(url)) {
                        this.mapObj3d.set(url, object3d);
                    }
                }
            });
        })
    }

    onRemove(): void {
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

    prerender(gl, args: CustomRenderMethodInput): void {
        if (!this.map || !this.vectorSource || !(this.objectUrls.length === this.mapObj3d.size) || this.mapObj3d.size === 0) {
            return;
        }
        if (this.map.getZoom() < this.minZoom) return;
        const zoom = clampZoom(
            this.vectorSource.minZoom,
            this.vectorSource.maxZoom,
            Math.round(this.map.getZoom())
        );

        this._visibleTiles = this.map.coveringTiles({
            tileSize: this.tileSize,
            minzoom: zoom,
            maxzoom: zoom,
            roundZoom: true,
        });

        // Cache tiles and check readiness
        for (const tile of this._visibleTiles) {
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
                        sceneTile: scene,
                        shadowLitMaterials: [],
                        instanceShadowPairs: [],
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
                const shadowMeshGroups: InstancedMesh[][] = [];
                for (const [key, object_count] of mapNumber) {
                    const obj3d = this.mapObj3d.get(key);
                    if (!obj3d) continue;
                    const instancedObject3d = new InstancedGroupMesh(obj3d as THREE.Group, object_count);
                    instancedObject3d.name = `instancedMesh_${key}`;
                    const shadowMeshes: InstancedMesh[] = [];
                    obj3d.traverse((child) => {
                        if (child instanceof THREE.Mesh) {
                            if (this.shadowMaterial) {
                                const instanceShadow = new InstancedMesh(child.geometry, this.shadowMaterial, object_count);
                                instanceShadow.frustumCulled = false;
                                instanceShadow.name = `instanceShadowMesh_${key}`;
                                tileDataInfo!.sceneTile.add(instanceShadow);
                                shadowMeshes.push(instanceShadow);
                            }
                        }
                    });
                    tileDataInfo!.sceneTile.add(instancedObject3d);
                    instanceGroups.push(instancedObject3d);
                    shadowMeshGroups.push(shadowMeshes);
                    for (const sm of shadowMeshes) {
                        tileDataInfo!.instanceShadowPairs.push({
                            instanceMesh: instancedObject3d,
                            shadowMesh: sm,
                        });
                    }
                }
                const tmpPos = new THREE.Vector3();
                const tmpScale = new THREE.Vector3();
                const tmpQuat = new THREE.Quaternion();
                const tmpMatrix = new THREE.Matrix4();
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
                    tmpScale.set(scaleUnit, -scaleUnit, 1);
                    tmpPos.set(point.x, point.y, 0);
                    tmpQuat.identity();
                    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
                    const groupIndex = index % instanceGroups.length;
                    const instanceIndex = Math.floor(index / instanceGroups.length);
                    instanceGroups[groupIndex].setUserDataAt(instanceIndex, {
                        scale_unit: scaleUnit
                    });
                    instanceGroups[groupIndex].setMatrixAt(instanceIndex, tmpMatrix);
                }
                // cache materials để updateShadowPass không cần traverse
                tileDataInfo.sceneTile.traverse((child) => {
                    if (child instanceof THREE.Mesh) {
                        if (child.material instanceof ShadowLitMaterial) {
                            tileDataInfo!.shadowLitMaterials.push(child.material);
                        }
                    }
                });
            }
        }
        this.calShadowMatrix(args); 
    }

    private handleClick = (e: MapMouseEvent) => {
        console.log(e);
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
    
    private updateShadowLitMaterials(
        tile : DataTileInfoForInstanceLayer,
        lightMatrix: THREE.Matrix4 | undefined,
        lightDir: THREE.Vector3,
    ): void {
        const shadowMap = this.shadowMapPass?.getRenderTarget();
        for (const mat of tile.shadowLitMaterials) {
            mat.update(lightMatrix, shadowMap, lightDir);
        }
    }
    shadowPass(tr : any, visibleTiles : OverscaledTileID[]) : void {
        if(!this.shadowMapPass || !this.renderer) return;
        // Ẩn shadow mesh để không render vào depth shadow map
        for (const tile of visibleTiles) {
            const key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            const tileInfo = this.tileCache.get(key);
            if (!tileInfo) continue;
            for (const pair of tileInfo.instanceShadowPairs) {
                pair.shadowMesh.visible = false;
            }
        }
        this.shadowMapPass.shadowPass(
            this.renderer,
            visibleTiles,
            tr.worldSize,
            (tile) => this.tileKey(tile.canonical.x,tile.canonical.y,tile.canonical.z),
            (key) => this.tileCache.get(key)?.sceneTile,
            this.id,
        );
        // Phục hồi visibility
        for (const tile of visibleTiles) {
            const key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            const tileInfo = this.tileCache.get(key);
            if (!tileInfo) continue;
            for (const pair of tileInfo.instanceShadowPairs) {
                pair.shadowMesh.visible = true;
            }
        }
    }

    mainPass(tr : any, visibleTiles : OverscaledTileID[]){
        if (!this.map || !this.camera || !this.renderer || !this.visible || !this.vectorSource || !this.light || !this.shadowMapPass) {
            return;
        }
        this.renderer.resetState();
        if(!this.layerSourceCastShadow){
            this.renderer.clearStencil();
        }
        this._tmpLightDir.set(-this.sun!.sun_dir.x, -this.sun!.sun_dir.y, this.sun!.sun_dir.z);
        for (const tile of visibleTiles) {
            const tile_key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            const projectionData = tr.getProjectionData({
                overscaledTileID: tile,
                applyGlobeMatrix: this.applyGlobeMatrix,
            });
            const tileInfo = this.tileCache.get(tile_key);
            if(!tileInfo?.sceneTile) continue; 
            const tileMatrix = projectionData.mainMatrix;
            this.camera.projectionMatrix = this._projMatrix.fromArray(tileMatrix);
            const light_matrix = this.shadowMapPass.lightMatrices.get(tile_key);
            this.updateShadowLitMaterials(tileInfo, light_matrix, this._tmpLightDir);
            this.updateShadow(tileInfo);
            this.renderer.render(tileInfo.sceneTile, this.camera);
        }
    }

    render(): void {
        if (!this.map || !this.camera || !this.renderer || !this.visible || !this.vectorSource || !this.light) {
            return;
        }
        const tr = this.map.transform;
        this.shadowPass(tr, this._visibleTiles);
        this.mainPass(tr, this._visibleTiles);
    }

    getShadowParam() {
        return undefined;
    }

    getShadowMapPass(): ShadowMapPass | null {
        if(!this.shadowMapPass)
        {
            this.shadowMapPass = getSharedShadowPass(8192); 
        }
        return this.shadowMapPass;
    }

    setLayerSourceCastShadow(source: Custom3DTileRenderLayer): void {
        this.layerSourceCastShadow = source;
    }
    
    private updateShadow(tileInfo: DataTileInfoForInstanceLayer) {
        const sun_dir = this.sun?.sun_dir;
        if (!sun_dir) return;
        for (const pair of tileInfo.instanceShadowPairs) {
            const { instanceMesh, shadowMesh } = pair;
            const count = shadowMesh.count;
            for (let i = 0; i < count; ++i) {
                const scaleUnit: number = instanceMesh.getUserDataAt(i)?.scale_unit as number;
                if (scaleUnit) {
                    instanceMesh.getMatrixAt(i, this.baseMatrix);
                    this.sunVector.set(-sun_dir.x, -sun_dir.y, sun_dir.z / scaleUnit);
                    buildShadowMatrix(this.sunVector, 0, this.shadowMatrix);
                    this.finalMatrix.multiplyMatrices(this.shadowMatrix, this.baseMatrix);
                    shadowMesh.setMatrixAt(i, this.finalMatrix);
                }
            }
            shadowMesh.instanceMatrix.needsUpdate = true;
        }
    }
}