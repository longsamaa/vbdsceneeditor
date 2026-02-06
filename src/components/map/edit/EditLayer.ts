import maplibregl, {MapMouseEvent, OverscaledTileID,} from 'maplibre-gl';
import {createLightGroup, prepareModelForRender, transformModel} from '../model/objModel.ts';
import {clampZoom, getMetersPerExtentUnit, latlonToLocal} from '../convert/map_convert.ts';
import type {
    Custom3DTileRenderLayer,
    LightGroup,
    LightGroupOption,
    ModelData,
    ObjectInfo,
    PickHit,
    ShadowUserData,
    SunOptions,
    SunParamater,
    UserData
} from '../Interface.ts'
import * as THREE from 'three';
import {MaplibreShadowMesh} from "../shadow/ShadowGeometry.ts";
import {calculateSunDirectionMaplibre} from "../shadow/ShadowHelper.ts";

export type EditorLayerOpts = {
    id: string;
    applyGlobeMatrix: boolean;
    editorLevel: number;
    sun?: SunOptions;
}
export type ObjectDefine = {
    id: string;
    modeldata: ModelData;
}
export type DataTileInfoForEditorLayer = {
    objects: Array<ObjectInfo>;
    sceneTile: THREE.Scene;
}

export class EditLayer implements Custom3DTileRenderLayer {
    id: string;
    editorLevel: number = 16;
    visible : boolean = true;
    onPick?: (info: PickHit) => void;
    onPickfail?: () => void;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;
    tileSize: number = 512;
    private clock: THREE.Clock | null = null;
    private sun: SunParamater | null | undefined;
    private map: maplibregl.Map | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private camera: THREE.Camera | null = null;
    private raycaster = new THREE.Raycaster();
    private modelCache: Map<string, ModelData> = new Map<string, ModelData>();
    private tileCache: Map<string, DataTileInfoForEditorLayer> = new Map<string, DataTileInfoForEditorLayer>();
    private applyGlobeMatrix: boolean | false = false;
    private light: LightGroup | null = null;
    private currentScene: THREE.Scene | null = null;

    constructor(opts: EditorLayerOpts & { onPick?: (info: PickHit) => void } & { onPickfail?: () => void }) {
        this.id = opts.id;
        this.editorLevel = opts.editorLevel;
        this.applyGlobeMatrix = opts.applyGlobeMatrix;
        this.onPick = opts.onPick;
        this.onPickfail = opts.onPickfail;
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

    setSunPos(altitude: number, azimuth: number, shadow: boolean = true): void {
        this.sun = {
            altitude: altitude,
            azimuth: azimuth,
            sun_dir: calculateSunDirectionMaplibre(THREE.MathUtils.degToRad(altitude),
                THREE.MathUtils.degToRad(azimuth)),
            shadow: shadow
        }
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
        this.clock = new THREE.Clock();
        this.renderer.autoClear = false;
        this.renderer.localClippingEnabled = true;
        map.on('click', this.handleClick);
    }

    onRemove(): void {
        this.renderer?.dispose();
        this.renderer = null;
        this.camera = null;
        this.map = null;
    }

    private tileKey(x: number, y: number, z: number): string {
        return `${z}/${x}/${y}`;
    }

    addObjectsToCache(objects: ObjectDefine[]): void {
        for (const data of objects) {
            const id = data.id;
            const modelData = data.modeldata;
            if (!this.modelCache.has(id)) {
                const obj3d = modelData.object3d;
                prepareModelForRender(obj3d as THREE.Object3D, false);
                this.modelCache.set(id, modelData);
            }
        }
    }
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
        this.map.triggerRepaint();
    };

    private getTileData(key: string): DataTileInfoForEditorLayer {
        let tileData = this.tileCache.get(key);
        if (!tileData) {
            //create new scene for tile
            const scene = new THREE.Scene();
            const objects: Array<ObjectInfo> = [];
            tileData = {
                objects: objects,
                sceneTile: scene,
            }
            this.tileCache.set(key, tileData);
        }
        return tileData;
    }

