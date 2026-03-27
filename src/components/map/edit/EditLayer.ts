import maplibregl, { MapMouseEvent, OverscaledTileID, } from 'maplibre-gl';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { applyShadowLitMaterial, decomposeObject, parseUrl, prepareModelForRender, transformModel } from '../model/objModel.ts';
import { ShadowLitMaterial } from '../shadow/ShadowLitMaterial.ts';
import { clampZoom, getMetersPerExtentUnit, latlonToLocal } from '../convert/map_convert.ts';
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
import { getSharedRenderer } from "../SharedRenderer.ts";
import { getSharedReflectionPass, ReflectionPass } from '../water/ReflectionPass.ts';

export type PrimitiveType = 'box' | 'cylinder' | 'gable-roof';

export type EditorLayerOpts = {
    id: string;
    applyGlobeMatrix: boolean;
    editorLevel: number;

}
export type ObjectDefine = {
    url: string;
    assetId?: string;
    modeldata: ModelData;
    modelType?: string;
}
export interface EditorModelData extends ModelData {
    modelUrl: string;
    modelName: string;
    modelExtension: string;
}

export type EditLayerObjectSnapshot = {
    instanceId: string;
    name: string;
    modelType: string | null;
    coords: { lat: number; lng: number } | null;
    tile: { z: number; x: number; y: number };
    scaleUnit: number;
    transform: {
        position: [number, number, number];
        rotation: [number, number, number];
        scale: [number, number, number];
    };
}

type AddObjectToSceneOptions = {
    instanceId?: string;
    name?: string;
    initialState?: {
        tile: { z: number; x: number; y: number };
        scaleUnit: number;
        transform: {
            position: [number, number, number];
            rotation: [number, number, number];
            scale: [number, number, number];
        };
        coords?: { lat: number; lng: number } | null;
    };
}

export type DataTileInfoForEditorLayer = {
    sceneTile: THREE.Scene;
    shadowLitMaterials: ShadowLitMaterial[];
    shadowMaterials: ShadowPair[];
}

export class EditLayer implements Custom3DTileRenderLayer, ShadowCasterLayer, ReflectionCasterLayer {
    id: string;
    editorLevel: number = 16;
    visible: boolean = true;
    onPick?: (info: PickHit) => void;
    onPickfail?: () => void;
    pickEnabled: boolean = true;
    layerSourceCastShadow: Custom3DTileRenderLayer | null = null;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;
    tileSize: number = 512;
    private clock: THREE.Clock | null = null;

    private map: maplibregl.Map | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private camera: THREE.Camera | null = null;
    private raycaster = new THREE.Raycaster();
    private modelCache: Map<string, EditorModelData> = new Map<string, EditorModelData>();
    private tileCache: Map<string, DataTileInfoForEditorLayer> = new Map<string, DataTileInfoForEditorLayer>();
    private textureCache: Map<string, THREE.Texture> = new Map<string, THREE.Texture>();
    private applyGlobeMatrix: boolean | false = false;
    private readonly _tmpLightDir = new THREE.Vector3();
    private shadowMapPass: ShadowMapPass | null = null;
    private reflectionPass: ReflectionPass | null = null;
    private _visibleTiles: OverscaledTileID[] = [];
    useOrchestrator = false;

