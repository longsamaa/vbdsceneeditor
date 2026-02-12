import * as THREE from 'three';
export class ShadowRenderTarget{
    shadow_Target : THREE.WebGLRenderTarget | null = null;
    private shadowSize : number = 512;
    constructor(size : number){
        this.shadowSize = size;
        this.shadow_Target = new THREE.WebGLRenderTarget(
            this.shadowSize,
            this.shadowSize,
            {
                minFilter: THREE.NearestFilter,
                magFilter: THREE.NearestFilter,
                format: THREE.RGBAFormat,
                type: THREE.FloatType,
                depthBuffer: true,
                stencilBuffer: false
            }
        );
        this.shadow_Target.depthTexture = new THREE.DepthTexture(
            this.shadowSize,
            this.shadowSize
        );
        this.shadow_Target.depthTexture.type = THREE.FloatType;
        this.shadow_Target.depthTexture.format = THREE.DepthFormat;
    }
    beginRenderShadowPass(renderer : THREE.WebGLRenderer){
        renderer.setRenderTarget(this.shadow_Target);
        renderer.clear(true, true, true);
    }
    getDepthTexture() : THREE.DepthTexture{
        return this.shadow_Target.depthTexture;
    }
    endRenderShadowPass(renderer : THREE.WebGLRenderer){
        renderer.setRenderTarget(null);
    }
}