    render(): void {
        if (!this.map || !this.camera || !this.renderer || !this.visible || !this.light) {
            return;
        }
        this.renderer.clearStencil();
        const zoom = clampZoom(this.editorLevel,
            this.editorLevel,
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
            if (!tileInfo) continue;
            if (!tileInfo.sceneTile) continue;
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
                const delta = this.clock?.getDelta();
                if (delta) {
                    this.animate(tileInfo, delta);
                }
                this.renderer.resetState();
                this.renderer.render(tileInfo.sceneTile, this.camera);
            }
        }
    }

    addObjectToScene(id: string, lat : number, lon : number, default_scale: number = 1): void {
        if (!this.map || !this.modelCache) {
            return;
        }
        const model_data = this.modelCache.get(id);
        if (!model_data) {
            return;
        }
        const root_obj = model_data.object3d;
        if (!root_obj) return;
        const center = this.map.getCenter();
        const local = latlonToLocal(lon, lat, this.editorLevel);
        const key = this.tileKey(local.tileX, local.tileY, local.tileZ);
        const tileData = this.getTileData(key);
        const cloneObj3d = root_obj.clone(true);
        cloneObj3d.name = id;
        //cal scale
        const scaleUnit = getMetersPerExtentUnit(center.lat, this.editorLevel)
        const bearing = 0;
        const objectScale = default_scale;
        transformModel(local.coordX,
            local.coordY,
            0,
            bearing,
            objectScale,
            scaleUnit,
            cloneObj3d);
        const main_scene = tileData.sceneTile;
        let mixer: THREE.AnimationMixer | null = null;
        let actions: THREE.AnimationAction[] | null = null;
        const userData : UserData = {
            tile : {z: this.editorLevel, x: local.tileX, y: local.tileY},
            isModelRoot : true,
            scaleUnit,
            mixer
        }
        cloneObj3d.userData = userData;
        if (!actions) actions = [];
        if (model_data.animations && model_data.animations.length > 0) {
            mixer = new THREE.AnimationMixer(cloneObj3d);
            model_data.animations.forEach((clip) => {
                const action = mixer?.clipAction(clip);
                if (action) {
                    action.reset();
                    action.setLoop(THREE.LoopRepeat, Infinity);
                    action.play();
                    actions.push(action);
                }
            });
        }
        tileData.objects.push({
            id: "",
            name: "",
            object3d: cloneObj3d,
            textureUrl: "",
            textureName: "",
            modelName: "",
            modelUrl: "",
            mixer,
            actions,
            animations: model_data.animations ?? [],
        });
        cloneObj3d.traverse((child: THREE.Object3D) => {
            if (child instanceof THREE.Mesh) {
                const object_shadow = new MaplibreShadowMesh(child);
                const shadow_user_data : ShadowUserData = {
                    scale_unit : scaleUnit,
                }
                object_shadow.userData = shadow_user_data;
                object_shadow.matrixAutoUpdate = false;
                main_scene.add(object_shadow);
            }
        });
        main_scene.add(cloneObj3d);
        this.map?.triggerRepaint();
    }

    animate(data_tile_info: DataTileInfoForEditorLayer, delta: number): void {
        //for toan bo object de request animation
        data_tile_info.objects.forEach((obj) => {
            const mixer = obj.mixer;
            if (mixer) {
                mixer.update(delta);
            }
        });
        this.map?.triggerRepaint();
    }

    private updateShadow(scene: THREE.Scene) {
        const sun_dir = this.sun?.sun_dir;
        if (!sun_dir) {
            return;
        }
        scene.traverse((child) => {
            if (child instanceof MaplibreShadowMesh) {
                const shadow_scale_z = child.userData.scale_unit;
                (child as MaplibreShadowMesh).update(sun_dir.x, sun_dir.y, -sun_dir.z / shadow_scale_z);
            }
        });
    }
}