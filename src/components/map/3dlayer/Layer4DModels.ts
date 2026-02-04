/* eslint-disable @typescript-eslint/prefer-as-const */
import {
    Map,
    OverscaledTileID,
    MapMouseEvent
} from 'maplibre-gl';
import * as THREE from 'three';
import {LRUCache} from 'lru-cache';
import type {
    DataTileInfo,
    ObjectInfo,
    ModelData,
    LatLon,
    SunOptions,
    SunParamater,
    PickHit,
    Custom3DTileRenderLayer
} from '../Interface.ts';
import {tileLocalToLatLon, getMetersPerExtentUnit, clampZoom} from '../convert/map_convert.ts';
import {requestVectorTile} from '../tile/request.ts';
import {parseVectorTile} from '../convert/vectortile_convert.ts';
import {parseTileInfo} from '../tile/tile.ts';
import {createLightGroup, transformModel} from '../model/objModel.ts'
import {calculateSunDirectionMaplibre} from '../shadow/ShadowHelper.ts'
import {
    downloadModel,
    prepareModelForRender,
} from '../model/objModel.ts';
import {MaplibreShadowMesh} from "../shadow/ShadowGeometry.ts";

/** Config cho layer */
export type Map4DModelsLayerOptions = {
    id: string;
    /** id của vector source đã add vào map style (type: "vector") */
    vectorSourceUrl: string;
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
type DownloadState = 'downloading' | 'loaded' | 'disposed';

type TileCacheEntry = DataTileInfo & {
    state?: TileState;
    stateDownload?: DownloadState;
    sceneTile?: THREE.Scene;
    overScaledTileID?: OverscaledTileID;
    objects?: ObjectInfo[];
};

type ModelCacheEntry = ModelData & {
    stateDownload?: DownloadState;
    object3d?: THREE.Group;
};

export class Map4DModelsThreeLayer implements Custom3DTileRenderLayer {
    id: string;
    visible = true;
    onPick?: (info: PickHit) => void;
    onPickfail?: () => void;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;
    private map: Map | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private camera: THREE.Camera | null = null;
    private sun: SunParamater | null | undefined;
    private readonly vectorSourceUrl: string;
    private readonly sourceLayer: string;
    private readonly rootUrl: string;
    private readonly minZoom: number;
    private readonly maxZoom: number;
    private readonly tileSize: number;
    private readonly applyGlobeMatrix: boolean;
    private tileCache: LRUCache<string, TileCacheEntry>;
    private modelCache: LRUCache<string, ModelCacheEntry>;
    // Tile template lấy từ style source (tiles[]) hoặc tilejson (url)
    private raycaster = new THREE.Raycaster();
    constructor(opts: Map4DModelsLayerOptions & { onPick?: (info: PickHit) => void } & {
        onPickfail?: () => void
    }) {
        this.id = opts.id;
        this.vectorSourceUrl = opts.vectorSourceUrl;
        this.sourceLayer = opts.sourceLayer;
        this.rootUrl = opts.rootUrl;
        // this.sun_pos = opts.sun_pos;
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
                shadow: opts.sun.shadow
            }
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

    onAdd(map: Map, gl: WebGLRenderingContext): void {
        this.map = map;
        this.camera = new THREE.Camera();
        this.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true,
            alpha: true,
            stencil: true,
        });
        this.renderer.autoClear = false;
        this.renderer.localClippingEnabled = true;
        // thêm sự kiện pick
        map.on('click', this.handleClick);
    }

    onRemove(): void {
        this.map?.off('click', this.handleClick);
        this.renderer?.dispose();
        this.renderer = null;
        this.camera = null;
        this.map = null;
        this.tileCache.clear();
        this.modelCache.clear();
    }

    render(): void {
        if (!this.map || !this.camera || !this.renderer || !this.visible) {
            return;
        }
        this.renderer.clearStencil();
        const zoom = clampZoom(this.minZoom, this.maxZoom, Math.round(this.map.getZoom()));
        const visibleTiles = [];
        for (let z = this.minZoom; z <= zoom; z++) {
            const tiles = this.map.coveringTiles({
                tileSize: this.tileSize,
                minzoom: z,
                maxzoom: z,
                roundZoom: true,
            });
            visibleTiles.push(...tiles);
        }
        // request+cache tiles / models
        const renderTiles = this.ensureTiles(visibleTiles);
        const tr = this.map.transform;
        if (!tr?.getProjectionData) {
            return;
        }
        for (const tile of renderTiles) {
            if (!tile.overScaledTileID || !tile.sceneTile) {
                continue;
            }
            const projectionData = tr.getProjectionData({
                overscaledTileID: tile.overScaledTileID,
                applyGlobeMatrix: this.applyGlobeMatrix,
            });
            const tileMatrix = projectionData.mainMatrix;
            this.camera.projectionMatrix = new THREE.Matrix4().fromArray(tileMatrix);
            this.renderer.resetState();
            //update shadow geo
            this.updateShadow(tile.sceneTile);
            this.renderer.render(tile.sceneTile, this.camera);
        }
    }

    /** --------- Picking --------- */
    private handleClick = (e: MapMouseEvent) => {
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
            if (!tile?.sceneTile || !tile.overScaledTileID) {
                continue;
            }

            const proj = tr.getProjectionData({
                overscaledTileID: tile.overScaledTileID,
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
            if (child instanceof MaplibreShadowMesh) {
                const shadow_scale_z = child.userData.scale_unit;
                (child as MaplibreShadowMesh).update(new THREE.Vector3(sun_dir.x, sun_dir.y, -sun_dir.z / shadow_scale_z));
            }
        });
    }

    private ensureTiles(tiles: OverscaledTileID[]): TileCacheEntry[] {
        const result: TileCacheEntry[] = [];

        for (const overScaledTileID of tiles) {
            const key = this.tileKey(overScaledTileID);

            if (!this.tileCache.has(key)) {
                // tạo entry + kick request
                const entry: TileCacheEntry = {
                    state: 'preparing',
                    stateDownload: 'downloading',
                };
                this.tileCache.set(key, entry);
                this.requestAndParseTile(overScaledTileID, entry).catch((e) => {
                    entry.state = 'error';
                    entry.stateDownload = 'loaded';
                    console.warn('[Map4DModelsThreeLayer] tile error', key, e);
                });
                continue;
            }

            const entry = this.tileCache.get(key);
            if (!entry) {
                continue;
            }

            if (entry.state === 'loaded' && entry.sceneTile && entry.overScaledTileID) {
                // model download + populate scene
                this.ensureModels(entry);
                this.populateScene(entry);
                // transition như bạn làm (đẩy z về 0 dần)
                /*this.applyTransition(entry);*/
                // chỉ render khi tile ready
                if (entry.sceneTile.children.length > 0) {
                    result.push(entry);
                }
            }
        }

        return result;
    }

    private createShadowGroup(scene: THREE.Scene): void {
        const shadow_group: THREE.Group = new THREE.Group();
        shadow_group.name = "group";
        scene.add(shadow_group);
    }

    private async requestAndParseTile(overScaledTileID: OverscaledTileID, entry: TileCacheEntry) {
        const c = overScaledTileID.canonical;

        // Dùng requestVectorTile của bạn, nhưng URL lấy từ source "gốc"
        const tileUrl = this.buildTileUrl(c.z, c.x, c.y);
        const buffer = await requestVectorTile(c.z, c.x, c.y, tileUrl);

        if (entry.stateDownload === 'disposed') {
            return;
        }
        //console.log(this.map?.style.tileManagers['map4d']._inViewTiles.getAllTiles());
        /*for(const t of this.map?.style.tileManagers['map4d'].){
            console.log(t.latestFeatureIndex);
        }*/
        const parsed = parseVectorTile(buffer);
        const hasLayer = Object.prototype.hasOwnProperty.call(parsed.layers, this.sourceLayer);
        if (!hasLayer) {
            entry.state = 'not-support';
            entry.stateDownload = 'loaded';
            return;
        }
        const objects: ObjectInfo[] = parseTileInfo(parsed, this.sourceLayer);
        entry.objects = objects;
        entry.overScaledTileID = overScaledTileID;
        entry.sceneTile = new THREE.Scene();
        const dirLight = (this.sun?.sun_dir ?? new THREE.Vector3(0.5,0.5,0.5)).clone().normalize();
        createLightGroup(entry.sceneTile, dirLight);
        if (this.sun) {
            this.createShadowGroup(entry.sceneTile);
        }
        entry.state = 'loaded';
        entry.stateDownload = 'loaded';
    }

    /** --------- Model management --------- */

    private ensureModels(tile: TileCacheEntry) {
        if (!tile.objects) {
            return;
        }
        for (const object of tile.objects) {
            const modelName = object.modelName as string;
            if (!modelName) {
                continue;
            }
            if (this.modelCache.has(modelName)) {
                continue;
            }
            const model: ModelCacheEntry = {
                stateDownload: 'downloading',
                object3d: new THREE.Group(),
                animations: [],
            };
            this.modelCache.set(modelName, model);
            const modelUrl = this.rootUrl + (object.modelUrl as string);
            //const isGlb = isGlbModel(modelUrl);
            const textureUrl = this.rootUrl + (object.textureUrl as string);
            downloadModel(modelUrl)
                .then(async (obj3d) => {
                    if (model.stateDownload === 'disposed') {
                        return;
                    }
                    prepareModelForRender(obj3d as THREE.Object3D);
                    obj3d.matrixAutoUpdate = false;
                    model.object3d = obj3d;
                    const textureLoader = new THREE.TextureLoader();
                    try {
                        const texture = await textureLoader.loadAsync(textureUrl).catch((err) => {
                            throw err;
                        });
                        obj3d.traverse((child) => {
                            if (child instanceof THREE.Mesh) {
                                const mat = child.material;
                                if (mat) {
                                    mat.map = texture;
                                    mat.needsUpdate = true;
                                }
                            }
                        });
                        this.map?.triggerRepaint();
                    } catch (err) {
                        // nếu fail texture thì add edges
                        obj3d.traverse((child) => {
                            if (child instanceof THREE.Mesh) {
                                const edges = new THREE.EdgesGeometry(child.geometry);
                                const edgeMaterial = new THREE.LineBasicMaterial({color: 0x000000});
                                const edgeLines = new THREE.LineSegments(edges, edgeMaterial);
                                child.add(edgeLines);
                            }
                        });
                        this.map?.triggerRepaint();
                    }
                    model.stateDownload = 'loaded';
                })
                .catch((e) => {
                    model.stateDownload = 'loaded';
                    console.warn('[Map4DModelsThreeLayer] = failed:', e);
                });
        }
    }

    private populateScene(tile: TileCacheEntry) {
        if (!tile.sceneTile || !tile.objects || !tile.overScaledTileID) {
            return;
        }
        // chỉ add khi chưa đủ
        if (tile.sceneTile.children.length === tile.objects.length) {
            return;
        }
        const z = tile.overScaledTileID.canonical.z;
        const tileX = tile.overScaledTileID.canonical.x;
        const tileY = tile.overScaledTileID.canonical.y;
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
            const main_scene = tile.sceneTile;
            cloneObj3d.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    const object_shadow = new MaplibreShadowMesh(child);
                    object_shadow.userData = {
                        scale_unit: scaleUnit,
                    };
                    object_shadow.matrixAutoUpdate = false;
                    main_scene.add(object_shadow);
                }
            });
            main_scene.add(cloneObj3d);
            this.map?.triggerRepaint();
        }
    }

    /** --------- Read vector source "gốc" to get tile templates --------- */
    private buildTileUrl(z: number, x: number, y: number): string {
        // thay token chuẩn {z}/{x}/{y}
        let url = this.vectorSourceUrl
            .replace('{z}', String(z))
            .replace('{x}', String(x))
            .replace('{y}', String(y));
        // nếu template dùng {ratio} hoặc {r} thì strip (tuỳ server)
        url = url.replace('{ratio}', '1').replace('{r}', '');
        return url;
    }
}
