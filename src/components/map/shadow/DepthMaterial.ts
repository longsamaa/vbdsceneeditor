import * as THREE from 'three';
import type {DepthTexture} from "three/src/textures/DepthTexture";

export class ShadowDepthMaterial extends THREE.ShaderMaterial {
    constructor(far: number) {
        super({
            uniforms: {
                far: { value: far }
            },
            vertexShader: `
                uniform float far;
                varying float vDepth;

                void main() {
                    vec4 clipPos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    vDepth = log(1.0 + clipPos.w) / log(1.0 + far);
                    gl_Position = clipPos;
                }
            `,
            fragmentShader: `
                varying float vDepth;
                void main() {
                    gl_FragColor = vec4(vec3(vDepth), 1.0);
                }
            `,
        });
    }
    update(far : number){
        this.uniforms.far.value = far;
    }
}

export class LinearDepthMaterial extends THREE.ShaderMaterial {
    constructor(shadow_render_target: THREE.WebGLRenderTarget | null) {
        super({
            uniforms: {
                shadowMap: { value: shadow_render_target?.depthTexture ?? null },
                lightMatrix: { value: new THREE.Matrix4() },
            },
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: true,

            vertexShader: `
                uniform mat4 lightMatrix;
                varying vec4 vLightSpacePos;
                void main() {
                    vLightSpacePos = lightMatrix * modelMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D shadowMap;
                varying vec4 vLightSpacePos;
                float getShadow(vec4 lightSpacePos) {
                    // Perspective divide → NDC [-1, 1]
                    vec3 projCoords = lightSpacePos.xyz / lightSpacePos.w;
                    // Chuyển sang UV space [0, 1]
                    projCoords = projCoords * 0.5 + 0.5;
                    // Ngoài vùng shadow map → không có bóng
                    if (projCoords.x < 0.0 || projCoords.x > 1.0 ||
                        projCoords.y < 0.0 || projCoords.y > 1.0 ||
                        projCoords.z > 1.0) {
                        return 1.0;
                    }
                    // Depth gần nhất lưu trong shadow map
                    float closestDepth = texture2D(shadowMap, projCoords.xy).r;
                    //return closestDepth;
                    // Depth thực tế của fragment hiện tại
                   float currentDepth = projCoords.z;
                    // Bias tránh shadow acne
                    float bias = 0.005;
                    // So sánh: nếu fragment sâu hơn → đang bị che → tối
                    return currentDepth;
                }
                void main() {
                    float shadow = getShadow(vLightSpacePos);
                    // 0.2 = ambient tối thiểu để không bị đen hoàn toàn
                    float brightness = shadow;
                    gl_FragColor = vec4(vec3(brightness), 1.0);
                }
            `,
        });
    }

    update(light_matrix: THREE.Matrix4, shadow_map: THREE.DepthTexture) {
        this.uniforms.shadowMap.value = shadow_map;
        this.uniforms.lightMatrix.value = light_matrix;
    }
}