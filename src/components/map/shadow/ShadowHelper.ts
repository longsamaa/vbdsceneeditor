import * as THREE from 'three';
// @ts-ignore
import * as SunCalc from 'suncalc';

export function createSunLightArrow(dir: THREE.Vector3, scaleUnit: number): THREE.ArrowHelper {
    const length = 3000;
    const arrow = new THREE.ArrowHelper(
        new THREE.Vector3(dir.x, dir.y, 0).normalize(),       // hướng
        new THREE.Vector3(4096, 4096, 0),    // điểm gốc
        length,    // độ dài
        0xff0000,  // màu,
        400,
        400
    );
    arrow.traverse(child => {
        if (child instanceof THREE.Mesh) {
            if (child.material) {
                child.material.depthTest = false;
                child.material.depthWrite = false;
            }
        }
    });
    arrow.position.z = 50;
    arrow.scale.set(1, -1, 1 / scaleUnit);
    return arrow;
}

/*Tính hướng của ánh sáng mặt trời với azimuth và altitude*/
export function calculateSunDirectionMaplibre(altitude: number /*radian*/, azimuth: number /*radian*/, out?: THREE.Vector3): THREE.Vector3 {
    const dir = out ?? new THREE.Vector3();
    dir.x = -Math.sin(azimuth) * Math.cos(altitude);
    dir.y = Math.cos(azimuth) * Math.cos(altitude);
    dir.z = Math.sin(altitude);
    return dir.normalize();
}

export function getSunPosition(lat: number, lon: number) {
    const now = new Date();
    const sunPos = SunCalc.getPosition(now, lat, lon);

    // Ban đêm (mặt trời dưới đường chân trời) → dùng vị trí mặt trăng
    if (sunPos.altitude < 0) {
        const moonPos = SunCalc.getMoonPosition(now, lat, lon);
        console.log(moonPos); 
        return {
            altitude: moonPos.altitude * (180 / Math.PI),
            azimuth: moonPos.azimuth * (180 / Math.PI) + 180,
            altitudeRad: moonPos.altitude,
            azimuthRad: moonPos.azimuth,
            time: now.toLocaleString('vi-VN', {timeZone: 'Asia/Ho_Chi_Minh'}),
            source: 'moon' as const,
        };
    }

    return {
        altitude: sunPos.altitude * (180 / Math.PI),
        azimuth: sunPos.azimuth * (180 / Math.PI) + 180,
        altitudeRad: sunPos.altitude,
        azimuthRad: sunPos.azimuth,
        time: now.toLocaleString('vi-VN', {timeZone: 'Asia/Ho_Chi_Minh'}),
        source: 'sun' as const,
    };
}

export interface TimeOfDayColors {
    lightColor: THREE.Color;
    skyColor: THREE.Color;
    groundColor: THREE.Color;
    shadowColor: THREE.Color;
    ambient: number;
    diffuseIntensity: number;
}

function lerpColor(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
    return new THREE.Color().lerpColors(a, b, t);
}

/**
 * Returns lighting colors based on sun altitude (degrees).
 * Smoothly transitions between night, dawn/dusk, morning/evening, and midday.
 */
export function getTimeOfDayColors(altitudeDeg: number, source: 'sun' | 'moon' = 'sun'): TimeOfDayColors {
    if (source === 'moon') {
        return {
            lightColor:    new THREE.Color(0.4, 0.45, 0.6),
            skyColor:      new THREE.Color(0.15, 0.15, 0.25),
            groundColor:   new THREE.Color(0.08, 0.08, 0.12),
            shadowColor:   new THREE.Color(0.1, 0.1, 0.15),
            ambient:       0.3,
            diffuseIntensity: 0.2,
        };
    }

    // Define color stops by altitude
    const night     = { light: new THREE.Color(0.3, 0.3, 0.45),   sky: new THREE.Color(0.15, 0.15, 0.25),  ground: new THREE.Color(0.08, 0.08, 0.12), shadow: new THREE.Color(0.1, 0.1, 0.15),   ambient: 0.3, diffuse: 0.15 };
    const dawn      = { light: new THREE.Color(1.0, 0.6, 0.3),    sky: new THREE.Color(0.9, 0.55, 0.35),   ground: new THREE.Color(0.5, 0.35, 0.25), shadow: new THREE.Color(0.4, 0.3, 0.35),   ambient: 0.55, diffuse: 0.6 };
    const morning   = { light: new THREE.Color(1.0, 0.85, 0.65),  sky: new THREE.Color(0.75, 0.8, 0.9),    ground: new THREE.Color(0.55, 0.5, 0.45), shadow: new THREE.Color(0.45, 0.42, 0.48), ambient: 0.7, diffuse: 0.85 };
    const midday    = { light: new THREE.Color(1.0, 0.96, 0.88),  sky: new THREE.Color(0.85, 0.85, 0.87),  ground: new THREE.Color(0.6, 0.58, 0.56), shadow: new THREE.Color(0.5, 0.5, 0.52),   ambient: 0.8, diffuse: 1.0 };

    let a: typeof night, b: typeof night, t: number;

    if (altitudeDeg <= 0) {
        // Night
        a = night; b = night; t = 0;
    } else if (altitudeDeg <= 6) {
        // Dawn/dusk: 0° → 6°
        a = night; b = dawn; t = altitudeDeg / 6;
    } else if (altitudeDeg <= 20) {
        // Early morning: 6° → 20°
        a = dawn; b = morning; t = (altitudeDeg - 6) / 14;
    } else if (altitudeDeg <= 40) {
        // Morning to midday: 20° → 40°
        a = morning; b = midday; t = (altitudeDeg - 20) / 20;
    } else {
        // Midday
        a = midday; b = midday; t = 0;
    }

    return {
        lightColor:      lerpColor(a.light, b.light, t),
        skyColor:        lerpColor(a.sky, b.sky, t),
        groundColor:     lerpColor(a.ground, b.ground, t),
        shadowColor:     lerpColor(a.shadow, b.shadow, t),
        ambient:         a.ambient + (b.ambient - a.ambient) * t,
        diffuseIntensity: a.diffuse + (b.diffuse - a.diffuse) * t,
    };
}

export function buildShadowMatrix(
    sunDir: THREE.Vector3,
    planeZ: number,
    out: THREE.Matrix4
) {
    // ✅ Normalize inline (không clone)
    const length = Math.sqrt(sunDir.x * sunDir.x + sunDir.y * sunDir.y + sunDir.z * sunDir.z);
    const invLength = 1 / length;
    const lx = sunDir.x * invLength;
    const ly = sunDir.y * invLength;
    const lz = sunDir.z * invLength;
    const dot = lz;
    const nc = planeZ; // -(-planeZ)
    const m = out.elements;
    m[0] = dot;      // dot - lx * 0
    m[4] = 0;        // -lx * 0
    m[8] = -lx;      // -lx * 1
    m[12] = -lx * nc;

    m[1] = 0;        // -ly * 0
    m[5] = dot;      // dot - ly * 0
    m[9] = -ly;      // -ly * 1
    m[13] = -ly * nc;

    m[2] = 0;        // -lz * 0
    m[6] = 0;        // -lz * 0
    m[10] = 0;       // dot - lz * 1 = lz - lz = 0
    m[14] = -lz * nc;

    m[3] = 0;        // -lw * 0
    m[7] = 0;        // -lw * 0
    m[11] = 0;       // -lw * 1
    m[15] = dot;     // dot - lw * planeZ = dot
}
