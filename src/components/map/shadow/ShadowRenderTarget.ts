import * as THREE from 'three';

export class ShadowRenderTarget {
    private shadowTarget: THREE.WebGLRenderTarget | null = null;
    constructor(shadowSize: number) {
        this.shadowTarget = new THREE.WebGLRenderTarget(shadowSize, shadowSize, {
            format:        THREE.RedFormat,
            type:          THREE.FloatType,
            minFilter:     THREE.LinearFilter,
            magFilter:     THREE.LinearFilter,
            depthBuffer:   true,
            stencilBuffer: false,
        });
        this.shadowTarget.texture.generateMipmaps = false;
    }

    beginRenderShadowPass(renderer: THREE.WebGLRenderer): void {
        if (!this.shadowTarget) throw new Error('disposed');
        renderer.setRenderTarget(this.shadowTarget);
        renderer.clear(true, true, false);
    }

    endRenderShadowPass(renderer: THREE.WebGLRenderer): void {
        renderer.setRenderTarget(null);
    }

    getTexture(): THREE.Texture {
        if (!this.shadowTarget) throw new Error('disposed');
        return this.shadowTarget.texture; // color buffer chứa packed depth
    }
    getRenderTarget() : THREE.WebGLRenderTarget {
        if (!this.shadowTarget) throw new Error('disposed');
        return this.shadowTarget;
    }

    exportTexture(renderer: THREE.WebGLRenderer, path: string): void {
        if (!this.shadowTarget) throw new Error('disposed');
        const size = this.shadowTarget.width;
        const pixelBuffer = new Uint8Array(size * size * 4);
        // Đọc pixel từ render target
        renderer.readRenderTargetPixels(
            this.shadowTarget,
            0, 0,
            size, size,
            pixelBuffer
        );
        // Tạo canvas và vẽ pixel lên
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        const imageData = ctx.createImageData(size, size);
        // WebGL origin ở bottom-left, canvas ở top-left → flip Y
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const srcIdx = ((size - 1 - y) * size + x) * 4; // flip Y
                const dstIdx = (y * size + x) * 4;
                imageData.data[dstIdx + 0] = pixelBuffer[srcIdx + 0];
                imageData.data[dstIdx + 1] = pixelBuffer[srcIdx + 1];
                imageData.data[dstIdx + 2] = pixelBuffer[srcIdx + 2];
                imageData.data[dstIdx + 3] = pixelBuffer[srcIdx + 3];
            }
        }
        ctx.putImageData(imageData, 0, 0);
        // Download file
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = path;
        link.click();
    }

    dispose(): void {
        this.shadowTarget?.dispose();
        this.shadowTarget = null;
    }
}