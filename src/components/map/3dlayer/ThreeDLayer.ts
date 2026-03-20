import maplibregl, {type CustomRenderMethodInput, MapMouseEvent, OverscaledTileID} from 'maplibre-gl';
import * as THREE from 'three';
import {LRUCache} from 'lru-cache';
import type {
    Custom3DTileRenderLayer,
    DataTileInfo,
    LatLon,
    LightGroupOption,
    ModelData,
    ObjectInfo,
    PickHit,
    ShadowCasterLayer,
    ReflectionCasterLayer,
    ShadowParam,
    ShadowPair,
    UserData
} from '../Interface.ts';
import {
    clampZoom,
    getMetersPerExtentUnit,
    tileLocalToLatLon,
} from '../convert/map_convert.ts';
import {parseLayerTileInfo} from '../tile/tile.ts';
import {createBuildingGroup, createShadowGroup, transformModel, applyShadowLitMaterial} from '../model/objModel.ts'
import {MaplibreShadowMesh} from "../shadow/ShadowGeometry.ts";
import {CustomVectorSource} from "../source/CustomVectorSource.ts"
import {ModelFetch} from "./ModelFetch.ts";
import {ShadowLitMaterial} from "../shadow/ShadowLitMaterial.ts";
import {ShadowMapPass,getSharedShadowPass} from "../shadow/ShadowMapPass.ts";
import { getSharedReflectionPass, ReflectionPass } from '../water/ReflectionPass.ts';
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
};

type TileState = 'preparing' | 'loaded' | 'not-support' | 'error';
type DownloadState = 'downloading' | 'loaded' | 'disposed' | 'error';

type TileCacheEntry = DataTileInfo & {
    state?: TileState;
    stateDownload?: DownloadState;
    sceneTile?: THREE.Scene;
    overScaledTileID?: OverscaledTileID;
    objects?: ObjectInfo[];
    shadowsObject : ShadowPair[];
    shadowLitMaterials: ShadowLitMaterial[];
    addedIds: Set<string>;
    isFullObject: boolean;
};

export type ModelCacheEntry = ModelData & {
    stateDownload: DownloadState;
};

