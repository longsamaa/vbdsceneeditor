import maplibregl, {type CustomRenderMethodInput, MapMouseEvent, OverscaledTileID} from 'maplibre-gl';
import * as THREE from 'three';
import {LRUCache} from 'lru-cache';
import type {
    Custom3DTileRenderLayer,
    DataTileInfo,
    LatLon,
    LightGroup,
    LightGroupOption,
    ModelData,
    ObjectInfo,
    PickHit,
    ShadowParam,
    SunOptions,
    SunParamater
} from '../Interface.ts';
import {
    clampZoom,
    getMetersPerExtentUnit,
    tileLocalToLatLon,
    projectToWorldCoordinates
} from '../convert/map_convert.ts';
import {parseLayerTileInfo} from '../tile/tile.ts';
import {createBuildingGroup, createLightGroup, createShadowGroup, transformModel, applyShadowLitMaterial} from '../model/objModel.ts'
import {calculateSunDirectionMaplibre} from '../shadow/ShadowHelper.ts'
import {MaplibreShadowMesh, GroundShadowMesh} from "../shadow/ShadowGeometry.ts";
import {CustomVectorSource} from "../source/CustomVectorSource.ts"
import {ModelFetch} from "./ModelFetch.ts";
import {
    calculateTileMatrixThree,
    createShadowMapMatrixOrtho,
} from "../shadow/ShadowCamera.ts";
import {ShadowRenderTarget} from "../shadow/ShadowRenderTarget.ts";
import {ShadowLitMaterial, ShadowDepthMaterial} from "../shadow/ShadowLitMaterial.ts";
import {getSharedRenderer} from "../SharedRenderer.ts";


/** Config cho layer */
export type Map4DModelsLayerOptions = {
    id: string;
    /** id của vector source đã add vào map style (type: "vector") */
    sourceLayer: string;
    /** root để ghép modelUrl/textureUrl từ thuộc tính feature */
    rootUrl: string;
    /** key/query nếu cần (để requestVectorTile dùng) */
    key?: string;
    minZoom?: number;
    maxZoom?: number;
    /** tileSize để coveringTiles */
    tileSize?: number;
    /** giới hạn cache */
    maxTileCache?: number;
    maxModelCache?: number;
    /** bật globe matrix khi đang globe */
    applyGlobeMatrix?: boolean;
    sun?: SunOptions;
};

type TileState = 'preparing' | 'loaded' | 'not-support' | 'error';
type DownloadState = 'downloading' | 'loaded' | 'disposed' | 'error';

type TileCacheEntry = DataTileInfo & {
    state?: TileState;
    stateDownload?: DownloadState;
    sceneTile?: THREE.Scene;
    overScaledTileID?: OverscaledTileID;
    objects?: ObjectInfo[];
    isFullObject: boolean;
};

export type ModelCacheEntry = ModelData & {
    stateDownload: DownloadState;
};

export class Map4DModelsThreeLayer implements Custom3DTileRenderLayer {
    id: string;
    visible = true;
    onPick?: (info: PickHit) => void;
    onPickfail?: () => void;
    layerSourceCastShadow: Custom3DTileRenderLayer | null = null;
    sourceLayer: string;
    private modelFetcher: ModelFetch = new ModelFetch(8);
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;
    private shadowRenderPass : ShadowRenderTarget | null = null;
    private shadowMatrix : THREE.Matrix4 = new THREE.Matrix4();
    private light: LightGroup | null = null;
    private currentScene: THREE.Scene | null = null;
    private map: maplibregl.Map | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private camera: THREE.Camera | null = null;
    private shadow_camera : THREE.Camera | null = null;
    private sun: SunParamater | null | undefined;
    private vectorSource: CustomVectorSource | null = null;
    private readonly rootUrl: string;
    private minZoom: number;
    private maxZoom: number;
    private readonly tileSize: number;
    private readonly applyGlobeMatrix: boolean;
    private tileCache: LRUCache<string, TileCacheEntry>;
    private modelCache: LRUCache<string, ModelCacheEntry>;
    private raycaster = new THREE.Raycaster();
    // --- Reusable objects (avoid per-frame allocations) ---
    private readonly _depthMat = new ShadowDepthMaterial();
    private readonly _lightMatrices = new Map<string, THREE.Matrix4>();
    private readonly _tmpMatrix = new THREE.Matrix4();
    private readonly _tmpLightDir = new THREE.Vector3();
    private _visibleTiles: OverscaledTileID[] = [];
    private _currentZoom = 0;

