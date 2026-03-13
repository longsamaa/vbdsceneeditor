import * as THREE from 'three'

export type WaterOpts = {
    color: number,
    opacity: number,
    tex: THREE.Texture,
}

export function createWaterMaterial(opts: WaterOpts): THREE.ShaderMaterial {
    if (opts.tex) {
        opts.tex.wrapS = THREE.RepeatWrapping;
        opts.tex.wrapT = THREE.RepeatWrapping;
    }

    const waterMat = new THREE.ShaderMaterial({
        uniforms: {
            // Màu nước
            waterColor: {value: new THREE.Color(0x2C6E8F)},
            deepWaterColor: {value: new THREE.Color(0x0F3A50)},
            shallowWaterColor: {value: new THREE.Color(0x6FB7CC)},
            foamColor: {value: new THREE.Color(0xECF6F8)},
            // Textures
            normalMap: {value: opts.tex},
            //light dir
            lightDir: {
                value: new THREE.Vector3(0.5, 1.0, 0.5).normalize()
            },
            // Animation
            time: {value: 0},
            waveSpeed: {value: 2.0},
            waveStrength: {value: 0.1},
            // Settings
            opacity: {value: opts.opacity},
            uvScale: {value: 0.00015},
            // Advanced
            specularStrength: {value: 0.8},
            shininess: {value: 8.0},
            distortionScale: {value: 3},
            noiseStrength: {value: 0.5},
            lightRayStrength: {value: 0.15},
        },

        vertexShader: `
            varying vec2 vWorldUV;
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec3 vWorldPosition;

            uniform float time;
            uniform float uvScale;
            uniform float waveSpeed;
            uniform float waveStrength;

            // Gerstner Wave function
            vec3 gerstnerWave(vec3 pos, float wavelength, float steepness, vec2 direction, float speed) {
                float k = 2.0 * 3.14159 / wavelength;
                float c = sqrt(9.8 / k);
                vec2 d = normalize(direction);
                float f = k * (dot(d, pos.xy) - c * time * speed);
                float a = steepness / k;

                return vec3(
                    d.x * a * cos(f),
                    d.y * a * cos(f),
                    a * sin(f)
                );
            }

            void main() {
                vUv = uv;
                vNormal = normalize(normalMatrix * normal);

                // World position
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPos.xyz;
                vWorldUV = worldPos.xy * uvScale;

                // Apply multiple Gerstner waves
                vec3 displacement = vec3(0.0);
                displacement += gerstnerWave(worldPos.xyz, 60.0, 0.15, vec2(1.0, 0.3), waveSpeed);
                displacement += gerstnerWave(worldPos.xyz, 31.0, 0.12, vec2(-0.7, 0.8), waveSpeed * 1.1);
                displacement += gerstnerWave(worldPos.xyz, 18.0, 0.08, vec2(0.5, -0.6), waveSpeed * 1.3);
                displacement += gerstnerWave(worldPos.xyz, 10.0, 0.05, vec2(-0.3, -0.9), waveSpeed * 1.5);

                // Scale down displacement
                displacement *= waveStrength * 2.0;

                // Apply to position
                vec3 newPosition = position + displacement;

                // View position
                vec4 mvPosition = modelViewMatrix * vec4(newPosition, 1.0);
                vViewPosition = -mvPosition.xyz;

                gl_Position = projectionMatrix * mvPosition;
            }
        `,

        fragmentShader: `
            uniform vec3 waterColor;
            uniform vec3 deepWaterColor;
            uniform vec3 shallowWaterColor;
            uniform vec3 foamColor;
            uniform sampler2D normalMap;
            uniform float opacity;
            uniform float time;
            uniform float waveSpeed;
            uniform float waveStrength;
            uniform float specularStrength;
            uniform float shininess;
            uniform float distortionScale;
            uniform vec3 lightDir;
            uniform float noiseStrength;
            uniform float lightRayStrength;

            varying vec2 vWorldUV;
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec3 vWorldPosition;

            float random(vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
            }

            float noise(vec2 st) {
                vec2 i = floor(st);
                vec2 f = fract(st);

                // Four corners
                float a = random(i);
                float b = random(i + vec2(1.0, 0.0));
                float c = random(i + vec2(0.0, 1.0));
                float d = random(i + vec2(1.0, 1.0));

                // Smooth interpolation
                vec2 u = f * f * (3.0 - 2.0 * f);

                return mix(a, b, u.x) +
                       (c - a) * u.y * (1.0 - u.x) +
                       (d - b) * u.x * u.y;
            }

            float fbm(vec2 p) {
                float value = 0.0;
                float amplitude = 0.5;
                float frequency = 1.0;

                for(int i = 0; i < 5; i++) {
                    value += amplitude * noise(p * frequency);
                    frequency *= 2.0;
                    amplitude *= 0.5;
                }
                return value;
            }

            void main() {
                float animSpeed = time * waveSpeed;

                // === 1. Multi-layer Normal Map ===
                vec2 uv1 = vWorldUV + vec2(animSpeed * 0.04, animSpeed * 0.03);
                vec2 uv2 = vWorldUV * 1.5 - vec2(animSpeed * 0.03, animSpeed * 0.05);
                vec2 uv3 = vWorldUV * 2.2 + vec2(animSpeed * 0.02, -animSpeed * 0.04);

                vec3 normal1 = texture2D(normalMap, uv1).rgb * 2.0 - 1.0;
                vec3 normal2 = texture2D(normalMap, uv2).rgb * 2.0 - 1.0;
                vec3 normal3 = texture2D(normalMap, uv3).rgb * 2.0 - 1.0;

                vec3 normalBlend = normalize(
                    normal1 * 0.5 +
                    normal2 * 0.3 +
                    normal3 * 0.2
                );

                vec3 finalNormal = normalize(vNormal + normalBlend * distortionScale);

                // === 2. Fresnel ===
                vec3 viewDir = normalize(vViewPosition);
                float fresnel = pow(1.0 - max(dot(viewDir, finalNormal), 0.0), 3.5);

                // === 3. LIGHT NOISE (multiple scales) ===
                // Large scale - color variation
                float largeNoise = fbm(vWorldUV * 2.0 + animSpeed * 0.05);

                // Medium scale - light patches
                float mediumNoise = fbm(vWorldUV * 8.0 + animSpeed * 0.08);

                // Small scale - subtle detail
                float smallNoise = noise(vWorldUV * 25.0 + animSpeed * 0.15);

                // === 4. Water Color with Noise ===
                float depthFactor = largeNoise * 0.5 + 0.5;
                vec3 baseColor = mix(shallowWaterColor, deepWaterColor, depthFactor * 0.4);
                baseColor = mix(baseColor, waterColor, 0.3);

                // Apply light noise variation
                float brightness = 0.92 + mediumNoise * noiseStrength + smallNoise * (noiseStrength * 0.5);
                baseColor *= brightness;

                // Fresnel glow
                vec3 fresnelColor = mix(baseColor, shallowWaterColor, fresnel * 0.6);

                // === 5. LIGHT RAYS (Caustic-like effect) ===
                vec2 rayUV1 = vWorldUV * 12.0 + vec2(animSpeed * 0.12, animSpeed * 0.08);
                vec2 rayUV2 = vWorldUV * 18.0 - vec2(animSpeed * 0.08, animSpeed * 0.15);

                float rays1 = fbm(rayUV1);
                float rays2 = fbm(rayUV2);

                // Combine rays with threshold
                float lightRays = (rays1 + rays2 * 0.6) * 0.5;
                lightRays = smoothstep(0.45, 0.75, lightRays);

                // Add light rays to color
                fresnelColor += vec3(1.0, 1.0, 0.98) * lightRays * lightRayStrength;

                // === 6. Specular ===
                vec3 specular = vec3(0.0);

                // Sharp specular
                vec3 reflectDir = reflect(-lightDir, finalNormal);
                float sharpSpec = pow(max(dot(viewDir, reflectDir), 0.0), 64.0);
                specular += vec3(1.0, 0.98, 0.9) * sharpSpec * 0.4;

                // Soft specular
                vec3 halfDir = normalize(lightDir + viewDir);
                float softSpec = pow(max(dot(finalNormal, halfDir), 0.0), 16.0);
                specular += vec3(0.9, 0.95, 1.0) * softSpec * 0.3;

                // Ambient highlight
                float ambientHL = pow(1.0 - abs(dot(viewDir, finalNormal)), 2.0);
                specular += vec3(1.0) * ambientHL * 0.1;

                specular *= specularStrength;

                // Add noise variation to specular (twinkling)
                specular *= (0.95 + smallNoise * 0.1);

                // === 7. Foam ===
                float foamNoise = fbm(vWorldUV * 15.0 + animSpeed * 0.3);
                float foamMask = smoothstep(0.7, 0.9, foamNoise) * fresnel;
                vec3 foam = foamColor * foamMask * 0.3;

                // === 8. SUBTLE SPARKLES ===
                float sparkle = pow(smallNoise, 12.0) * step(0.985, smallNoise);
                vec3 sparkles = vec3(1.0, 1.0, 0.98) * sparkle * 0.25;

                // === 9. Final Color ===
                vec3 finalColor = fresnelColor + foam + sparkles;

                // Subtle color shift with noise
                float colorShift = noise(vWorldUV * 4.0 + animSpeed * 0.06);
                finalColor = mix(finalColor, finalColor * 1.06, colorShift * 0.08);

                gl_FragColor = vec4(finalColor, opacity);
            }
        `,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    return waterMat;
}


export class WaterReflectionMaterial extends THREE.ShaderMaterial {

    constructor(reflectionTexture: THREE.Texture | null = null, normalMap: THREE.Texture | null = null) {

        if (normalMap) {
            normalMap.wrapS = THREE.RepeatWrapping;
            normalMap.wrapT = THREE.RepeatWrapping;
        }

        super({

            name: "WaterReflectionMaterial",

            uniforms: {
                // Reflection
                reflectionTex: { value: reflectionTexture },
                hasReflection: { value: reflectionTexture !== null },
                reflectionStrength: { value: 0.5 },
                reflectionDistort: { value: 0.01 },
                // Same as createWaterMaterial
                waterColor: { value: new THREE.Color(0x3A7070) },
                deepWaterColor: { value: new THREE.Color(0x264D50) },
                shallowWaterColor: { value: new THREE.Color(0x4A8585) },
                foamColor: { value: new THREE.Color(0x9BBFBA) },
                normalMap: { value: normalMap },
                lightDir: { value: new THREE.Vector3(0.5, 1.0, 0.5).normalize() },
                time: { value: 0 },
                waveSpeed: { value: 5.0 },
                opacity: { value: 1.0 },
                uvScale: { value: 0.0025 },
                specularStrength: { value: 0.8 },
                distortionScale: { value: 3.0 },
                noiseStrength: { value: 0.25 },
                lightRayStrength: { value: 0.08 },
            },

            vertexShader: /* glsl */`
            varying vec4 vClip;
            varying vec2 vWorldUV;
            varying vec3 vNormal;
            varying vec3 vViewPosition;

            uniform float uvScale;

            void main() {
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldUV = worldPos.xy * uvScale;
                vNormal = normalize(normalMatrix * normal);

                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;

                vClip = projectionMatrix * mvPosition;
                gl_Position = vClip;
            }
            `,

            // Fragment shader = createWaterMaterial fragment + reflection blend
            fragmentShader: /* glsl */`
            uniform sampler2D reflectionTex;
            uniform bool hasReflection;
            uniform float reflectionStrength;
            uniform float reflectionDistort;

            uniform vec3 waterColor;
            uniform vec3 deepWaterColor;
            uniform vec3 shallowWaterColor;
            uniform vec3 foamColor;
            uniform sampler2D normalMap;
            uniform float opacity;
            uniform float time;
            uniform float waveSpeed;
            uniform float specularStrength;
            uniform float distortionScale;
            uniform vec3 lightDir;
            uniform float noiseStrength;
            uniform float lightRayStrength;

            varying vec4 vClip;
            varying vec2 vWorldUV;
            varying vec3 vNormal;
            varying vec3 vViewPosition;

            float random(vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
            }

            float noise(vec2 st) {
                vec2 i = floor(st);
                vec2 f = fract(st);
                float a = random(i);
                float b = random(i + vec2(1.0, 0.0));
                float c = random(i + vec2(0.0, 1.0));
                float d = random(i + vec2(1.0, 1.0));
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(a, b, u.x) +
                       (c - a) * u.y * (1.0 - u.x) +
                       (d - b) * u.x * u.y;
            }

            float fbm(vec2 p) {
                float value = 0.0;
                float amplitude = 0.5;
                float frequency = 1.0;
                for(int i = 0; i < 5; i++) {
                    value += amplitude * noise(p * frequency);
                    frequency *= 2.0;
                    amplitude *= 0.5;
                }
                return value;
            }

            void main() {
                float animSpeed = time * waveSpeed;

                // === 1. Multi-layer Normal Map ===
                vec2 uv1 = vWorldUV + vec2(animSpeed * 0.04, animSpeed * 0.03);
                vec2 uv2 = vWorldUV * 1.5 - vec2(animSpeed * 0.03, animSpeed * 0.05);
                vec2 uv3 = vWorldUV * 2.2 + vec2(animSpeed * 0.02, -animSpeed * 0.04);

                vec3 normal1 = texture2D(normalMap, uv1).rgb * 2.0 - 1.0;
                vec3 normal2 = texture2D(normalMap, uv2).rgb * 2.0 - 1.0;
                vec3 normal3 = texture2D(normalMap, uv3).rgb * 2.0 - 1.0;

                vec3 normalBlend = normalize(
                    normal1 * 0.5 +
                    normal2 * 0.3 +
                    normal3 * 0.2
                );

                vec3 finalNormal = normalize(vNormal + normalBlend * distortionScale);

                // === 2. Fresnel ===
                vec3 viewDir = normalize(vViewPosition);
                float fresnel = pow(1.0 - max(dot(viewDir, finalNormal), 0.0), 3.5);

                // === 3. LIGHT NOISE (multiple scales) ===
                float largeNoise = fbm(vWorldUV * 2.0 + animSpeed * 0.05);
                float mediumNoise = fbm(vWorldUV * 8.0 + animSpeed * 0.08);
                float smallNoise = noise(vWorldUV * 25.0 + animSpeed * 0.15);

                // === 4. Water Color with Noise ===
                float depthFactor = largeNoise * 0.5 + 0.5;
                vec3 baseColor = mix(shallowWaterColor, deepWaterColor, depthFactor * 0.4);
                baseColor = mix(baseColor, waterColor, 0.3);

                float brightness = 0.92 + mediumNoise * noiseStrength + smallNoise * (noiseStrength * 0.5);
                baseColor *= brightness;

                vec3 fresnelColor = mix(baseColor, shallowWaterColor, fresnel * 0.6);

                // === 5. LIGHT RAYS (Caustic-like effect) ===
                vec2 rayUV1 = vWorldUV * 12.0 + vec2(animSpeed * 0.12, animSpeed * 0.08);
                vec2 rayUV2 = vWorldUV * 18.0 - vec2(animSpeed * 0.08, animSpeed * 0.15);
                float rays1 = fbm(rayUV1);
                float rays2 = fbm(rayUV2);
                float lightRays = (rays1 + rays2 * 0.6) * 0.5;
                lightRays = smoothstep(0.45, 0.75, lightRays);
                fresnelColor += vec3(1.0, 1.0, 0.98) * lightRays * lightRayStrength;

                // === 6. Specular ===
                vec3 specular = vec3(0.0);
                vec3 reflectDir = reflect(-lightDir, finalNormal);
                float sharpSpec = pow(max(dot(viewDir, reflectDir), 0.0), 64.0);
                specular += vec3(1.0, 0.98, 0.9) * sharpSpec * 0.4;

                vec3 halfDir = normalize(lightDir + viewDir);
                float softSpec = pow(max(dot(finalNormal, halfDir), 0.0), 16.0);
                specular += vec3(0.9, 0.95, 1.0) * softSpec * 0.3;

                float ambientHL = pow(1.0 - abs(dot(viewDir, finalNormal)), 2.0);
                specular += vec3(1.0) * ambientHL * 0.1;

                specular *= specularStrength;
                specular *= (0.95 + smallNoise * 0.1);

                // === 7. Foam ===
                float foamNoise = fbm(vWorldUV * 15.0 + animSpeed * 0.3);
                float foamMask = smoothstep(0.7, 0.9, foamNoise) * fresnel;
                vec3 foam = foamColor * foamMask * 0.3;

                // === 8. SUBTLE SPARKLES ===
                float sparkle = pow(smallNoise, 12.0) * step(0.985, smallNoise);
                vec3 sparkles = vec3(1.0, 1.0, 0.98) * sparkle * 0.25;

                // === 9. Water Color (same as createWaterMaterial) ===
                vec3 waterResult = fresnelColor + foam + sparkles;
                float colorShift = noise(vWorldUV * 4.0 + animSpeed * 0.06);
                waterResult = mix(waterResult, waterResult * 1.06, colorShift * 0.08);

                // === 10. Reflection Blend ===
                vec3 finalColor = waterResult;
                if(hasReflection) {
                    vec2 screenUV = vClip.xy / vClip.w * 0.5 + 0.5;
                    vec2 distort = normalBlend.xy * reflectionDistort;
                    vec2 reflUV = clamp(screenUV + distort, 0.0, 1.0);
                    vec3 refl = texture2D(reflectionTex, reflUV).rgb;
                    float reflMix = reflectionStrength * fresnel + reflectionStrength * 0.3;
                    reflMix = clamp(reflMix, 0.0, 0.75);
                    finalColor = mix(waterResult, refl, reflMix);
                }

                // Specular always on top
                finalColor += specular;

                gl_FragColor = vec4(finalColor, opacity);
            }
            `,

            transparent: true,
            depthWrite: false,
            side: THREE.FrontSide,

        });

    }

    updateReflectionTexture(texture: THREE.Texture): void {
        this.uniforms.reflectionTex.value = texture;
        this.uniforms.hasReflection.value = true;
    }

    updateNormalMap(texture: THREE.Texture): void {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        this.uniforms.normalMap.value = texture;
    }

    setWaterColor(color: THREE.Color | number): void {
        if (typeof color === "number") {
            (this.uniforms.waterColor.value as THREE.Color).set(color);
        } else {
            (this.uniforms.waterColor.value as THREE.Color).copy(color);
        }
    }

    setOpacity(opacity: number): void {
        this.uniforms.opacity.value = opacity;
    }

    setTime(time: number): void {
        this.uniforms.time.value = time;
    }

    setLightDir(dir: THREE.Vector3): void {
        (this.uniforms.lightDir.value as THREE.Vector3).copy(dir);
    }
}