    constructor(opts: EditorLayerOpts & { onPick?: (info: PickHit) => void } & { onPickfail?: () => void }) {
        this.id = opts.id;
        this.editorLevel = opts.editorLevel;
        this.applyGlobeMatrix = opts.applyGlobeMatrix;
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

    onAdd(map: maplibregl.Map, gl: WebGLRenderingContext): void {
        this.map = map;
        this.camera = new THREE.Camera();
        this.camera.matrixAutoUpdate = false;
        this.renderer = getSharedRenderer(map.getCanvas(), gl);
        if (!this.shadowMapPass) {
            this.shadowMapPass = getSharedShadowPass(8192);
        }
        this.clock = new THREE.Clock();
        const canvas = map.getCanvas();
        if (!this.reflectionPass) {
            this.reflectionPass = getSharedReflectionPass(canvas.width * 0.5, canvas.height * 0.5);
        }
        map.on('click', this.handleClick);
    }

    onRemove(): void {
        this.renderer = null;
        this.camera = null;
        this.map = null;
    }

    private tileKey(x: number, y: number, z: number): string {
        return `${z}/${x}/${y}`;
    }

    addObjectsToCache(objects: ObjectDefine[]): void {
        for (const data of objects) {
            const { fileName } = parseUrl(data.url);
            if (!this.modelCache.has(fileName)) {
                const obj3d = data.modeldata.object3d;
                prepareModelForRender(obj3d as THREE.Object3D, false);
                const id = data.assetId ? data.assetId : fileName;
                const { extension } = parseUrl(data.url);
                this.modelCache.set(id, {
                    ...data.modeldata,
                    modelUrl: data.url,
                    modelName: id,
                    modelExtension: data.modelType?.trim().toLowerCase() || extension,
                });
            }
        }
    }



    addTextureToCache(textureUrl: string): Promise<THREE.Texture> {
        const cached = this.textureCache.get(textureUrl);
        if (cached) return Promise.resolve(cached);
        return new Promise((resolve, reject) => {
            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(
                textureUrl,
                (texture) => {
                    texture.wrapS = THREE.RepeatWrapping;
                    texture.wrapT = THREE.RepeatWrapping;
                    this.textureCache.set(textureUrl, texture);
                    resolve(texture);
                },
                undefined,
                (err) => reject(err),
            );
        });
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
        if (!this.map || !this.shadowMapPass || !this.renderer) return;
        // Populate _visibleTiles early so orchestrator can use them in its prerender
        const zoom = clampZoom(this.editorLevel, this.editorLevel, Math.round(this.map.getZoom()));
        this._visibleTiles = this.map.coveringTiles({
            tileSize: this.tileSize,
            minzoom: zoom,
            maxzoom: zoom,
            roundZoom: true,
        });
        if (!this.useOrchestrator) {
            const tr = this.map.transform;
            this.shadowMapPass.calShadowMatrix(tr);
        }
    }

    renderReflection(renderer: THREE.WebGLRenderer, reflectionMatrix: THREE.Matrix4, worldSize: number): void {
        if (!this.reflectionPass || !this.renderer || !this.map) return;
        const tr = this.map.transform;
        const tilesWithShadow: DataTileInfoForEditorLayer[] = [];
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
        const tilesWithShadow: DataTileInfoForEditorLayer[] = [];
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
        const tilesWithShadow: DataTileInfoForEditorLayer[] = [];
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
                this.updateShadowLitMaterials(tileInfo, tile_key);
                //this.updateShadow(tileInfo.sceneTile);
                const delta = this.clock?.getDelta();
                if (delta) {
                    this.animate(tileInfo, delta);
                }
                this.renderer.render(tileInfo.sceneTile, this.camera);
            }
        }
    }

    render(): void {
        if (!this.map || !this.renderer || !this.visible) return;
        const zoom = clampZoom(this.editorLevel,
            this.editorLevel,
            Math.round(this.map.getZoom()));
        this._visibleTiles = this.map.coveringTiles({
            tileSize: this.tileSize,
            minzoom: zoom,
            maxzoom: zoom,
            roundZoom: true,
        });
        const tr = this.map.transform;
        if (!this.useOrchestrator) {
            this.shadowPass(tr, this._visibleTiles);
        }
        this.mainPass(tr, this._visibleTiles);
    }

    addObjectToScene(cacheId: string | null | undefined, lat: number, lon: number, default_scale: number = 1, options?: AddObjectToSceneOptions): void {
        if (!this.map || !this.modelCache || !cacheId) {
            return;
        }
        const model_data = this.modelCache.get(cacheId);
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
        const instanceId = options?.instanceId?.trim() || cacheId;
        const instanceName = options?.name?.trim() || instanceId;
        cloneObj3d.name = instanceName;
        //cal scale
        const scaleUnit = options?.initialState?.scaleUnit ?? getMetersPerExtentUnit(center.lat, this.editorLevel)
        const initialTransform = options?.initialState?.transform;
        if (initialTransform) {
            cloneObj3d.position.set(...initialTransform.position);
            cloneObj3d.rotation.set(...initialTransform.rotation);
            cloneObj3d.scale.set(...initialTransform.scale);
            cloneObj3d.updateMatrix();
            cloneObj3d.updateMatrixWorld(true);
        } else {
            const bearing = 0;
            const objectScale = default_scale;
            transformModel(local.coordX,
                local.coordY,
                0,
                bearing,
                objectScale,
                scaleUnit,
                cloneObj3d);
        }
        const main_scene = tileData.sceneTile;
        let mixer: THREE.AnimationMixer | null = null;
        const userData: UserData = {
            tile: options?.initialState?.tile ?? { z: this.editorLevel, x: local.tileX, y: local.tileY },
            isModelRoot: true,
            scaleUnit,
            mixer,
            id: instanceId,
            name: instanceName,
            modeltype: model_data.modelExtension,
            modelname: model_data.modelName,
            modelurl: model_data.modelUrl,
        }
        cloneObj3d.userData = userData;
        if (model_data.animations && model_data.animations.length > 0) {
            mixer = new THREE.AnimationMixer(cloneObj3d);
            model_data.animations.forEach((clip) => {
                const action = mixer?.clipAction(clip);
                if (action) {
                    action.reset();
                    action.setLoop(THREE.LoopRepeat, Infinity);
                    action.play();
                }
            });
            cloneObj3d.userData.mixer = mixer;
            cloneObj3d.userData.animations = model_data.animations;
        }
        cloneObj3d.traverse((child: THREE.Object3D) => {
            child.frustumCulled = false;
            if (child instanceof THREE.Mesh) {
                const shadowLitMats = applyShadowLitMaterial(child);
                tileData.shadowLitMaterials.push(...shadowLitMats);
                const object_shadow = new MaplibreShadowMesh(child);
                object_shadow.frustumCulled = false;
                const shadow_user_data: ShadowUserData = {
                    scale_unit: scaleUnit,
                    ownerId: instanceId,
                }
                object_shadow.userData = shadow_user_data;
                object_shadow.matrixAutoUpdate = false;
                tileData.shadowMaterials.push({
                    scaleUnit: scaleUnit,
                    shadowMesh: object_shadow,
                });
                main_scene.add(object_shadow);
            }
        });
        main_scene.add(cloneObj3d);
        this.map?.triggerRepaint();
    }

    addPrimitiveToScene(primitiveType: PrimitiveType, lat: number, lon: number, default_scale: number = 5): void {
        if (!this.map) return;
        const group = new THREE.Group();

        switch (primitiveType) {
            case 'box': {
                const geo = new THREE.BoxGeometry(1, 1, 1);
                const wallMat = new THREE.MeshStandardMaterial({ color: 'blue' });
                wallMat.name = 'wall';
                const topMat = new THREE.MeshStandardMaterial({ color: 'red' });
                topMat.name = 'top';
                const boxMaterials = [
                    wallMat,  // right
                    wallMat,  // left
                    topMat,   // top (mái nhà)
                    wallMat,  // bottom
                    wallMat,  // front
                    wallMat,  // back
                ];
                const mesh = new THREE.Mesh(geo, boxMaterials);
                mesh.position.y = 0.5;
                group.add(mesh);
                break;
            }
            case 'cylinder': {
                const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
                const cylWallMat = new THREE.MeshStandardMaterial({ color: 'blue' });
                cylWallMat.name = 'wall';
                const cylTopMat = new THREE.MeshStandardMaterial({ color: 'red' });
                cylTopMat.name = 'top';
                // CylinderGeometry groups: 0=side, 1=top, 2=bottom
                const cylMaterials = [cylWallMat, cylTopMat, cylWallMat];
                const mesh = new THREE.Mesh(geo, cylMaterials);
                mesh.position.y = 0.5;
                group.add(mesh);
                break;
            }
            case 'gable-roof': {
                // Base box
                const baseGeo = new THREE.BoxGeometry(1, 0.5, 1);
                const gableWallMat = new THREE.MeshStandardMaterial({ color: 'blue' });
                gableWallMat.name = 'wall';
                const gableTopMat = new THREE.MeshStandardMaterial({ color: 'red' });
                gableTopMat.name = 'top';
                const baseMaterials = [
                    gableWallMat, gableWallMat, gableTopMat,
                    gableWallMat, gableWallMat, gableWallMat,
                ];
                const baseMesh = new THREE.Mesh(baseGeo, baseMaterials);
                baseMesh.position.y = 0.25;
                group.add(baseMesh);
                // Roof prism using ExtrudeGeometry
                const roofShape = new THREE.Shape();
                roofShape.moveTo(-0.5, 0);
                roofShape.lineTo(0, 0.4);
                roofShape.lineTo(0.5, 0);
                roofShape.lineTo(-0.5, 0);
                const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 1, bevelEnabled: false });
                const roofMat = new THREE.MeshStandardMaterial({ color: 0xcc8855 });
                roofMat.name = 'top';
                const roofMesh = new THREE.Mesh(roofGeo, roofMat);
                roofMesh.position.set(0, 0.5, -0.5);
                group.add(roofMesh);
                break;
            }
            default:
                return;
        }

        prepareModelForRender(group, false);
        const instanceId = `${primitiveType}_${Date.now()}`;
        const center = this.map.getCenter();
        const local = latlonToLocal(lon, lat, this.editorLevel);
        const key = this.tileKey(local.tileX, local.tileY, local.tileZ);
        const tileData = this.getTileData(key);
        const scaleUnit = getMetersPerExtentUnit(center.lat, this.editorLevel);
        transformModel(local.coordX, local.coordY, 0, 0, default_scale, scaleUnit, group);

        const userData: UserData = {
            tile: { z: this.editorLevel, x: local.tileX, y: local.tileY },
            isModelRoot: true,
            scaleUnit,
            mixer: null,
            id: instanceId,
            name: primitiveType,
            modeltype: 'primitive',
            modelname: primitiveType,
            modelurl: '',
        };
        group.userData = userData;
        const main_scene = tileData.sceneTile;
        group.traverse((child: THREE.Object3D) => {
            child.frustumCulled = false;
            if (child instanceof THREE.Mesh) {
                const shadowLitMats = applyShadowLitMaterial(child);
                tileData.shadowLitMaterials.push(...shadowLitMats);
                const object_shadow = new MaplibreShadowMesh(child);
                object_shadow.frustumCulled = false;
                const shadow_user_data: ShadowUserData = {
                    scale_unit: scaleUnit,
                    ownerId: instanceId,
                };
                object_shadow.userData = shadow_user_data;
                object_shadow.matrixAutoUpdate = false;
                tileData.shadowMaterials.push({
                    scaleUnit,
                    shadowMesh: object_shadow,
                });
                main_scene.add(object_shadow);
            }
        });
        main_scene.add(group);
        this.map.triggerRepaint();
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

    removeObjectByInstanceId(instanceId: string): boolean {
        for (const [, tileData] of this.tileCache) {
            const root = tileData.sceneTile.children.find(
                (child) => child.userData?.isModelRoot && child.userData?.id === instanceId
            );
            if (!root) {
                continue;
            }
            const rootMaterials = new Set<THREE.Material>();
            root.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach((mat) => rootMaterials.add(mat));
                }
            });
            tileData.sceneTile.remove(root);
            const shadowMeshes = tileData.shadowMaterials
                .filter((pair) => pair.shadowMesh.userData?.ownerId === instanceId)
                .map((pair) => pair.shadowMesh);
            shadowMeshes.forEach((shadowMesh) => tileData.sceneTile.remove(shadowMesh));
            tileData.shadowMaterials = tileData.shadowMaterials.filter(
                (pair) => pair.shadowMesh.userData?.ownerId !== instanceId
            );
            tileData.shadowLitMaterials = tileData.shadowLitMaterials.filter(
                (mat) => !rootMaterials.has(mat as unknown as THREE.Material)
            );
            this.map?.triggerRepaint();
            return true;
        }
        return false;
    }

    getObjectSnapshots(): EditLayerObjectSnapshot[] {
        const snapshots: EditLayerObjectSnapshot[] = [];
        for (const [, tileData] of this.tileCache) {
            for (const child of tileData.sceneTile.children) {
                if (!child.userData?.isModelRoot) {
                    continue;
                }
                const userData = child.userData as UserData;
                const decomposed = decomposeObject(child);
                snapshots.push({
                    instanceId: userData.id ?? child.name,
                    name: userData.name ?? child.name,
                    modelType: userData.modeltype ?? null,
                    coords: decomposed.latlon ? { lat: decomposed.latlon.lat, lng: decomposed.latlon.lon } : null,
                    tile: userData.tile,
                    scaleUnit: userData.scaleUnit,
                    transform: {
                        position: [child.position.x, child.position.y, child.position.z],
                        rotation: [child.rotation.x, child.rotation.y, child.rotation.z],
                        scale: [child.scale.x, child.scale.y, child.scale.z],
                    },
                });
            }
        }
        return snapshots;
    }

    findObjectInCache(tileX: number,
        tileY: number,
        tileZ: number,
        id: string | null | undefined): THREE.Object3D | null {
        if (!id) return null;
        const tile_key = this.tileKey(tileX, tileY, tileZ);
        const tileData = this.tileCache.get(tile_key);
        if (!tileData) return null;
        const scene = tileData.sceneTile;
        let found: THREE.Object3D | null = null;
        scene.traverse((child) => {
            if (!found && child.userData?.id === id) {
                found = child;
            }
        });
        return found;
    }

    bindTextureToObject(slot: string,
        userData: UserData | null | undefined,
        textureUrl: string | null,
    ): void {
        if (!userData) return;
        if (!textureUrl) return;
        const root = this.findObjectInCache(
            userData.tile.x,
            userData.tile.y,
            userData.tile.z,
            userData.id,
        );
        if (!root) return;
        this.addTextureToCache(textureUrl).then((texture) => {
            root.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) return;
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach((mat, idx) => {
                    if (mat instanceof ShadowLitMaterial && mat.name === slot) {
                        const tex = texture.clone();
                        tex.needsUpdate = true;
                        tex.wrapS = THREE.RepeatWrapping;
                        tex.wrapT = THREE.RepeatWrapping;
                        const scale = root.scale;
                        tex.repeat.set(scale.x, scale.y);
                        mat.uniforms.baseMap.value = tex;
                        mat.uniforms.hasBaseMap.value = 1;
                        mat.uniforms.baseColor.value.set(1, 1, 1);
                        mat.needsUpdate = true;
                        // Also update _originMat so export/restore keeps the texture
                        const originMats = child.userData._originMat;
                        if (Array.isArray(originMats) && originMats[idx] instanceof THREE.MeshStandardMaterial) {
                            originMats[idx].map = tex;
                            originMats[idx].color.set(1, 1, 1);
                            originMats[idx].needsUpdate = true;
                        }
                        else {
                            child.userData._originMat.map = tex;
                            child.userData._originMat.color.set(1, 1, 1);
                            child.userData._originMat.needsUpdate = true;
                        }
                    }
                })
            });
            this.map?.triggerRepaint();
        });
    }

    animate(data_tile_info: DataTileInfoForEditorLayer, delta: number): void {
        data_tile_info.sceneTile.children.forEach((child) => {
            if (child.userData?.isModelRoot && child.userData.mixer) {
                child.userData.mixer.update(delta);
            }
        });
        this.map?.triggerRepaint();
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

    /** Return tile keys and object list for UI tree view */
    getTileObjectTree(): Array<{ tileKey: string; objects: Array<{ name: string; id: string }> }> {
        const result: Array<{ tileKey: string; objects: Array<{ name: string; id: string }> }> = [];
        for (const [key, tileData] of this.tileCache) {
            const objs: Array<{ name: string; id: string }> = [];
            for (const child of tileData.sceneTile.children) {
                if (!child.userData?.isModelRoot) continue;
                objs.push({
                    name: child.userData.name ?? child.name ?? 'unnamed',
                    id: child.userData.id ?? '',
                });
            }
            if (objs.length > 0) {
                result.push({ tileKey: key, objects: objs });
            }
        }
        return result;
    }

    /** Get object3d by tile key and index for tree selection */
    getObjectByTileKeyAndIndex(tileKey: string, index: number): THREE.Object3D | null {
        const tileData = this.tileCache.get(tileKey);
        if (!tileData) return null;
        const roots = tileData.sceneTile.children.filter(c => c.userData?.isModelRoot);
        if (index < 0 || index >= roots.length) return null;
        return roots[index];
    }

    /** Find the OverscaledTileID for a given tile key from current visible tiles */
    getOverscaledTileID(tileKey: string): OverscaledTileID | null {
        for (const tile of this._visibleTiles) {
            const key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            if (key === tileKey) return tile;
        }
        return null;
    }

    private updateShadowLitMaterials(tileInfo: DataTileInfoForEditorLayer, tileKey: string) {
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

    export3DTileToBuffer(tileKey: string): Promise<ArrayBuffer | null> {
        const tile = this.tileCache.get(tileKey);
        if (!tile) return Promise.resolve(null);
        const scene = tile.sceneTile;
        if (!scene) return Promise.resolve(null);
        const shadowMeshes: MaplibreShadowMesh[] = [];
        scene.children.forEach((child) => {
            if (child instanceof MaplibreShadowMesh) shadowMeshes.push(child);
        });
        shadowMeshes.forEach((m) => scene.remove(m));
        const userDataCache = new Map<THREE.Object3D, Record<string, any>>();
        const materialCache = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
        const animations: THREE.AnimationClip[] = [];
        const colorCache = new Map<THREE.MeshStandardMaterial, THREE.Color>();
        scene.traverse((obj) => {
            userDataCache.set(obj, obj.userData);
            if (obj instanceof THREE.Mesh && obj.userData._originMat) {
                materialCache.set(obj, obj.material);
                obj.material = obj.userData._originMat;
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                for (const m of mats) {
                    if (m instanceof THREE.MeshStandardMaterial && m.map) {
                        colorCache.set(m, m.color.clone());
                        m.color.set(1, 1, 1);
                    }
                }
            }
            if (obj.userData?.animations) {
                (obj.userData.animations as THREE.AnimationClip[]).forEach((clip) => animations.push(clip));
            }
            obj.userData = {};
        });
        const restore = () => {
            userDataCache.forEach((data, obj) => { obj.userData = data; });
            materialCache.forEach((mat, mesh) => { mesh.material = mat; });
            colorCache.forEach((color, mat) => { mat.color.copy(color); });
            shadowMeshes.forEach((m) => scene.add(m));
        };
        return new Promise((resolve) => {
            const exporter = new GLTFExporter();
            exporter.parse(
                scene,
                (result) => {
                    restore();
                    if (result instanceof ArrayBuffer) {
                        resolve(result);
                    } else {
                        const json = JSON.stringify(result);
                        const encoder = new TextEncoder();
                        resolve(encoder.encode(json).buffer as ArrayBuffer);
                    }
                },
                (error) => {
                    console.error('Export to buffer error:', error);
                    restore();
                    resolve(null);
                },
                {
                    binary: true,
                    trs: false,
                    onlyVisible: true,
                    truncateDrawRange: true,
                    embedImages: true,
                    maxTextureSize: 1024,
                }
            );
        });
    }

    export3DTile(tileKey: string): void {
        const tile = this.tileCache.get(tileKey);
        if (!tile) return;
        const scene = tile.sceneTile;
        if (!scene) return;
        // Remove shadow meshes temporarily
        const shadowMeshes: MaplibreShadowMesh[] = [];
        scene.children.forEach((child) => {
            if (child instanceof MaplibreShadowMesh) shadowMeshes.push(child);
        });
        shadowMeshes.forEach((m) => scene.remove(m));
        // Restore original materials & cache userData before exporting
        const userDataCache = new Map<THREE.Object3D, Record<string, any>>();
        const materialCache = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
        const animations: THREE.AnimationClip[] = [];
        const colorCache = new Map<THREE.MeshStandardMaterial, THREE.Color>();
        scene.traverse((obj) => {
            userDataCache.set(obj, obj.userData);
            if (obj instanceof THREE.Mesh && obj.userData._originMat) {
                materialCache.set(obj, obj.material);
                obj.material = obj.userData._originMat;
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                for (const m of mats) {
                    if (m instanceof THREE.MeshStandardMaterial && m.map) {
                        colorCache.set(m, m.color.clone());
                        m.color.set(1, 1, 1);
                    }
                }
            }
            if (obj.userData?.animations) {
                (obj.userData.animations as THREE.AnimationClip[]).forEach((clip) => animations.push(clip));
            }
            obj.userData = {};
        });
        const restore = () => {
            userDataCache.forEach((data, obj) => { obj.userData = data; });
            materialCache.forEach((mat, mesh) => { mesh.material = mat; });
            colorCache.forEach((color, mat) => { mat.color.copy(color); });
            shadowMeshes.forEach((m) => scene.add(m));
        };

        const exporter = new GLTFExporter();
        exporter.parse(
            scene,
            function (result) {
                try {
                    const blob = result instanceof ArrayBuffer
                        ? new Blob([result], { type: 'application/octet-stream' })
                        : new Blob([JSON.stringify(result)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${tileKey}.${result instanceof ArrayBuffer ? 'glb' : 'gltf'}`;
                    a.click();
                    URL.revokeObjectURL(url);
                } catch (innerError) {
                    console.error('Error handling result:', innerError);
                } finally {
                    restore();
                }
            },
            function (error) {
                console.error('Export error (callback):', error);
                restore();
            },
            {
                binary: true,
                trs: false,
                onlyVisible: true,
                truncateDrawRange: true,
                embedImages: true,
                maxTextureSize: 1024,
            }
        );
    }
}
