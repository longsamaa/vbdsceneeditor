import * as THREE from 'three';
import {WaterRenderTarget} from './WaterRenderTarget'; 
import type { OverscaledTileID } from 'maplibre-gl';
import {ShadowLitMaterial} from '../shadow/ShadowLitMaterial'

export class ReflectionPass {
    readonly camera = new THREE.Camera(); 
    private readonly renderTarget: WaterRenderTarget;
    private reflectionMatrix = new THREE.Matrix4().set(
            1, 0,  0, 0,
            0, 1,  0, 0,
            0, 0, -1, 0,
            0, 0,  0, 1
        ); //default water reflection matrix because z always = 0
    private tmpMatrix = new THREE.Matrix4();  
    private finalMatrix = new THREE.Matrix4(); 
    constructor(width : number, height : number) {
        console.log(width,height); 
        this.renderTarget = new WaterRenderTarget(width,height); 
    }
    getRenderTarget() : WaterRenderTarget {
        return this.renderTarget; 
    }

    clearReflection(renderer: THREE.WebGLRenderer): void {
        this.renderTarget.clearReflectionTarget(renderer);
    }

    reflectionPass(
        renderer : THREE.WebGLRenderer,
        visibleTiles : OverscaledTileID[],
        worldSize : number,
        tileKey: (tile: OverscaledTileID) => string,
        getSceneAndShadowLitMats: (key: string) => { scene : THREE.Scene, shadowLitMats : ShadowLitMaterial[] } | undefined,
        tr : any,
    ) : void {
        if(visibleTiles.length === 0) return; 
        this.renderTarget.beginReflectionPass(renderer);
        //disable shadow map 
        for(const tile of visibleTiles) {
            //cal tile matrix refleciton here
            const key = tileKey(tile);
            const tileData = getSceneAndShadowLitMats(key);
            if(tileData?.shadowLitMats){
                for (const mat of tileData?.shadowLitMats) {
                    mat.enableShadowMap(false); 
                }
            }
            if(!tileData?.scene) continue; 
            const projectionData = tr.getProjectionData({
                overscaledTileID: tile,
                applyGlobeMatrix: false,
            }); 
            this.tmpMatrix = this.tmpMatrix.fromArray(projectionData.mainMatrix); 
            this.finalMatrix.multiplyMatrices(this.tmpMatrix,this.reflectionMatrix);
            this.camera.projectionMatrix = this.finalMatrix;
            renderer.render(tileData.scene,this.camera); 
            if(tileData?.shadowLitMats){
                for (const mat of tileData?.shadowLitMats) {
                    mat.enableShadowMap(false); 
                }
            }
        }
        //disale shadow map 
        this.renderTarget.endReflectionPass(renderer); 
    }

}

let sharedReflectionPass : ReflectionPass | null = null; 

export function getSharedReflectionPass(width : number, height : number) {
    if(!sharedReflectionPass){
        sharedReflectionPass = new ReflectionPass(width,height); 
    }
    return sharedReflectionPass; 
} 