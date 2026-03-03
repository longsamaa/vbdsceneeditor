import * as THREE from 'three';

//Depth material để ghi depth vào buffer 
export class ShadowDepthMaterial extends THREE.ShaderMaterial {
    constructor() {
        super({
            side: THREE.DoubleSide,
            depthWrite: true,
            polygonOffset: true,
            polygonOffsetFactor: 8,
            polygonOffsetUnits: 8,
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
// Shadow material that samples the model's original texture and applies shadow + lighting
export class CustomShadowMaterial extends THREE.ShaderMaterial {
    constructor(shadowMap: THREE.WebGLRenderTarget | null = null) {
        super({
            side: THREE.FrontSide,
            polygonOffset: true,
            polygonOffsetFactor: 2,
            polygonOffsetUnits: 2,
            uniforms: {
                shadowMap:     { value: shadowMap?.texture ?? null },
                lightMatrix:   { value: new THREE.Matrix4() },
                lightDir:      { value: new THREE.Vector3() },
                shadowMapSize: { value: new THREE.Vector2(4096, 4096) },
                hasShadowMap:  { value: 0 },
                baseMap:       { value: null as THREE.Texture | null },
                hasBaseMap:    { value: 0 },
                baseColor:     { value: new THREE.Color(1, 1, 1) },
                ambient:       { value: 0.85 },
                diffuseIntensity: { value: 3.0 },
            },
            vertexShader: /* glsl */`
                uniform mat4 lightMatrix;
                out vec3 vLightNDC;
                out vec2 vUv;
                varying vec3 vNormal;
                void main() {
                    vUv = uv;
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                    vec4 lightClip = lightMatrix * worldPos;
                    vLightNDC = lightClip.xyz / lightClip.w;
                    vNormal = normalize(normalMatrix * normal);
                }
            `,
            fragmentShader: /* glsl */`
                uniform sampler2D shadowMap;
                uniform sampler2D baseMap;
                uniform int hasBaseMap;
                uniform int hasShadowMap;
                uniform vec3 baseColor;
                uniform vec3 lightDir;
                uniform vec2 shadowMapSize;
                uniform float ambient;
                uniform float diffuseIntensity;
                in vec3 vLightNDC;
                in vec2 vUv;
                varying vec3 vNormal;
                void main() {
                    // Sample base color from original texture or use flat color
                    vec3 albedo = baseColor;
                    if (hasBaseMap == 1) {
                        albedo *= texture2D(baseMap, vUv).rgb;
                    }
                    vec3 N = normalize(vNormal);
                    vec3 L = normalize(lightDir);
                    float NdotL = dot(N, L);
                    float diffuse = clamp(NdotL, 0.0, 1.0);
                    // No shadow map → just albedo + N·L diffuse lighting
                    if (hasShadowMap == 0) {
                        float lighting = ambient + diffuse * diffuseIntensity;
                        gl_FragColor = vec4(albedo * lighting, 1.0);
                        return;
                    }
                    vec3 projCoords = vLightNDC * 0.5 + 0.5;
                    // outside shadow map → fully lit
                    if (projCoords.x < 0.0 || projCoords.x > 1.0 ||
                        projCoords.y < 0.0 || projCoords.y > 1.0 ||
                        projCoords.z > 1.0) {
                        float lighting = ambient + diffuse * diffuseIntensity;
                        gl_FragColor = vec4(albedo * lighting, 1.0);
                        return;
                    }
                    float bias = 0.00005 + 0.00001 * (1.0 - diffuse);
                    float current = projCoords.z;
                    vec2 texelSize = 1.0 / shadowMapSize;
                    // PCF 7x7 soft shadow (49 samples)
                    float shadow = 0.0;
                    for (int x = -3; x <= 3; x++) {
                        for (int y = -3; y <= 3; y++) {
                            float stored = texture2D(shadowMap, projCoords.xy + vec2(x, y) * texelSize).r;
                            shadow += (current - bias > stored) ? 0.0 : 1.0;
                        }
                    }
                    shadow /= 49.0;
                    float shadowAmbient = mix(ambient * 0.85, ambient, shadow);
                    float lighting = shadowAmbient + diffuse * shadow * diffuseIntensity;
                    gl_FragColor = vec4(albedo * lighting, 1.0);
                }
            `,
        });
    }

    update(
        lightMatrix: THREE.Matrix4 | undefined,
        shadowMap: THREE.WebGLRenderTarget | undefined,
        lightDir: THREE.Vector3
    ): void {
        this.uniforms.lightDir.value.copy(lightDir).normalize();
        if (!lightMatrix || !shadowMap) {
            this.uniforms.hasShadowMap.value = 0;
            return;
        }
        this.uniforms.hasShadowMap.value = 1;
        this.uniforms.lightMatrix.value.copy(lightMatrix);
        this.uniforms.shadowMap.value = shadowMap.texture;
        this.uniforms.shadowMapSize.value.set(shadowMap.width, shadowMap.height);
    }

    setLighting(ambient: number, diffuseIntensity: number): void {
        this.uniforms.ambient.value = ambient;
        this.uniforms.diffuseIntensity.value = diffuseIntensity;
    }

    /** Call before each mesh render to inject its original texture */
    setMeshMaterial(originalMaterial: THREE.Material | null): void {
        if (!originalMaterial) {
            this.uniforms.hasBaseMap.value = 0;
            this.uniforms.baseColor.value.set(1, 1, 1);
            return;
        }
        const mat = originalMaterial as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | THREE.MeshPhongMaterial;
        if (mat.map) {
            this.uniforms.baseMap.value = mat.map;
            this.uniforms.hasBaseMap.value = 1;
        } else {
            this.uniforms.hasBaseMap.value = 0;
        }
        if (mat.color) {
            this.uniforms.baseColor.value.copy(mat.color);
        } else {
            this.uniforms.baseColor.value.set(1, 1, 1);
        }
    }
}