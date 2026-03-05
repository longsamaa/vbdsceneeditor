import * as THREE from 'three';

let sharedRenderer: THREE.WebGLRenderer | null = null;

/**
 * Lấy hoặc tạo WebGLRenderer dùng chung cho tất cả custom layer (trừ OutlineLayer).
 * Renderer được tạo 1 lần duy nhất và reuse cho mọi layer.
 */
export function getSharedRenderer(canvas: HTMLCanvasElement, gl: WebGLRenderingContext): THREE.WebGLRenderer {
    if (!sharedRenderer) {
        sharedRenderer = new THREE.WebGLRenderer({
            canvas: canvas,
            context: gl,
            antialias: true,
            alpha: true,
            stencil: true,
        });
        sharedRenderer.autoClear = false;
        sharedRenderer.localClippingEnabled = true;
    }
    return sharedRenderer;
}

export function disposeSharedRenderer(): void {
    if (sharedRenderer) {
        sharedRenderer.dispose();
        sharedRenderer = null;
    }
}
