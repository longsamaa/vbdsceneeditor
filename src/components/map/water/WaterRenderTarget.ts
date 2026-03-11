import * as THREE from 'three';

export class WaterRenderTarget {
    private reflectionTarget: THREE.WebGLRenderTarget | null = null;

    constructor(width: number, height: number = width) {
        this.reflectionTarget = new THREE.WebGLRenderTarget(width, height, {
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: true,
            stencilBuffer: false,
        });
        this.reflectionTarget.texture.generateMipmaps = false;
    }

    beginReflectionPass(renderer: THREE.WebGLRenderer): void {
        if (!this.reflectionTarget) throw new Error('disposed');
        renderer.setRenderTarget(this.reflectionTarget);
    }

    clearReflectionTarget(renderer: THREE.WebGLRenderer): void {
        if (!this.reflectionTarget) throw new Error('disposed');
        renderer.setRenderTarget(this.reflectionTarget);
        const oldClearColor = renderer.getClearColor(new THREE.Color());
        const oldClearAlpha = renderer.getClearAlpha();
        renderer.setClearColor(new THREE.Color(0.5, 0.7, 1.0), 1);
        renderer.clear(true, true, true);
        renderer.setClearColor(oldClearColor, oldClearAlpha);
    }

    endReflectionPass(renderer: THREE.WebGLRenderer): void {
        renderer.setRenderTarget(null);
    }

    getTexture(): THREE.Texture {
        if (!this.reflectionTarget) throw new Error('disposed');
        return this.reflectionTarget.texture;
    }

    getRenderTarget(): THREE.WebGLRenderTarget {
        if (!this.reflectionTarget) throw new Error('disposed');
        return this.reflectionTarget;
    }

    exportTexture(renderer: THREE.WebGLRenderer, path: string): void {
        if (!this.reflectionTarget) throw new Error('disposed');
        const width = this.reflectionTarget.width;
        const height = this.reflectionTarget.height;
        const pixelBuffer = new Uint8Array(width * height * 4);
        renderer.readRenderTargetPixels(
            this.reflectionTarget,
            0, 0,
            width, height,
            pixelBuffer
        );
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        const imageData = ctx.createImageData(width, height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const srcIdx = ((height - 1 - y) * width + x) * 4;
                const dstIdx = (y * width + x) * 4;
                imageData.data[dstIdx + 0] = pixelBuffer[srcIdx + 0];
                imageData.data[dstIdx + 1] = pixelBuffer[srcIdx + 1];
                imageData.data[dstIdx + 2] = pixelBuffer[srcIdx + 2];
                imageData.data[dstIdx + 3] = pixelBuffer[srcIdx + 3];
            }
        }
        ctx.putImageData(imageData, 0, 0);
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = path;
        link.click();
    }

    resize(width: number, height: number = width): void {
        if (!this.reflectionTarget) return;
        this.reflectionTarget.setSize(width, height);
    }

    dispose(): void {
        this.reflectionTarget?.dispose();
        this.reflectionTarget = null;
    }
}
