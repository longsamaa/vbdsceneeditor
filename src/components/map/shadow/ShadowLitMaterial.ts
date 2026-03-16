import * as THREE from 'three';

//Depth material để ghi depth vào buffer 
export class ShadowDepthMaterial extends THREE.ShaderMaterial {
    constructor() {
        super({
            side: THREE.DoubleSide,
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
                    vec4 localPos = vec4(position, 1.0);
                    #ifdef USE_INSTANCING
                        localPos = instanceMatrix * localPos;
                    #endif
                    vec4 worldPos = modelMatrix * localPos;
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
            clipping: true,
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
                skyColor:      { value: new THREE.Color(0.85, 0.85, 0.87) },
                groundColor:   { value: new THREE.Color(0.6, 0.58, 0.56) },
                shadowColor:   { value: new THREE.Color(0.5, 0.5, 0.52) },
                fresnelPower:  { value: 4.0 },
                fresnelScale:  { value: 0.08 },
                wrapFactor:    { value: 0.3 },
                biasBase:      { value: 0.00001 },
                biasSlope:     { value: 0.000001 },
                shadowThreshold: { value: 0.6 },
                clippingPlane:   { value: new THREE.Vector4(0, 0, 0, 0) },
                useClipping:     { value: 0 },
            },
            vertexShader: /* glsl */`
                uniform mat4 lightMatrix;
                out vec3 vLightNDC;
                out vec2 vUv;
                out vec3 vWorldPos;
                varying vec3 vNormal;
                varying vec3 vViewDir;
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
                    vWorldPos = worldPos.xyz;
                    vec4 viewPos = viewMatrix * worldPos;
                    gl_Position = projectionMatrix * viewPos;
                    vec4 lightClip = lightMatrix * worldPos;
                    vLightNDC = lightClip.xyz / lightClip.w;
                    vNormal = normalize(mat3(modelMatrix) * localNormal);
                    vViewDir = normalize(-viewPos.xyz);
                }
            `,
            fragmentShader: /* glsl */`
                uniform vec4 clippingPlane;
                uniform int useClipping;
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
                uniform vec3 skyColor;
                uniform vec3 groundColor;
                uniform vec3 shadowColor;
                uniform float fresnelPower;
                uniform float fresnelScale;
                uniform float wrapFactor;
                uniform float biasBase;
                uniform float biasSlope;
                uniform float shadowThreshold;
                in vec3 vLightNDC;
                in vec2 vUv;
                in vec3 vWorldPos;
                varying vec3 vNormal;
                varying vec3 vViewDir;
                #ifdef USE_VERTEX_COLOR
                    varying vec3 vColor;
                #endif

                // Gaussian-weighted 5x5 PCF for smoother shadow edges
                float sampleShadowPCF(vec3 projCoords, float bias) {
                    vec2 texelSize = 1.0 / shadowMapSize;
                    float current = projCoords.z;
                    // 7x7 Gaussian kernel weights (sigma ~2.0)
                    float weights[49];
                    weights[0]=1.0; weights[1]=2.0; weights[2]=3.0; weights[3]=4.0; weights[4]=3.0; weights[5]=2.0; weights[6]=1.0;
                    weights[7]=2.0; weights[8]=4.0; weights[9]=6.0; weights[10]=8.0;weights[11]=6.0; weights[12]=4.0;weights[13]=2.0;
                    weights[14]=3.0;weights[15]=6.0;weights[16]=9.0;weights[17]=12.0;weights[18]=9.0;weights[19]=6.0;weights[20]=3.0;
                    weights[21]=4.0;weights[22]=8.0;weights[23]=12.0;weights[24]=16.0;weights[25]=12.0;weights[26]=8.0;weights[27]=4.0;
                    weights[28]=3.0;weights[29]=6.0;weights[30]=9.0;weights[31]=12.0;weights[32]=9.0;weights[33]=6.0;weights[34]=3.0;
                    weights[35]=2.0;weights[36]=4.0;weights[37]=6.0;weights[38]=8.0;weights[39]=6.0;weights[40]=4.0;weights[41]=2.0;
                    weights[42]=1.0;weights[43]=2.0;weights[44]=3.0;weights[45]=4.0;weights[46]=3.0;weights[47]=2.0;weights[48]=1.0;
                    float shadow = 0.0;
                    float totalWeight = 0.0;
                    int idx = 0;
                    for (int y = -3; y <= 3; y++) {
                        for (int x = -3; x <= 3; x++) {
                            float w = weights[idx];
                            float stored = texture2D(shadowMap, projCoords.xy + vec2(x, y) * texelSize).r;
                            shadow += w * ((current - bias > stored) ? 0.0 : 1.0);
                            totalWeight += w;
                            idx++;
                        }
                    }
                    return shadow / totalWeight;
                }

                void main() {
                    if (useClipping == 1) {
                        float d = dot(vWorldPos, clippingPlane.xyz) + clippingPlane.w;
                        if (d < 0.0) discard;
                    }
                    // --- Albedo ---
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
                    if (hasAlphaMap == 1) {
                        alpha *= texture2D(alphaMap, vUv).r;
                    }
                    if (alphaTest > 0.0 && alpha < alphaTest) discard;
                    albedo = mix(albedo, vec3(1.0), colorLift);

                    vec3 N = normalize(vNormal);
                    vec3 L = normalize(lightDir);
                    vec3 V = normalize(vViewDir);

                    // --- Hemisphere ambient (sky + ground) ---
                    float hemiMix = N.z * 0.5 + 0.5; // z-up: 1=sky, 0=ground
                    vec3 ambientColor = mix(groundColor, skyColor, hemiMix) * ambient;

                    // --- Wrap diffuse (softer light/shadow transition) ---
                    float NdotL = dot(N, L);
                    float wrapDiffuse = max((NdotL + wrapFactor) / (1.0 + wrapFactor), 0.0);
                    vec3 directLight = lightColor * wrapDiffuse * diffuseIntensity;

                    // --- Fresnel rim light ---
                    float fresnel = fresnelScale * pow(1.0 - max(dot(N, V), 0.0), fresnelPower);
                    vec3 rimLight = skyColor * fresnel;

                    // --- Combine lighting (no shadow) ---
                    vec3 lit = albedo * (ambientColor + directLight) + rimLight;

                    if (hasShadowMap == 0) {
                        gl_FragColor = vec4(lit, alpha);
                        return;
                    }

                    // --- Shadow sampling ---
                    vec3 projCoords = vLightNDC * 0.5 + 0.5;
                    if (projCoords.x < 0.0 || projCoords.x > 1.0 ||
                        projCoords.y < 0.0 || projCoords.y > 1.0 ||
                        projCoords.z > 1.0) {
                        gl_FragColor = vec4(lit, alpha);
                        return;
                    }
                    float bias = biasBase + biasSlope * (1.0 - max(NdotL, 0.0));
                    vec2 texelSize = 1.0 / shadowMapSize;
                    float current = projCoords.z;
                    float shadow = sampleShadowPCF(projCoords,bias);
                    // for (int y = -2; y <= 2; y++) {
                    //     for (int x = -2; x <= 2; x++) {
                    //         float stored = texture2D(shadowMap, projCoords.xy + vec2(x, y) * texelSize).r;
                    //         shadow += (current - bias > stored) ? 0.0 : 1.0;
                    //     }
                    // }
                    // shadow /= 25.0;

                    // --- Shadow with colored tint (blue-ish cool shadow) ---
                    // In shadow: use ambient + shadow color tint instead of just darkening
                    vec3 shadowLit = albedo * (ambientColor * shadowStrength + shadowColor * (1.0 - shadow) * 0.08);
                    vec3 fullLit = albedo * (ambientColor + directLight) + rimLight;
                    vec3 finalColor = mix(shadowLit, fullLit, shadow);

                    gl_FragColor = vec4(finalColor, alpha);
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

    setShadowThreshold(threshold: number): void {
        this.uniforms.shadowThreshold.value = threshold;
    }

    setLighting(ambient: number, diffuseIntensity: number): void {
        this.uniforms.ambient.value = ambient;
        this.uniforms.diffuseIntensity.value = diffuseIntensity;
    }

    setSkyColor(color: THREE.Color): void {
        this.uniforms.skyColor.value.copy(color);
    }

    setGroundColor(color: THREE.Color): void {
        this.uniforms.groundColor.value.copy(color);
    }

    setShadowColor(color: THREE.Color): void {
        this.uniforms.shadowColor.value.copy(color);
    }

    setFresnel(scale: number, power: number): void {
        this.uniforms.fresnelScale.value = scale;
        this.uniforms.fresnelPower.value = power;
    }

    setWrapFactor(factor: number): void {
        this.uniforms.wrapFactor.value = factor;
    }

    setClippingPlane(plane: THREE.Plane | null): void {
        if (plane) {
            this.uniforms.clippingPlane.value.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
            this.uniforms.useClipping.value = 1;
        } else {
            this.uniforms.useClipping.value = 0;
        }
    }

    enableShadowMap(bEnable : boolean) : void {
        this.uniforms.hasShadowMap.value = bEnable;
    }

    /** Call before each mesh render to inject its original texture */
    setMeshMaterial(originalMaterial: THREE.Material | null): void {
        if (!originalMaterial) {
            this.uniforms.hasBaseMap.value = 0;
            this.uniforms.hasAlphaMap.value = 0;
            this.uniforms.alphaTest.value = 0.0;
            this.uniforms.baseColor.value.set(1, 1, 1);
            this.transparent = false;
            return;
        }
        const mat = originalMaterial as THREE.MeshStandardMaterial;
        if (mat.map) {
            this.uniforms.baseMap.value = mat.map;
            this.uniforms.hasBaseMap.value = 1;
        } else {
            this.uniforms.hasBaseMap.value = 0;
        }
        if (mat.alphaMap) {
            this.uniforms.alphaMap.value = mat.alphaMap;
            this.uniforms.hasAlphaMap.value = 1;
        } else {
            this.uniforms.hasAlphaMap.value = 0;
        }
        if (mat.color) {
            this.uniforms.baseColor.value.copy(mat.color);
        } else {
            this.uniforms.baseColor.value.set(1, 1, 1);
        }
        // Transfer alpha settings from original material
        const needsAlpha = mat.transparent || mat.alphaTest > 0 || (mat.map?.format === THREE.RGBAFormat);
        if (needsAlpha) {
            this.uniforms.alphaTest.value = mat.alphaTest > 0 ? mat.alphaTest : 0.5;
            this.transparent = mat.transparent;
        } else {
            this.uniforms.alphaTest.value = 0.0;
            this.transparent = false;
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
                biasSlope:       { value: 0.000001 },
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