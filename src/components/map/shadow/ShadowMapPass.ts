import * as THREE from 'three';
import {ShadowDepthMaterial} from './ShadowLitMaterial';
import {ShadowRenderTarget} from './ShadowRenderTarget';
import {calculateTileMatrixThree, createShadowMapMatrixOrtho} from './ShadowCamera';
import {projectToWorldCoordinates} from '../convert/map_convert';
import {calculateSunDirectionMaplibre, getSunPosition, getTimeOfDayColors, type TimeOfDayColors} from './ShadowHelper';
import type {OverscaledTileID} from 'maplibre-gl';
import type {SunOptions} from '../Interface';

export class ShadowMapPass {
    readonly camera = new THREE.Camera();
    readonly depthMat = new ShadowDepthMaterial();
    readonly lightMatrices = new Map<string, THREE.Matrix4>();
    shadowMatrix = new THREE.Matrix4();
    /** Normalized sun direction vector (computed from altitude/azimuth) */
    readonly sunDir = new THREE.Vector3(0.5, 0.5, 0.5).normalize();
    /** Sun configuration */
    sun: SunOptions = { altitude: 45, azimuth: 315, shadow: true, lat: null, lon: null };
    /** Time-of-day lighting colors (updated each frame in calShadowMatrix) */
    timeOfDayColors: TimeOfDayColors = getTimeOfDayColors(45);
    private readonly _tmpMatrix = new THREE.Matrix4();
    private readonly renderTarget: ShadowRenderTarget;
    private layerOrder : string[] = [];
    constructor(shadowSize: number = 8192) {
        this.renderTarget = new ShadowRenderTarget(shadowSize);
    }

    getRenderTarget(): THREE.WebGLRenderTarget {
        return this.renderTarget.getRenderTarget();
    }

    getShadowRenderTarget(): ShadowRenderTarget {
        return this.renderTarget;
    }
    

    setSunOptions(options: SunOptions): void {
        this.sun = { ...options };
    }

    calShadowMatrix(tr: any): void {
        // Recalculate sun position based on current map center
        // const sunPos = getSunPosition(tr.center.lat, tr.center.lng);
        // this.sun.altitude = sunPos.altitude;
        // this.sun.azimuth = sunPos.azimuth;

        const { altitude, azimuth } = this.sun;
        // Update time-of-day colors
        this.timeOfDayColors = getTimeOfDayColors(altitude);
        // Update sun direction from altitude/azimuth
        calculateSunDirectionMaplibre(
            THREE.MathUtils.degToRad(altitude),
            THREE.MathUtils.degToRad(azimuth),
            this.sunDir,
        );

        const point = projectToWorldCoordinates(tr.worldSize, {
            lat: tr.center.lat,
            lon: tr.center.lng,
        });
        // Dùng cameraToCenterDistance để tính shadow frustum size — không phụ thuộc window size
        const shadowExtent = tr.cameraToCenterDistance * 3;
        const shadowW = shadowExtent;
        const shadowH = shadowExtent;
        const shadowFar = tr.cameraToCenterDistance * 5;
        const shadowNear = 1.0;
        const shadowDistance = tr.cameraToCenterDistance * 2;

        // Snap shadow frustum center theo texel grid để tránh shimmer khi pan
        const shadowSize = this.renderTarget.getRenderTarget().width;
        const texelSize = shadowExtent / shadowSize;
        const snappedX = Math.floor(point.x / texelSize) * texelSize;
        const snappedY = Math.floor(point.y / texelSize) * texelSize;

        this.shadowMatrix = createShadowMapMatrixOrtho(
            snappedX,
            snappedY,
            tr.pixelsPerMeter,
            shadowW,
            shadowH,
            shadowNear,
            shadowFar,
            shadowDistance,
            azimuth - 180,
            90 - altitude,
            0,
            {x: 0, y: 0},
            0,
        );
    }

    addNewLayer(id : string) {
        this.layerOrder.push(id); 
    }

    pushLayerFront(id: string): void {
        this.layerOrder.unshift(id);
    }

    pushLayerBack(id: string): void {
        this.layerOrder.push(id);
    }

    shadowPass(
        renderer: THREE.WebGLRenderer,
        visibleTiles: OverscaledTileID[],
        worldSize: number,
        tileKey: (tile: OverscaledTileID) => string,
        getScene: (key: string) => THREE.Scene | undefined,
        layerID: string,
    ): void {
        if (this.layerOrder[0] === layerID) {
            this.renderTarget.clearShadowTarget(renderer);
            this.lightMatrices.clear();
        }
        if (visibleTiles.length === 0) return;
        this.renderTarget.beginRenderShadowPass(renderer);
        for (const tile of visibleTiles) {
            const key = tileKey(tile);
            const scene = getScene(key);
            if (!scene) continue;
            const mat = calculateTileMatrixThree(tile.toUnwrapped(), worldSize);
            let lightMatrix = this.lightMatrices.get(key);
            if(!lightMatrix){
                lightMatrix = this._tmpMatrix.multiplyMatrices(this.shadowMatrix, mat).clone();
                this.lightMatrices.set(key, lightMatrix);
            }
            this.depthMat.uniforms.lightMatrix.value = lightMatrix;
            scene.overrideMaterial = this.depthMat;
            scene.traverse(obj => {
                if (obj instanceof THREE.Mesh) obj.frustumCulled = false;
            });
            renderer.render(scene, this.camera);
            scene.traverse(obj => {
                if (obj instanceof THREE.Mesh) obj.frustumCulled = true;
            });
            scene.overrideMaterial = null;
        }
        this.renderTarget.endRenderShadowPass(renderer);
    }

    /** Clear shadow map and light matrices - called once per frame by orchestrator */
    clearShadow(renderer: THREE.WebGLRenderer): void {
        this.renderTarget.clearShadowTarget(renderer);
        this.lightMatrices.clear();
    }

    /** Render shadow depth without clearing (orchestrator already cleared) */
    shadowPassNoClear(
        renderer: THREE.WebGLRenderer,
        visibleTiles: OverscaledTileID[],
        worldSize: number,
        tileKey: (tile: OverscaledTileID) => string,
        getScene: (key: string) => THREE.Scene | undefined,
    ): void {
        if (visibleTiles.length === 0) return;
        this.renderTarget.beginRenderShadowPass(renderer);
        for (const tile of visibleTiles) {
            const key = tileKey(tile);
            const scene = getScene(key);
            if (!scene) continue;
            const mat = calculateTileMatrixThree(tile.toUnwrapped(), worldSize);
            let lightMatrix = this.lightMatrices.get(key);
            if (!lightMatrix) {
                lightMatrix = this._tmpMatrix.multiplyMatrices(this.shadowMatrix, mat).clone();
                this.lightMatrices.set(key, lightMatrix);
            }
            this.depthMat.uniforms.lightMatrix.value = lightMatrix;
            scene.overrideMaterial = this.depthMat;
            scene.traverse(obj => {
                if (obj instanceof THREE.Mesh) obj.frustumCulled = false;
            });
            renderer.render(scene, this.camera);
            scene.traverse(obj => {
                if (obj instanceof THREE.Mesh) obj.frustumCulled = true;
            });
            scene.overrideMaterial = null;
        }
        this.renderTarget.endRenderShadowPass(renderer);
    }

    resizeShadowMap(size: number): void {
        this.renderTarget.resize(size);
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

