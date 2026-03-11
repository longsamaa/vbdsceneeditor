import type {
    Map,
    OverscaledTileID,
    CustomLayerInterface
} from 'maplibre-gl';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {OutlinePass} from 'three/examples/jsm/postprocessing/OutlinePass.js';
import * as THREE from 'three';

export type OutlineLayerOptions = {
    id: string;
}


class OutlineLayer implements CustomLayerInterface {
    id: string;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;
    private map: Map | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private camera: THREE.Camera | null = null;
    private scene: THREE.Scene | null = null;
    private composer: EffectComposer | null = null;
    private outlinePass: OutlinePass | null = null;
    private visible = true;
    private applyGlobeMatrix: boolean | false = false;
    private currentTile: OverscaledTileID | null = null;
    private currentObject: THREE.Object3D | null = null;

    constructor(opts: OutlineLayerOptions) {
        this.id = opts.id;
    }

    setCurrentTileID(overTile: OverscaledTileID): void {
        this.currentTile = overTile;
    }

    attachObject(object3d: THREE.Object3D): void {
        if (!this.scene || !this.outlinePass) return;
        this.scene.clear();
        this.currentObject = object3d;
        if (this.outlinePass) {
            this.outlinePass.selectedObjects = [this.currentObject];
        }
    }

    unselect(): void {
        this.currentObject = null;
        if (this.outlinePass) {
            this.outlinePass.selectedObjects = [];
        }
        this.clearComposer();
    }

    configOutlinePass(outlinePass: OutlinePass): void {
        if (!outlinePass) return;
        outlinePass.renderToScreen = true;
        outlinePass.clear = false;
        outlinePass.edgeStrength = 3;
        outlinePass.edgeGlow = 0;
        outlinePass.edgeThickness = 1;
        outlinePass.visibleEdgeColor = new THREE.Color(0xff8a00);
        outlinePass.hiddenEdgeColor = new THREE.Color(0x000000);
    }

    onAdd(map: Map): void {
        this.map = map;
        this.camera = new THREE.Camera();
        this.camera.matrixAutoUpdate = false;
        this.scene = new THREE.Scene();

        // Use map canvas dimensions instead of window to stay aligned
        const mapCanvas = map.getCanvas();
        const w = mapCanvas.clientWidth;
        const h = mapCanvas.clientHeight;

        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: false,
            powerPreference: "high-performance",
        });

        this.renderer.setPixelRatio(1);
        this.renderer.setSize(w, h);
        this.renderer.setClearColor(0x000000, 0);

        const canvas = this.renderer.domElement;
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '1';
        const mapContainer = map.getContainer();
        mapContainer.appendChild(canvas);

        this.composer = new EffectComposer(this.renderer);
        const scale = 0.7;
        this.composer.setSize(w * scale, h * scale);
        const outlinePass = new OutlinePass(
            new THREE.Vector2(w, h),
            this.scene,
            this.camera
        );
        this.configOutlinePass(outlinePass);
        this.composer.addPass(outlinePass);
        this.outlinePass = outlinePass;
    }

    onRemove(): void {
        this.renderer?.dispose();
        this.scene = null;
        this.renderer = null;
        this.camera = null;
        this.map = null;
    }

    /** Call when map container resizes to update renderer and composer */
    resize(width: number, height: number): void {
        if (!this.renderer || !this.composer || !this.outlinePass) return;
        this.renderer.setSize(width, height);
        const scale = 0.7;
        this.composer.setSize(width * scale, height * scale);
        this.outlinePass.resolution.set(width, height);
    }

    clearComposer(): void {
        if (!this.composer || !this.renderer) return;
        if (this.composer.readBuffer) {
            this.renderer.setRenderTarget(this.composer.readBuffer);
            this.renderer.clear(true, true, true);
        }
        if (this.composer.writeBuffer) {
            this.renderer.setRenderTarget(this.composer.writeBuffer);
            this.renderer.clear(true, true, true);
        }
        this.renderer.setRenderTarget(null);
        this.renderer.clear(true, true, true);
    }

    render(): void {
        if (!this.map || !this.camera || !this.renderer || !this.visible || !this.composer || !this.currentObject) {
            return;
        }
        if (this.currentTile) {
            this.renderer.clear(true, true, true);
            const tr = (this.map).transform;
            if (!tr?.getProjectionData) {
                return;
            }
            const projectionData = tr.getProjectionData({
                overscaledTileID: this.currentTile,
                applyGlobeMatrix: this.applyGlobeMatrix,
            });
            const tileMatrix = projectionData.mainMatrix;
            this.camera.projectionMatrix = new THREE.Matrix4().fromArray(tileMatrix);
            if (!this.scene) {
                return;
            }
            const originalParent = this.currentObject.parent;
            if (originalParent) {
                originalParent.remove(this.currentObject);
            }
            this.scene.add(this.currentObject);
            this.clearComposer();
            this.composer.render();
            this.scene.remove(this.currentObject);
            if (originalParent) {
                originalParent.add(this.currentObject);
            }
        }
    }

}

export default OutlineLayer