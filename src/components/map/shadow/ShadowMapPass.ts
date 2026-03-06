import * as THREE from 'three';
import {ShadowDepthMaterial} from './ShadowLitMaterial';
import {ShadowRenderTarget} from './ShadowRenderTarget';
import {calculateTileMatrixThree, createShadowMapMatrixOrtho} from './ShadowCamera';
import {projectToWorldCoordinates} from '../convert/map_convert';
import type {OverscaledTileID} from 'maplibre-gl';

export class ShadowMapPass {
    readonly camera = new THREE.Camera();
    readonly depthMat = new ShadowDepthMaterial();
    readonly lightMatrices = new Map<string, THREE.Matrix4>();
    shadowMatrix = new THREE.Matrix4();
    private readonly _tmpMatrix = new THREE.Matrix4();
    private readonly renderTarget: ShadowRenderTarget;

    constructor(shadowSize: number = 8192) {
        this.renderTarget = new ShadowRenderTarget(shadowSize);
    }

    getRenderTarget(): THREE.WebGLRenderTarget {
        return this.renderTarget.getRenderTarget();
    }

    getShadowRenderTarget(): ShadowRenderTarget {
        return this.renderTarget;
    }

    calShadowMatrix(tr: any, sunAltitude: number, sunAzimuth: number): void {
        const point = projectToWorldCoordinates(tr.worldSize, {
            lat: tr.center.lat,
            lon: tr.center.lng,
        });
        const shadowW = tr.width * 3;
        const shadowH = tr.height * 3;
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
            sunAzimuth - 180,
            90 - sunAltitude,
            0,
            {x: 0, y: 0},
            0,
        );
    }

    shadowPass(
        renderer: THREE.WebGLRenderer,
        visibleTiles: OverscaledTileID[],
        worldSize: number,
        tileKey: (tile: OverscaledTileID) => string,
        getScene: (key: string) => THREE.Scene | undefined,
    ): void {
        this.lightMatrices.clear();
        this.renderTarget.beginRenderShadowPass(renderer);
        for (const tile of visibleTiles) {
            const key = tileKey(tile);
            const scene = getScene(key);
            if (!scene) continue;
            const mat = calculateTileMatrixThree(tile.toUnwrapped(), worldSize);
            const lightMatrix = this._tmpMatrix.multiplyMatrices(this.shadowMatrix, mat).clone();
            this.depthMat.uniforms.lightMatrix.value = lightMatrix;
            scene.overrideMaterial = this.depthMat;
            renderer.render(scene, this.camera);
            scene.overrideMaterial = null;
            this.lightMatrices.set(key, lightMatrix);
        }
        this.renderTarget.endRenderShadowPass(renderer);
    }

    dispose(): void {
        this.renderTarget.dispose();
    }
}

let sharedShadowMapPass : ShadowMapPass | null = null; 

export function getSharedShadowPass(shadowSize: number = 8192) {
    if(!sharedShadowMapPass) { 
        sharedShadowMapPass = new ShadowMapPass(shadowSize); 
    }
    return sharedShadowMapPass; 
}

