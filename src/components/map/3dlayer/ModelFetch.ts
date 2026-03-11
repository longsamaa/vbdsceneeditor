import {downloadModel, loadModelFromGlb, prepareModelForRender} from "../model/objModel.ts";
import * as THREE from "three";
import {LRUCache} from 'lru-cache';
import type {ModelData} from "../Interface.ts";

export type ModelCacheEntry = ModelData & {
    stateDownload: 'downloading' | 'loaded' | 'disposed' | 'error';
};

export class ModelFetch {
    private active = 0;
    private queue: (() => void)[] = [];
    private MAX = 6;
    private rootUrl: string = '';
    private textureCache = new Map<string, THREE.Texture | null>();
    private textureLoader = new THREE.TextureLoader();
    private modelCache: LRUCache<string, ModelCacheEntry>;

    constructor(max: number, rootUrl: string = '', maxModelCache: number = 1024) {
        this.MAX = max;
        this.rootUrl = rootUrl;
        this.modelCache = new LRUCache<string, ModelCacheEntry>({
            max: maxModelCache,
            dispose: (model) => {
                if (model?.stateDownload === 'downloading') {
                    model.stateDownload = 'disposed';
                }
            },
        });
    }

    getModel(modelName: string): ModelCacheEntry | undefined {
        return this.modelCache.get(modelName);
    }

    clearModels(): void {
        this.modelCache.clear();
    }

    /**
     * Request a model by name. If not cached, starts download.
     * Returns the cache entry (may still be downloading).
     */
    request(modelName: string, modelUrl: string, textureUrl: string, modelType: string,
            cb: (err: Error | null, obj?: THREE.Object3D) => void): ModelCacheEntry {
        let entry = this.modelCache.get(modelName);
        if (entry) return entry;
        entry = {
            stateDownload: 'downloading',
            object3d: null,
            animations: null,
        };
        this.modelCache.set(modelName, entry);
        this.fetch(modelUrl, textureUrl, modelType, entry, cb);
        return entry;
    }

    private async loadTexture(url: string): Promise<THREE.Texture | null> {
        if (!url || url.length === 0) return null;
        if (this.textureCache.has(url)) return this.textureCache.get(url) ?? null;
        const timeoutMs = 1500;
        const texture = await Promise.race([
            this.textureLoader.loadAsync(url),
            new Promise<undefined>((_, reject) =>
                setTimeout(() => reject(new Error(`Texture timeout: ${url}`)), timeoutMs)
            )
        ]).catch(() => null);
        this.textureCache.set(url, texture ?? null);
        return texture ?? null;
    }

    private createNullObject3D(): THREE.Object3D {
        const obj = new THREE.Object3D();
        obj.name = '__NULL_MODEL__';
        obj.visible = false;
        obj.matrixAutoUpdate = false;
        obj.userData.isNull = true;
        return obj;
    }

    fetch(modelUrl: string,
          textureUrl: string,
          modelType: string,
          entry: ModelCacheEntry,
          cb: (err: Error | null, obj?: THREE.Object3D) => void) {
        this.queue.push(() => {
            this.active++;
            if (this.rootUrl) {
                if (modelUrl && !/^https?:\/\//.test(modelUrl)) modelUrl = this.rootUrl + modelUrl;
                if (textureUrl && !/^https?:\/\//.test(textureUrl)) textureUrl = this.rootUrl + textureUrl;
            }
            if(modelUrl.length === 0){
                const err = new Error('Empty modelUrl');
                entry.object3d = this.createNullObject3D();
                entry.stateDownload = 'loaded';
                this.active--;
                cb(err);
                this.run(); 
                return;
            }
            const loadFn = modelType === 'Object' ? downloadModel(modelUrl) : loadModelFromGlb(modelUrl);
            loadFn
                .then(async (modelData) => {
                    const obj3d = modelData.object3d as THREE.Object3D;
                     prepareModelForRender(obj3d,false);
                    obj3d.matrixAutoUpdate = false;
                    const texture = await this.loadTexture(textureUrl);
                    if(texture){
                        obj3d.traverse((child) => {
                            if (child instanceof THREE.Mesh) {
                                const mat = child.material;
                                if (mat) {
                                    mat.map = texture;
                                    mat.needsUpdate = true;
                                }
                            }
                        });
                    }
                    entry.object3d = obj3d;
                    entry.animations = modelData.animations ?? null;
                    entry.stateDownload = 'loaded';
                    return obj3d;
                })
                .then(obj3d => cb(null, obj3d))
                .catch((err) => {
                    entry.object3d = this.createNullObject3D();
                    entry.stateDownload = 'loaded';
                    cb(err);
                    return null;
                })
                .finally(()=> {
                    this.active--;
                    this.run();
                });
        });
        this.run();
    }

    private run() {
        if (this.active >= this.MAX) return;
        const job = this.queue.shift();
        job?.();
    }
}
