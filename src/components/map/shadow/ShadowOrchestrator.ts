import * as THREE from 'three';
import type {CustomLayerInterface, Map} from 'maplibre-gl';
import type {ShadowCasterLayer} from '../Interface';
import {getSharedShadowPass, ShadowMapPass} from './ShadowMapPass';
import {getSharedRenderer} from '../SharedRenderer';

/**
 * ShadowOrchestrator is a maplibre custom layer added FIRST.
 * All layers' prerender() runs first (populating tiles), then
 * orchestrator's render() runs shadow passes for all registered casters,
 * followed by each layer's render() which only does mainPass.
 */
export class ShadowOrchestrator implements CustomLayerInterface {
    readonly id: string;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;

    private map: Map | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private shadowMapPass: ShadowMapPass | null = null;
    private readonly casters: ShadowCasterLayer[] = [];

    constructor(id: string) {
        this.id = id;
    }

    onAdd(map: Map, gl: WebGLRenderingContext): void {
        this.map = map;
        this.renderer = getSharedRenderer(map.getCanvas(), gl);
        this.shadowMapPass = getSharedShadowPass(8192);
    }

    onRemove(): void {
        this.map = null;
        this.renderer = null;
    }

    register(layer: ShadowCasterLayer): void {
        if (!this.casters.find(c => c.id === layer.id)) {
            this.casters.push(layer);
        }
    }

    unregister(layerId: string): void {
        const idx = this.casters.findIndex(c => c.id === layerId);
        if (idx >= 0) this.casters.splice(idx, 1);
    }

    prerender(): void {
        // no-op: wait for all layers' prerender to populate tiles
    }

    render(): void {
        if (!this.map || !this.renderer || !this.shadowMapPass) return;

        const tr = (this.map as any).transform;

        // 1. Calculate shadow matrix once per frame (reads sun from shadowMapPass.sun)
        this.shadowMapPass.calShadowMatrix(tr);

        // 2. Clear shadow map once
        this.shadowMapPass.clearShadow(this.renderer);

        // 3. Render depth from all registered casters
        for (const caster of this.casters) {
            if (!caster.visible) continue;
            caster.renderShadowDepth(this.renderer, tr.worldSize);
        }
    }
}
