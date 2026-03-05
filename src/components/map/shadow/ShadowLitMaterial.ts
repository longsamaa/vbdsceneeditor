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
export class ShadowLitMaterial extends THREE.ShaderMaterial {
    constructor(shadowMap: THREE.WebGLRenderTarget | null = null) {
        super({
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 2,
            polygonOffsetUnits: 2,
            uniforms: {
                shadowMap:     { value: shadowMap?.texture ?? null },
                lightMatrix:   { value: new THREE.Matrix4() },
                lightDir:      { value: new THREE.Vector3() },
                shadowMapSize: { value: new THREE.Vector2(8192, 8192) },
                hasShadowMap:  { value: 0 },
                baseMap:       { value: null as THREE.Texture | null },
                hasBaseMap:    { value: 0 },
                alphaMap:      { value: null as THREE.Texture | null },
                hasAlphaMap:   { value: 0 },
                alphaTest:     { value: 0.0 },
                baseColor:     { value: new THREE.Color(1, 1, 1) },
                colorLift:     { value: 0.0 },
                ambient:       { value: 0.8 },
                diffuseIntensity: { value: 1.0 },
                uOpacity:      { value: 1.0 },
                shadowStrength: { value: 0.8 },
                lightColor:    { value: new THREE.Color(1.0, 0.96, 0.88) },
                biasBase:      { value: 0.0001 },
                biasSlope:     { value: 0.0001 },
            },
            vertexShader: /* glsl */`
                uniform mat4 lightMatrix;
                out vec3 vLightNDC;
                out vec2 vUv;
                varying vec3 vNormal;
                #ifdef USE_VERTEX_COLOR
                    attribute vec3 color;
                    varying vec3 vColor;
                #endif
                void main() {
                    vUv = uv;
                    #ifdef USE_VERTEX_COLOR
                        vColor = color;
                    #endif
                    vec4 localPos = vec4(position, 1.0);
                    vec3 localNormal = normal;
                    #ifdef USE_INSTANCING
                        localPos = instanceMatrix * localPos;
                        localNormal = mat3(instanceMatrix) * localNormal;
                    #endif
                    vec4 worldPos = modelMatrix * localPos;
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                    vec4 lightClip = lightMatrix * worldPos;
                    vLightNDC = lightClip.xyz / lightClip.w;
                    vNormal = normalize(mat3(modelMatrix) * localNormal);
                }
            `,
            fragmentShader: /* glsl */`
                uniform sampler2D shadowMap;
                uniform sampler2D baseMap;
                uniform sampler2D alphaMap;
                uniform int hasBaseMap;
                uniform int hasAlphaMap;
                uniform float alphaTest;
                uniform int hasShadowMap;
                uniform vec3 baseColor;
                uniform float colorLift;
                uniform vec3 lightDir;
                uniform vec2 shadowMapSize;
                uniform float ambient;
                uniform float diffuseIntensity;
                uniform float uOpacity;
                uniform float shadowStrength;
                uniform vec3 lightColor;
                uniform float biasBase;
                uniform float biasSlope;
                in vec3 vLightNDC;
                in vec2 vUv;
                varying vec3 vNormal;
                #ifdef USE_VERTEX_COLOR
                    varying vec3 vColor;
                #endif
                void main() {
                    // Sample base color from original texture, vertex color, or flat color
                    vec3 albedo = baseColor;
                    float alpha = uOpacity;
                    #ifdef USE_VERTEX_COLOR
                        albedo *= vColor;
                    #endif
                    if (hasBaseMap == 1) {
                        vec4 tex = texture2D(baseMap, vUv);
                        albedo *= tex.rgb;
                        alpha *= tex.a;
                    }
                    // Alpha map (separate alpha texture)
                    if (hasAlphaMap == 1) {
                        alpha *= texture2D(alphaMap, vUv).r;
                    }
                    // Alpha test discard
                    if (alphaTest > 0.0 && alpha < alphaTest) discard;
                    // Lighten albedo naturally: mix toward white
                    albedo = mix(albedo, vec3(1.0), colorLift);
                    vec3 N = normalize(vNormal);
                    vec3 L = normalize(lightDir);
                    float NdotL = dot(N, L);
                    float diffuse = max(NdotL, 0.0);
                    float lighting = ambient + diffuse * diffuseIntensity;
                    vec3 lit = albedo * lightColor * lighting;
                    if (hasShadowMap == 0) {
                        gl_FragColor = vec4(lit, alpha);
                        return;
                    }
                    vec3 projCoords = vLightNDC * 0.5 + 0.5;
                    // outside shadow map → fully lit
                    if (projCoords.x < 0.0 || projCoords.x > 1.0 ||
                        projCoords.y < 0.0 || projCoords.y > 1.0 ||
                        projCoords.z > 1.0) {
                        gl_FragColor = vec4(lit, alpha);
                        return;
                    }
                    float bias = biasBase + biasSlope * (1.0 - diffuse);
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
                    // shadow: 1.0 = fully lit, 0.0 = fully shadowed
                    float shadowLighting = mix(ambient * shadowStrength, lighting, shadow);
                    gl_FragColor = vec4(albedo * lightColor * shadowLighting, alpha);
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

    setOpacity(opacity: number): void {
        this.uniforms.uOpacity.value = opacity;
        this.transparent = opacity < 1.0;
    }

    setShadowStrength(strength: number): void {
        this.uniforms.shadowStrength.value = strength;
    }

    setLightColor(color: THREE.Color): void {
        this.uniforms.lightColor.value.copy(color);
    }

    setBias(base: number, slope: number): void {
        this.uniforms.biasBase.value = base;
        this.uniforms.biasSlope.value = slope;
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

// Ground shadow — chỉ render bóng đen lên mặt đất, không cần texture/lighting
export class GroundShadowMaterial extends THREE.ShaderMaterial {
    constructor(shadowMap: THREE.WebGLRenderTarget | null = null) {
        super({
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: 4,
            polygonOffsetUnits: 4,
            stencilWrite: true,
            stencilFunc: THREE.EqualStencilFunc,
            stencilRef: 0,
            stencilZPass: THREE.IncrementStencilOp,
            uniforms: {
                shadowMap:     { value: shadowMap?.texture ?? null },
                lightMatrix:   { value: new THREE.Matrix4() },
                shadowMapSize: { value: new THREE.Vector2(8192, 8192) },
                hasShadowMap:  { value: 0 },
                uOpacity:      { value: 1.0 },
                shadowStrength: { value: 0.8 },
                biasBase:      { value: 0.0001 },
                biasSlope:     { value: 0.0 },
            },
            vertexShader: /* glsl */`
                uniform mat4 lightMatrix;
                out vec3 vLightNDC;
                void main() {
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                    vec4 lightClip = lightMatrix * worldPos;
                    vLightNDC = lightClip.xyz / lightClip.w;
                }
            `,
            fragmentShader: /* glsl */`
                uniform sampler2D shadowMap;
                uniform int hasShadowMap;
                uniform vec2 shadowMapSize;
                uniform float uOpacity;
                uniform float shadowStrength;
                uniform float biasBase;
                uniform float biasSlope;
                in vec3 vLightNDC;
                void main() {
                    if (hasShadowMap == 0) {
                        discard;
                    }
                    vec3 projCoords = vLightNDC * 0.5 + 0.5;
                    if (projCoords.x < 0.0 || projCoords.x > 1.0 ||
                        projCoords.y < 0.0 || projCoords.y > 1.0 ||
                        projCoords.z > 1.0) {
                        discard;
                    }
                    float current = projCoords.z;
                    float bias = biasBase + biasSlope;
                    vec2 texelSize = 1.0 / shadowMapSize;
                    float shadow = 0.0;
                    for (int x = -3; x <= 3; x++) {
                        for (int y = -3; y <= 3; y++) {
                            float stored = texture2D(shadowMap, projCoords.xy + vec2(x, y) * texelSize).r;
                            shadow += (current - bias > stored) ? 1.0 : 0.0;
                        }
                    }
                    shadow /= 49.0;
                    float alpha = shadow * shadowStrength * uOpacity;
                    if (alpha < 0.01) discard;
                    gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
                }
            `,
        });
    }

    update(
        lightMatrix: THREE.Matrix4 | undefined,
        shadowMap: THREE.WebGLRenderTarget | undefined,
    ): void {
        if (!lightMatrix || !shadowMap) {
            this.uniforms.hasShadowMap.value = 0;
            return;
        }
        this.uniforms.hasShadowMap.value = 1;
        this.uniforms.lightMatrix.value.copy(lightMatrix);
        this.uniforms.shadowMap.value = shadowMap.texture;
        this.uniforms.shadowMapSize.value.set(shadowMap.width, shadowMap.height);
    }

    setOpacity(opacity: number): void {
        this.uniforms.uOpacity.value = opacity;
    }

    setShadowStrength(strength: number): void {
        this.uniforms.shadowStrength.value = strength;
    }

    setBias(base: number, slope: number): void {
        this.uniforms.biasBase.value = base;
        this.uniforms.biasSlope.value = slope;
    }

    setShadowColor(_color: THREE.Color): void {
        // MultiplyBlending: shadow darkness controlled by shadowStrength uniform
    }
}

/**
 * Instance flat shadow — dùng MultiplyBlending.
 * Sample building shadow map: nếu pixel đã trong vùng shadow building → output 1.0 (không darkening).
 * Chỉ darkening ở pixel chưa có building shadow → tránh overlap.
 */
export class InstanceShadowMaterial extends THREE.ShaderMaterial {
    constructor() {
        super({
            side: THREE.DoubleSide,
            transparent: false,
            depthWrite: false,
            blending: THREE.MultiplyBlending,
            // Tránh self-overlap: test stencil==0, vẽ xong increment
            stencilWrite: true,
            stencilFunc: THREE.EqualStencilFunc,
            stencilRef: 0,
            stencilZPass: THREE.IncrementStencilOp,
            uniforms: {
                shadowMap:       { value: null as THREE.Texture | null },
                lightMatrix:     { value: new THREE.Matrix4() },
                shadowMapSize:   { value: new THREE.Vector2(8192, 8192) },
                hasShadowMap:    { value: 0 },
                shadowBrightness: { value: 0.4 },
                biasBase:        { value: 0.0001 },
                biasSlope:       { value: 0.0 },
            },
            vertexShader: /* glsl */`
                uniform mat4 lightMatrix;
                out vec3 vLightNDC;
                void main() {
                    vec4 localPos = vec4(position, 1.0);
                    #ifdef USE_INSTANCING
                        localPos = instanceMatrix * localPos;
                    #endif
                    vec4 worldPos = modelMatrix * localPos;
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                    vec4 lightClip = lightMatrix * worldPos;
                    vLightNDC = lightClip.xyz / lightClip.w;
                }
            `,
            fragmentShader: /* glsl */`
                uniform sampler2D shadowMap;
                uniform int hasShadowMap;
                uniform vec2 shadowMapSize;
                uniform float shadowBrightness;
                uniform float biasBase;
                uniform float biasSlope;
                in vec3 vLightNDC;
                void main() {
                    // Target brightness sau cả building + tree shadow
                    // = min(buildingBrightness, treeBrightness) → lấy vùng tối nhất
                    // GroundShadow đã multiply buildingBrightness vào framebuffer
                    // Nên instance cần multiply = targetBrightness / buildingBrightness
                    float buildingBrightness = 1.0;
                    if (hasShadowMap == 1) {
                        vec3 projCoords = vLightNDC * 0.5 + 0.5;
                        if (projCoords.x >= 0.0 && projCoords.x <= 1.0 &&
                            projCoords.y >= 0.0 && projCoords.y <= 1.0 &&
                            projCoords.z <= 1.0) {
                            float current = projCoords.z;
                            float bias = biasBase + biasSlope;
                            vec2 texelSize = 1.0 / shadowMapSize;
                            float buildingShadow = 0.0;
                            for (int x = -1; x <= 1; x++) {
                                for (int y = -1; y <= 1; y++) {
                                    float stored = texture2D(shadowMap, projCoords.xy + vec2(x, y) * texelSize).r;
                                    buildingShadow += (current - bias > stored) ? 1.0 : 0.0;
                                }
                            }
                            buildingShadow /= 9.0;
                            buildingBrightness = 1.0 - buildingShadow * 0.8;
                        }
                    }
                    // target = vùng tối nhất giữa building và tree
                    float target = min(shadowBrightness, buildingBrightness);
                    // GroundShadow đã darken = buildingBrightness
                    // Cần multiply thêm = target / buildingBrightness
                    float mul = target / max(buildingBrightness, 0.01);
                    gl_FragColor = vec4(vec3(mul), 1.0);
                }
            `,
        });
    }

    update(
        lightMatrix: THREE.Matrix4 | undefined,
        shadowMap: THREE.WebGLRenderTarget | undefined,
    ): void {
        if (!lightMatrix || !shadowMap) {
            this.uniforms.hasShadowMap.value = 0;
            return;
        }
        this.uniforms.hasShadowMap.value = 1;
        this.uniforms.lightMatrix.value.copy(lightMatrix);
        this.uniforms.shadowMap.value = shadowMap.texture;
        this.uniforms.shadowMapSize.value.set(shadowMap.width, shadowMap.height);
    }

    setShadowBrightness(v: number): void {
        this.uniforms.shadowBrightness.value = v;
    }
}