    constructor(opts: Map4DModelsLayerOptions & { onPick?: (info: PickHit) => void } & {
        onPickfail?: () => void
    }) {
        this.id = opts.id;
        this.sourceLayer = opts.sourceLayer;
        this.rootUrl = opts.rootUrl;
        this.minZoom = opts.minZoom ?? 16;
        this.maxZoom = opts.maxZoom ?? 19;
        this.tileSize = opts.tileSize ?? 512;
        this.applyGlobeMatrix = opts.applyGlobeMatrix ?? true;
        if (opts.sun) {
            this.sun = {
                altitude: opts.sun.altitude,
                azimuth: opts.sun.azimuth,
                sun_dir: calculateSunDirectionMaplibre(THREE.MathUtils.degToRad(opts.sun.altitude),
                    THREE.MathUtils.degToRad(opts.sun.azimuth)),
                shadow: opts.sun.shadow,
                lat: opts.sun.lat,
                lon: opts.sun.lon,
            }
            console.log(this.sun);
        }
        const dirLight = (this.sun?.sun_dir ?? new THREE.Vector3(0.5, 0.5, 0.5)).clone().normalize();
        if (this.sun) {
            this.light = createLightGroup(dirLight);
        }
        this.modelCache = new LRUCache<string, ModelCacheEntry>({
            max: opts.maxModelCache ?? 1024,
            dispose: (model) => {
                if (model?.stateDownload === 'downloading') {
                    model.stateDownload = 'disposed';
                }
            },
        });

        this.tileCache = new LRUCache<string, TileCacheEntry>({
            max: opts.maxTileCache ?? 1024,
            dispose: (tile) => {
                if (tile?.stateDownload === 'downloading') {
                    tile.stateDownload = 'disposed';
                }
            },
        });
        this.onPick = opts.onPick;
        this.onPickfail = opts.onPickfail;
    }

    setVisible(v: boolean): void {
        this.visible = v;
        this.map?.triggerRepaint?.();
    }

    setSunPos(altitude: number, azimuth: number, shadow: boolean = true): void {
        this.sun = {
            altitude: altitude,
            azimuth: azimuth,
            sun_dir: calculateSunDirectionMaplibre(THREE.MathUtils.degToRad(altitude),
                THREE.MathUtils.degToRad(azimuth)),
            shadow: shadow
        }
    }

    private calShadowMatrix(_args: CustomRenderMethodInput){
        if(!this.map || !this.sun) return;
        const tr = this.map.transform;
        const point = projectToWorldCoordinates(tr.worldSize, {
            lat: tr.center.lat,
            lon: tr.center.lng,
        });
        // Ortho size in world-pixels — match viewport so shadow map covers visible tiles.
        // Multiply by 2 to include shadow casters just outside the viewport.
        const shadowW = tr.width * 3;
        const shadowH = tr.height * 3;

        // Fixed near/far/distance for the light camera (world-pixel units).
        const shadowFar = tr.cameraToCenterDistance * 5;
        const shadowNear = 0.1;
        const shadowDistance = tr.cameraToCenterDistance * 2;

         this.shadowMatrix = createShadowMapMatrixOrtho(
            point.x,
            point.y,
            tr.pixelsPerMeter,
            shadowW,
            shadowH,
            shadowNear,
            shadowFar,
            shadowDistance,
            this.sun.azimuth - 180,
            90 - this.sun.altitude,
            0,
            {x : 0, y : 0},
            0);
    }