export class Map4DModelsThreeLayer implements Custom3DTileRenderLayer, 
        ShadowCasterLayer,
        ReflectionCasterLayer {
    id: string;
    visible = true;
    onPick?: (info: PickHit) => void;
    onPickfail?: () => void;
    pickEnabled: boolean = true;
    layerSourceCastShadow: Custom3DTileRenderLayer | null = null;
    sourceLayer: string;
    private modelFetcher!: ModelFetch;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;
    private map: maplibregl.Map | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private camera: THREE.Camera | null = null;
    private vectorSource: CustomVectorSource | null = null;
    private readonly rootUrl: string;
    private minZoom: number;
    private maxZoom: number;
    private readonly tileSize: number;
    private readonly applyGlobeMatrix: boolean;
    private tileCache: LRUCache<string, TileCacheEntry>;
    private modelCache: LRUCache<string, ModelCacheEntry>;
    private raycaster = new THREE.Raycaster();
    private _visibleTiles: OverscaledTileID[] = [];
    private _currentZoom = 0;
    private readonly _tmpLightDir = new THREE.Vector3();
    private readonly clock = new THREE.Clock();
    //shadow
    private shadowMapPass: ShadowMapPass | null = null;
    private reflectionPass : ReflectionPass | null = null; 



    constructor(opts: Map4DModelsLayerOptions & { onPick?: (info: PickHit) => void } & {
        onPickfail?: () => void
    }) {
        this.id = opts.id;
        this.sourceLayer = opts.sourceLayer;
        this.rootUrl = opts.rootUrl;
        this.modelFetcher = new ModelFetch(8, this.rootUrl);
        this.minZoom = opts.minZoom ?? 16;
        this.maxZoom = opts.maxZoom ?? 19;
        this.tileSize = opts.tileSize ?? 512;
        this.applyGlobeMatrix = opts.applyGlobeMatrix ?? true;
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

    prerender(_gl: WebGLRenderingContext, _args: CustomRenderMethodInput): void {
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
                        shadowsObject : [],
                        shadowLitMaterials: [],
                        addedIds: new Set<string>(),
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
                                    const modelType = object.modelType ?? 'Object';
                                    const modelUrl = object.modelUrl ?? '';
                                    const textureUrl = object.textureUrl ?? '';
                                    this.modelFetcher.fetch(modelUrl, textureUrl, modelType, modelCacheEntry, (error) => {
                                        if (error) {
                                            console.warn(error);
                                        }
                                        this.map?.triggerRepaint();
                                    });
                                }
                            }
                        }
                    }
                    this.populateBuildingGroup(tile, tileDataInfo);
                }
            }
        }
    }

    getVectorSource(): CustomVectorSource | null {
        return this.vectorSource;
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

    onAdd(map: maplibregl.Map, gl: WebGLRenderingContext): void {
        this.map = map;
        this.camera = new THREE.Camera();
        this.camera.matrixAutoUpdate = false; 
        this.renderer = getSharedRenderer(map.getCanvas(), gl);
        if(!this.shadowMapPass){
            this.shadowMapPass = getSharedShadowPass(8192); 
        }
        const canvasSize = map.getCanvas(); 
        if(!this.reflectionPass){
            this.reflectionPass = getSharedReflectionPass(canvasSize.width * 0.5,canvasSize.height * 0.5); 
        }
        // thêm sự kiện pick
        map.on('click', this.handleClick);
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

    onRemove(): void {
        this.map?.off('click', this.handleClick);
        this.renderer = null;
        this.camera = null;
        this.map = null;
        this.tileCache.clear();
        this.modelCache.clear();
    }

    useOrchestrator = false;

    renderShadowDepth(renderer: THREE.WebGLRenderer, worldSize: number): void {
        if (!this.shadowMapPass || !this.renderer) return;
        const tilesWithShadow: TileCacheEntry[] = [];
        //ignore all shadow mesh
        for (const tile of this._visibleTiles) {
            const key = this.tileKey(tile);
            const tileInfo = this.tileCache.get(key);
            if (!tileInfo || tileInfo.shadowsObject.length === 0) continue;
            tilesWithShadow.push(tileInfo);
            for (const pair of tileInfo.shadowsObject) {
                pair.shadowMesh.visible = false;
            }
        }
        //shadowPass 
        this.shadowMapPass.shadowPassNoClear(
            renderer,
            this._visibleTiles,
            worldSize,
            (tile) => this.tileKey(tile),
            (key) => this.tileCache.get(key)?.sceneTile,
        );

        for (const tileInfo of tilesWithShadow) {
            for (const pair of tileInfo.shadowsObject) {
                pair.shadowMesh.visible = true;
            }
        }
    }

    renderReflection(renderer: THREE.WebGLRenderer, reflectionMatrix: THREE.Matrix4, worldSize: number) : void {
        //use for render reflection texture 
        if(!this.reflectionPass || !this.renderer || !this.map) return; 
        const tilesWithShadow: TileCacheEntry[] = [];
        const tr = this.map.transform; 
        //ignore all shadow mesh
        for (const tile of this._visibleTiles) {
            const key = this.tileKey(tile);
            const tileInfo = this.tileCache.get(key);
            if (!tileInfo || tileInfo.shadowsObject.length === 0) continue;
            tilesWithShadow.push(tileInfo);
            for (const pair of tileInfo.shadowsObject) {
                pair.shadowMesh.visible = false;
            }
        }
        //reflectionPass
        this.reflectionPass.reflectionPass(
            renderer,
            this._visibleTiles,
            worldSize,
            (tile) => this.tileKey(tile),
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
            for (const pair of tileInfo.shadowsObject) {
                pair.shadowMesh.visible = true;
            }
        }

    }

    shadowPass(tr : any, visibleTiles : OverscaledTileID[]) : void {
        if(!this.shadowMapPass || !this.renderer) return;
        const tilesWithShadow: TileCacheEntry[] = [];
        for (const tile of visibleTiles) {
            const key = this.tileKey(tile);
            const tileInfo = this.tileCache.get(key);
            if (!tileInfo || tileInfo.shadowsObject.length === 0) continue;
            tilesWithShadow.push(tileInfo);
            for (const pair of tileInfo.shadowsObject) {
                pair.shadowMesh.visible = false;
            }
        }
        this.shadowMapPass.shadowPass(
            this.renderer,
            visibleTiles,
            tr.worldSize,
            (tile) => this.tileKey(tile),
            (key) => this.tileCache.get(key)?.sceneTile,
            this.id,
        );
        for (const tileInfo of tilesWithShadow) {
            for (const pair of tileInfo.shadowsObject) {
                pair.shadowMesh.visible = true;
            }
        }
    }

    mainPass(tr : any, visibleTiles : OverscaledTileID[]) : void {
        if(!this.renderer || !this.camera || !this.shadowMapPass) return;
        this.renderer.resetState();
        if(!this.layerSourceCastShadow){
            this.renderer.clearStencil();
        }
        const sd = this.shadowMapPass.sunDir;
        this._tmpLightDir.set(-sd.x, -sd.y, sd.z);
        for (const tile of visibleTiles) {
            const tile_key = this.tileKey(tile);
            const tileInfo = this.tileCache.get(tile_key);
            if (!tileInfo?.sceneTile) continue;
            const projectionData = tr.getProjectionData({
                overscaledTileID: tile,
                applyGlobeMatrix: this.applyGlobeMatrix,
            });
            const light_matrix = this.shadowMapPass.lightMatrices.get(tile_key);
            this.updateShadowLitMaterials(tileInfo, light_matrix, this._tmpLightDir);
            this.camera.projectionMatrix.fromArray(projectionData.mainMatrix);
            this.renderer.render(tileInfo.sceneTile, this.camera);
        }
    }

    

    render(_gl: WebGLRenderingContext, _args: CustomRenderMethodInput): void {
        if (!this.map || !this.camera || !this.renderer || !this.visible || !this.vectorSource) {
            return;
        }
        if (this.map.getZoom() < this.minZoom) return;
        const tr = this.map.transform;
        const delta = this.clock.getDelta();
        this.animateMixers(delta);
        if (!this.useOrchestrator) {
            this.shadowPass(tr, this._visibleTiles);
        }
        this.mainPass(tr, this._visibleTiles);
    }

    private animateMixers(delta: number): void {
        for (const tile of this._visibleTiles) {
            const key = this.tileKey(tile);
            const tileInfo = this.tileCache.get(key);
            if (!tileInfo?.sceneTile) continue;
            tileInfo.sceneTile.traverse((child) => {
                if (child.userData?.isModelRoot && child.userData.mixer) {
                    child.userData.mixer.update(delta);
                }
            });
        }
        this.map?.triggerRepaint();
    }

    /** --------- Picking --------- */
    setPickEnabled(enabled: boolean): void {
        this.pickEnabled = enabled;
    }

    private handleClick = (e: MapMouseEvent) => {
        if (!this.pickEnabled) return;
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


    getShadowParam(): ShadowParam | undefined {
        if (!this.shadowMapPass || !this.renderer) return undefined;
        return {
            shadowRenderTarget: this.shadowMapPass.getShadowRenderTarget(),
            shadowMatrix: this.shadowMapPass.shadowMatrix,
            lightDir: this._tmpLightDir,
            renderer: this.renderer,
        };
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

    private updateShadowLitMaterials(
        tile : TileCacheEntry,
        lightMatrix: THREE.Matrix4 | undefined,
        lightDir: THREE.Vector3,
    ): void {
        const shadowMap = this.shadowMapPass?.getRenderTarget();
        const tod = this.shadowMapPass?.timeOfDayColors;
        for (const mat of tile.shadowLitMaterials) {
            mat.update(lightMatrix, shadowMap, lightDir);
            if (tod) {
                mat.setLightColor(tod.lightColor);
                mat.setSkyColor(tod.skyColor);
                mat.setGroundColor(tod.groundColor);
                mat.setShadowColor(tod.shadowColor);
                mat.setLighting(tod.ambient, tod.diffuseIntensity);
            }
        }
        const sd = this.shadowMapPass?.sunDir;
        if (!sd) return;
        for (const shadow_pair of tile.shadowsObject) {
            const scale_unit = shadow_pair.scaleUnit;
            const mat = shadow_pair.shadowMesh;
            mat.update(-sd.x, -sd.y, sd.z / scale_unit)
        }
    }

    private shallowCloneModel(source: THREE.Object3D): THREE.Object3D {
        const clone = source.clone(false);
        for (const child of source.children) {
            if (child instanceof THREE.Mesh) {
                const meshClone = new THREE.Mesh(child.geometry, child.material.clone());
                meshClone.name = child.name;
                meshClone.matrix.copy(child.matrix);
                meshClone.matrixWorld.copy(child.matrixWorld);
                meshClone.matrixAutoUpdate = false;
                if (child.morphTargetInfluences) {
                    meshClone.morphTargetInfluences = child.morphTargetInfluences.slice();
                }
                if (child.morphTargetDictionary) {
                    meshClone.morphTargetDictionary = {...child.morphTargetDictionary};
                }
                clone.add(meshClone);
            } else {
                clone.add(this.shallowCloneModel(child));
            }
        }
        return clone;
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
            const gid = object.gid as string;
            const objectId = modelId || gid;
            if (!modelName || !objectId) {
                continue;
            }
            const cached = this.modelCache.get(modelName);
            if (!cached || cached.stateDownload !== 'loaded' || !cached.object3d) {
                continue;
            }
            if (tile.addedIds.has(objectId)) {
                continue;
            }
            // scale theo vĩ độ/zoom như code của bạn
           // const cloneObj3d = this.shallowCloneModel(cached.object3d);
           const cloneObj3d = cached.object3d.clone(true); 
            cloneObj3d.name = objectId;
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
            const rawModelUrl = object.modelUrl ?? '';
            const rawTextureUrl = object.textureUrl ?? '';
            const modelUrl = rawModelUrl && this.rootUrl && !/^https?:\/\//.test(rawModelUrl) ? this.rootUrl + rawModelUrl : rawModelUrl;
            const textureUrl = rawTextureUrl && this.rootUrl && !/^https?:\/\//.test(rawTextureUrl) ? this.rootUrl + rawTextureUrl : rawTextureUrl;
            const ud: UserData = {
                isModelRoot: true,
                scaleUnit,
                tile: {z, x: tileX, y: tileY},
                mixer: null,
                gid: object.gid ?? null,
                id: objectId,
                name: modelName,
                modeltype: object.modelType ?? 'Object',
                modelname: modelName,
                modelurl: modelUrl,
                texturename: object.textureName ?? '',
                textureurl: textureUrl,
                startdate: object.startdate ?? null,
                enddate: object.enddate ?? null,
            };
            cloneObj3d.userData = ud;
            if (cached.animations && cached.animations.length > 0) {
                const mixer = new THREE.AnimationMixer(cloneObj3d);
                cached.animations.forEach((clip) => {
                    const action = mixer.clipAction(clip);
                    if (action) {
                        action.reset();
                        action.setLoop(THREE.LoopRepeat, Infinity);
                        action.play();
                    }
                });
                cloneObj3d.userData.mixer = mixer;
            }
            cloneObj3d.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    const shadowLitMats = applyShadowLitMaterial(child);
                    tile.shadowLitMaterials.push(...shadowLitMats);
                    const object_shadow = new MaplibreShadowMesh(child);
                    object_shadow.userData = {
                        scale_unit: scaleUnit,
                    };
                    object_shadow.matrixAutoUpdate = false;
                    shadow_group?.add(object_shadow);
                    tile.shadowsObject.push({scaleUnit : scaleUnit,
                        shadowMesh : object_shadow
                    }); 
                }
            });
            cloneObj3d.traverse(obj => { obj.frustumCulled = false; });
            building_group.add(cloneObj3d);
            tile.addedIds.add(objectId);
        }
        this.map?.triggerRepaint();
    }
}
