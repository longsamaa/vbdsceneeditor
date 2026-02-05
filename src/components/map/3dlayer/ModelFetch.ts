import {downloadModel, prepareModelForRender} from "../model/objModel.ts";
import * as THREE from "three";
import type {ModelCacheEntry} from "./ThreeDLayer.ts";


export class ModelFetch {
    private active = 0;
    private queue: (() => void)[] = [];
    private MAX = 6;
    constructor(max : number) {
        this.MAX = max;
    }
    private getExtFromUrl(url: string) {
        const clean = url.split('?')[0].split('#')[0];
        return clean.slice(clean.lastIndexOf('.') + 1).toLowerCase();
    }

    private createNullObject3D(): THREE.Object3D {
        const obj = new THREE.Object3D();
        obj.name = '__NULL_MODEL__';
        obj.visible = false;
        obj.matrixAutoUpdate = false;
        obj.userData.isNull = true;
        return obj;
    }


    fetch(modelUrl : string,
          textureUrl : string,
          entry : ModelCacheEntry,
          cb: (err: Error | null, obj?: THREE.Object3D) => void) {
        this.queue.push(() => {
            this.active++;
            if(modelUrl.length === 0){
                const err = new Error('Empty modelUrl');
                entry.object3d = this.createNullObject3D();
                entry.stateDownload = 'loaded';
                this.active--;
                cb(err);
                this.run();
                return;
            }
            const extFile = this.getExtFromUrl(modelUrl);
            if(extFile === 'glb'){
                console.log('load glb');
            } else {
                downloadModel(modelUrl)
                    .then(async (obj3d) => {
                        prepareModelForRender(obj3d as THREE.Object3D);
                        obj3d.matrixAutoUpdate = false;
                        if(!(textureUrl.length === 0)){
                            const textureLoader = new THREE.TextureLoader();
                            const texture = await textureLoader.loadAsync(textureUrl).catch((err) => {
                                throw err;
                            });
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
                        }
                        entry.object3d = obj3d;
                        entry.stateDownload = 'loaded';
                        return obj3d;
                    })
                    .then(obj3d => cb(null,obj3d))
                    .catch((err) => {
                        //error cung tinh la loaded
                        entry.object3d = this.createNullObject3D();
                        entry.stateDownload = 'loaded';
                        cb(err);
                        return null;
                    })
                    .finally(()=> {
                        this.active--;
                        this.run();
                    });
            }
        });
        this.run();
    }
    private run() {
        if (this.active >= this.MAX) return;
        const job = this.queue.shift();
        job?.();
    }
}
