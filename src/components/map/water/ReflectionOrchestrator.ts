import * as THREE from 'three';
import maplibregl, {MapMouseEvent,} from 'maplibre-gl';
import type {CustomLayerInterface, Map} from 'maplibre-gl';
import type {ReflectionCasterLayer} from '../Interface';
import {WaterRenderTarget} from './WaterRenderTarget';
import {getSharedRenderer} from '../SharedRenderer';
import { getSharedReflectionPass, ReflectionPass } from './ReflectionPass';

/**
 * ReflectionOrchestrator is a maplibre custom layer that renders
 * a planar reflection pass for water surfaces.
 *
 * Similar to ShadowOrchestrator: added before water layers so that
 * all registered casters render their reflected geometry into a shared
 * reflection render target. The water layer then samples this texture.
 */
export class ReflectionOrchestrator implements CustomLayerInterface {
    readonly id: string;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;

    private map: Map | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private readonly renderTarget: WaterRenderTarget;
    private readonly casters: ReflectionCasterLayer[] = [];
    private reflectionPass : ReflectionPass | null = null; 
    private reflectionMatrix = new THREE.Matrix4().set(
        1, 0,  0, 0,
        0, 1,  0, 0,
        0, 0, -1, 0,
        0, 0,  0, 1
    );
    private isClick : boolean = false; 
    /** Water plane height in world units (Z = 0 by default) */
    private waterPlaneZ: number = 0;

    constructor(id: string, size: number = 1024) {
        this.id = id;
        this.renderTarget = new WaterRenderTarget(size);
    }

    onAdd(map: Map, gl: WebGLRenderingContext): void {
        this.map = map;
        this.renderer = getSharedRenderer(map.getCanvas(), gl);
        const canvas = this.map.getCanvas(); 
        this.reflectionPass = getSharedReflectionPass(canvas.width * 0.5,canvas.height * 0.5); 
        map.on('click', this.handleClick);
    }

    private handleClick = (e: MapMouseEvent) => {
        this.isClick = true; 
    };

    onRemove(): void {
        this.map = null;
        this.renderer = null;
    }

    register(layer: ReflectionCasterLayer): void {
        if (!this.casters.find(c => c.id === layer.id)) {
            this.casters.push(layer);
        }
    }

    unregister(layerId: string): void {
        const idx = this.casters.findIndex(c => c.id === layerId);
        if (idx >= 0) this.casters.splice(idx, 1);
    }

    setWaterPlaneZ(z: number): void {
        this.waterPlaneZ = z;
    }

    getRenderTarget(): WaterRenderTarget {
        return this.renderTarget;
    }

    getReflectionTexture(): THREE.Texture {
        return this.renderTarget.getTexture();
    }

    /**
     * Build the reflection matrix: mirrors the camera across Z = waterPlaneZ.
     * This creates a scale(1,1,-1) translated to the water plane.
     */
    private calcReflectionMatrix(): void {
        const m = this.reflectionMatrix.elements;
        // Mirror across Z = waterPlaneZ
        // Reflection matrix for plane Z = d:
        //  1  0  0  0
        //  0  1  0  0
        //  0  0 -1  2d
        //  0  0  0  1
        m[0] = 1; m[4] = 0; m[8]  = 0; m[12] = 0;
        m[1] = 0; m[5] = 1; m[9]  = 0; m[13] = 0;
        m[2] = 0; m[6] = 0; m[10] = -1; m[14] = 2 * this.waterPlaneZ;
        m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
    }

    prerender(): void {
        // no-op: wait for all layers' prerender to populate tiles
    }

    render(): void {
        if (!this.map || !this.renderer || this.casters.length === 0 || !this.reflectionPass) return;
        const tr = (this.map as any).transform;

        this.reflectionPass.clearReflection(this.renderer); 
        // // 4. Render reflected scene from all registered casters
        for (const caster of this.casters) {
             if (!caster.visible) continue;
            caster.renderReflection(this.renderer, this.reflectionMatrix, tr.worldSize);
        }
        // // 6. Reset WebGL state
        this.renderer.resetState();
        // if(this.isClick){
        //     this.renderTarget.exportTexture(this.renderer,'d'); 
        //     this.isClick = false; 
        // }
    }

    resizeReflectionMap(size: number): void {
        this.renderTarget.resize(size);
    }

    dispose(): void {
        this.renderTarget.dispose();
    }
}
