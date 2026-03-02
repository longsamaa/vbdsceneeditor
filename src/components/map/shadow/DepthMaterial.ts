import * as THREE from 'three';

export class ShadowDepthMaterial extends THREE.ShaderMaterial {
    constructor() {
        super({
            side: THREE.FrontSide,
            depthWrite: true,
            polygonOffset: true,
            polygonOffsetFactor: 4,
            polygonOffsetUnits: 4,
            uniforms: {
                lightMatrix: { value: new THREE.Matrix4() },
            },
            vertexShader: /* glsl */`
                uniform mat4 lightMatrix;
                out float vDepth;

                void main() {
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vec4 lightClip = lightMatrix * worldPos;
                    gl_Position = lightClip;
                    vDepth = lightClip.z / lightClip.w * 0.5 + 0.5;
                }
            `,
            fragmentShader: /* glsl */`
                in float vDepth;
                void main() {
                    gl_FragColor = vec4(vDepth, 0.0, 0.0, 1.0);
                }
            `,
        });
    }
}
export class CustomShadowMaterial extends THREE.ShaderMaterial {
    constructor(shadowMap: THREE.WebGLRenderTarget | null = null) {
        super({
            side: THREE.DoubleSide,
            uniforms: {
                shadowMap:   { value: shadowMap?.texture ?? null },
                lightMatrix: { value: new THREE.Matrix4() },
                lightDir:    { value: new THREE.Vector3() },
                shadowMapSize: { value: new THREE.Vector2(2048, 2048) },
            },
            vertexShader: /* glsl */`
                uniform mat4 lightMatrix;
                out vec3 vLightNDC;
                varying vec3 vNormal;
                void main() {
                    // WORLD SPACE
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    // MAIN CAMERA
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                    // LIGHT SPACE (must use WORLD space!)
                    vec4 lightClip = lightMatrix * worldPos;
                    // divide w in vertex (important!)
                    vLightNDC = lightClip.xyz / lightClip.w;
                    vNormal = normalize(normalMatrix * normal);
                }
            `,
            fragmentShader: /* glsl */`
                uniform sampler2D shadowMap;
                uniform vec3 lightDir;
                uniform vec2 shadowMapSize;
                in vec3 vLightNDC;
                varying vec3 vNormal;
                void main() {
                    vec3 projCoords = vLightNDC * 0.5 + 0.5;
                    // outside shadow map → fully lit
                    if (projCoords.x < 0.0 || projCoords.x > 1.0 ||
                        projCoords.y < 0.0 || projCoords.y > 1.0 ||
                        projCoords.z > 1.0) {
                        gl_FragColor = vec4(1.0);
                        return;
                    }
                    // normalize once, reuse
                    vec3 N = normalize(vNormal);
                    vec3 L = normalize(lightDir);
                    float NdotL = dot(N, L);
                    float diffuse = clamp(NdotL, 0.0, 1.0);
                    // slope-scale bias
                    float bias = 0.002 + 0.005 * (1.0 - diffuse);
                    // PCF 5x5 soft shadow (25 samples)
                    float current = projCoords.z;
                    vec2 texelSize = 1.0 / shadowMapSize;
                    float shadow = 0.0;
                    for (int x = -2; x <= 2; x++) {
                        for (int y = -2; y <= 2; y++) {
                            float stored = texture2D(shadowMap, projCoords.xy + vec2(x, y) * texelSize).r;
                            shadow += (current - bias > stored) ? 0.0 : 1.0;
                        }
                    }
                    shadow /= 25.0;
                    // Combine: ambient + diffuse * shadow
                    float ambient = 0.3;
                    float lighting = ambient + (1.0 - ambient) * diffuse * shadow;
                    gl_FragColor = vec4(vec3(lighting), 1.0);
                }
            `,
        });
    }

    update(
        lightMatrix: THREE.Matrix4 | undefined,
        shadowMap: THREE.WebGLRenderTarget | undefined,
        lightDir: THREE.Vector3
    ): void {

        if (!lightMatrix || !shadowMap) return;

        this.uniforms.lightMatrix.value.copy(lightMatrix);
        this.uniforms.shadowMap.value = shadowMap.texture;
        this.uniforms.lightDir.value.copy(lightDir).normalize();
        this.uniforms.shadowMapSize.value.set(shadowMap.width, shadowMap.height);
    }
}