    prerender(gl, args: CustomRenderMethodInput): void {
        if (!this.map || !this.vectorSource) {
            return;
        }
        this._currentZoom = clampZoom(
            this.vectorSource.minZoom,
            this.vectorSource.maxZoom,
            Math.round(this.map.getZoom())
        );
        this._visibleTiles = this.map.coveringTiles({
            tileSize: this.tileSize,
            minzoom: this._currentZoom,
            maxzoom: this._currentZoom,
            roundZoom: true,
        });
        for (const tile of this._visibleTiles) {
            const vectorTile = this.vectorSource.getTile(tile, {
                build_triangle: true,
            });
            const tile_key = this.tileKey(tile);
            if (vectorTile.state === 'loaded') {
                const layer = vectorTile.data?.layers[this.sourceLayer];
                if (!layer) {
                    continue;
                }
                let tileDataInfo = this.tileCache.get(tile_key);
                if (!tileDataInfo) {
                    const scene = new THREE.Scene();
                    tileDataInfo = {
                        sceneTile: scene,
                        isFullObject: false,
                    }
                    createBuildingGroup(scene);
                    createShadowGroup(scene);
                    tileDataInfo.objects = parseLayerTileInfo(layer);
                    this.tileCache.set(tile_key, tileDataInfo);
                } else {
                    const objects = tileDataInfo.objects;
                    if (objects) {
                        //for each va download url, texture
                        for (const object of objects) {
                            const modelName = object.modelName;
                            if (modelName) {
                                let modelCacheEntry = this.modelCache.get(modelName);
                                if (!modelCacheEntry) {
                                    //donwload tile
                                    modelCacheEntry = {
                                        stateDownload: 'downloading',
                                        object3d: null,
                                        animations: null,
                                    }
                                    if (modelName) {
                                        this.modelCache.set(modelName, modelCacheEntry);
                                    }
                                    const modelType = object.modelType;
                                    if (modelType === "Object") {
                                        let modelUrl = object.modelUrl ?? '';
                                        let textureUrl = object.textureUrl ?? '';
                                        if (this.rootUrl) {
                                            modelUrl = this.rootUrl + modelUrl;
                                            textureUrl = this.rootUrl + textureUrl;
                                        }
                                        this.modelFetcher.fetch(modelUrl, textureUrl, modelCacheEntry, (error, obj3d) => {
                                            if (error) {
                                                console.warn(error);
                                            }
                                            if (obj3d) {
                                            }
                                            this.map?.triggerRepaint();
                                        });
                                    }
                                }
                            }
                        }
                    }
                    this.populateBuildingGroup(tile, tileDataInfo);
                }
            }
        }
        this.calShadowMatrix(args);
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

    onAdd(map: Map, gl: WebGLRenderingContext): void {
        this.map = map;
        this.camera = new THREE.Camera();
        this.shadow_camera = new THREE.Camera();
        this.renderer = getSharedRenderer(map.getCanvas(), gl);
        this.shadowRenderPass = new ShadowRenderTarget(8192);
        // thêm sự kiện pick
        map.on('click', this.handleClick);
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

    onRemove(): void {
        this.map?.off('click', this.handleClick);
        this.renderer = null;
        this.camera = null;
        this.map = null;
        this.tileCache.clear();
        this.modelCache.clear();
    }

    shadowPass(tr : any, visibleTiles : OverscaledTileID[]) : void {
        if(!this._lightMatrices || !this.shadowRenderPass || !this.renderer || !this.shadow_camera) return; 
        this._lightMatrices.clear(); 
        this.shadowRenderPass.beginRenderShadowPass(this.renderer);
        for(const tile of visibleTiles){
            const tile_key = this.tileKey(tile);
                const tileInfo = this.tileCache.get(tile_key);
                if (!tileInfo?.sceneTile) continue;
                const mat = calculateTileMatrixThree(tile.toUnwrapped(), tr.worldSize);
                const light_matrix = this._tmpMatrix.multiplyMatrices(this.shadowMatrix, mat).clone();
                this._depthMat.uniforms.lightMatrix.value = light_matrix;
                tileInfo.sceneTile.overrideMaterial = this._depthMat;
                this.renderer.render(tileInfo.sceneTile, this.shadow_camera);
                tileInfo.sceneTile.overrideMaterial = null;
                this._lightMatrices.set(tile_key, light_matrix);
        }
        this.shadowRenderPass.endRenderShadowPass(this.renderer);

    }

    mainPass(tr : any, visibleTiles : OverscaledTileID[]) : void {
        if(!this.renderer || !this.sun || !this.camera) return; 
        this.renderer.resetState();
        this.renderer.clearStencil();
        this._tmpLightDir.set(-this.sun!.sun_dir.x, -this.sun!.sun_dir.y, this.sun!.sun_dir.z);
        for (const tile of visibleTiles) {
            const tile_key = this.tileKey(tile);
            const tileInfo = this.tileCache.get(tile_key);
            if (!tileInfo?.sceneTile) continue;
            const projectionData = tr.getProjectionData({
                overscaledTileID: tile,
                applyGlobeMatrix: this.applyGlobeMatrix,
            });
            const light_matrix = this._lightMatrices.get(tile_key);
            this.updateShadowPass(tileInfo.sceneTile,light_matrix,this.shadowRenderPass?.getRenderTarget(), this._tmpLightDir);
            this.camera.projectionMatrix.fromArray(projectionData.mainMatrix);
            this.updateShadow(tileInfo.sceneTile);
            this.renderer.render(tileInfo.sceneTile, this.camera);
        }
    }

    

    render(gl,args: CustomRenderMethodInput): void {
        if (!this.map || !this.camera || !this.renderer || !this.visible || !this.vectorSource || !this.light) {
            return;
        }
        if (this.map.getZoom() < this.minZoom) return;
        const tr = this.map.transform;
        this.shadowPass(tr, this._visibleTiles);
        this.mainPass(tr, this._visibleTiles);
    }

    /** --------- Picking --------- */
    private handleClick = (e: MapMouseEvent) => {
        if (!this.map || !this.camera || !this.renderer || !this.visible) {
            return;
        }
        //this.shadowRenderPass?.exportTexture(this.renderer,'D:\\');
        // to NDC [-1..1]
        const canvas = this.map.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((e.point.x) / rect.width) * 2 - 1,
            -(((e.point.y) / rect.height) * 2 - 1),
        );
        // lấy visible tiles + tile entries đã build scene
        const zoom = clampZoom(this.minZoom, this.maxZoom, Math.round(this.map.getZoom()));
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
            const key = this.tileKey(tid);
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

    /** --------- Tile management --------- */

    private tileKey(tile: OverscaledTileID): string {
        // canonical là public trong interface
        const c = tile.canonical;
        // dùng z/x/y là đủ (wrap không quan trọng cho tile data của bạn)
        return `${c.z}/${c.x}/${c.y}`;
    }

    private updateShadow(scene: THREE.Scene) {
        const sun_dir = this.sun?.sun_dir;
        if (!sun_dir) {
            return;
        }
        /*console.log(sun_dir);*/
        scene.traverse((child) => {
            if (child instanceof GroundShadowMesh) {
                const shadow_scale_z = child.userData.scale_unit;
                (child as GroundShadowMesh).update(-sun_dir.x, -sun_dir.y, sun_dir.z / shadow_scale_z);
            } else if (child instanceof MaplibreShadowMesh) {
                const shadow_scale_z = child.userData.scale_unit;
                (child as MaplibreShadowMesh).update(-sun_dir.x, -sun_dir.y, sun_dir.z / shadow_scale_z);
            }
        });
    }

    getShadowParam(): ShadowParam | undefined {
        if (!this.shadowRenderPass || !this.renderer) return undefined;
        return {
            shadowRenderTarget: this.shadowRenderPass,
            shadowMatrix: this.shadowMatrix,
            lightDir: this._tmpLightDir,
            renderer: this.renderer,
        };
    }

    setLayerSourceCastShadow(source: Custom3DTileRenderLayer): void {
        this.layerSourceCastShadow = source;
    }

    private updateShadowPass(
        scene: THREE.Scene,
        lightMatrix: THREE.Matrix4 | undefined,
        shadowMap: THREE.WebGLRenderTarget | undefined,
        lightDir: THREE.Vector3
    ): void {
        scene.traverse((child) => {
            if (child instanceof GroundShadowMesh) {
                child.getGroundShadowMaterial().update(lightMatrix, shadowMap);
            } else if (child instanceof THREE.Mesh && child.material instanceof ShadowLitMaterial) {
                child.material.update(lightMatrix, shadowMap, lightDir);
            }
        });
    }

    private populateBuildingGroup(overScaledTile: OverscaledTileID, tile: TileCacheEntry) {
        if (!tile.sceneTile || !tile.objects || !overScaledTile || tile.isFullObject) {
            return;
        }
        // chỉ add khi chưa đủ
        const building_group = tile.sceneTile.getObjectByName('building_group');
        if (!building_group) return;
        if (building_group.children.length === tile.objects.length) {
            tile.isFullObject = true;
            return;
        }
        const shadow_group = tile.sceneTile.getObjectByName('shadow_group');
        const z = overScaledTile.canonical.z;
        const tileX = overScaledTile.canonical.x;
        const tileY = overScaledTile.canonical.y;

        for (const object of tile.objects) {
            const modelName = object.modelName as string;
            const modelId = object.id as string;
            if (!modelName || !modelId) {
                continue;
            }
            const cached = this.modelCache.get(modelName);
            if (!cached || cached.stateDownload !== 'loaded' || !cached.object3d) {
                continue;
            }
            if (tile.sceneTile.getObjectByName(modelId)) {
                continue;
            }
            // scale theo vĩ độ/zoom như code của bạn
            const cloneObj3d = cached.object3d.clone(true);
            cloneObj3d.name = modelId;
            const lat_lon: LatLon = tileLocalToLatLon(
                z,
                tileX,
                tileY,
                object.localCoordX as number,
                object.localCoordY as number,
            );
            const scaleUnit = getMetersPerExtentUnit(lat_lon.lat, z);
            const bearing = (object.bearing as number) ?? 0;
            const objectScale = (object.scale as number) ?? 1;
            transformModel(object.localCoordX as number,
                object.localCoordY as number,
                0,
                bearing,
                objectScale,
                scaleUnit,
                cloneObj3d);
            cloneObj3d.matrixAutoUpdate = false;
            cloneObj3d.updateMatrix();
            cloneObj3d.updateMatrixWorld(true);
            cloneObj3d.userData = {
                modelId,
                modelName,
                objectInfo: object,
                tile: {z, x: tileX, y: tileY},
                scaleUnit,
                isModelRoot: true,
            };
            cloneObj3d.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    applyShadowLitMaterial(child);
                    // Skip shadow cho model dẹt (z height quá nhỏ)
                    const object_shadow = new MaplibreShadowMesh(child);
                    object_shadow.userData = {
                        scale_unit: scaleUnit,
                    };
                    object_shadow.matrixAutoUpdate = false;
                    shadow_group?.add(object_shadow);
                }
            });
            cloneObj3d.traverse(obj => { obj.frustumCulled = false; });
            building_group.add(cloneObj3d);
            this.map?.triggerRepaint();
        }
    }
}
