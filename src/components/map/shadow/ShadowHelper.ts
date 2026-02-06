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
export function calculateSunDirectionMaplibre(altitude: number /*radian*/, azimuth: number /*radian*/): THREE.Vector3 {
    const oaz_dir = new THREE.Vector3(0, -1, 0);
    oaz_dir.x = -Math.sin(azimuth) * Math.cos(altitude);
    oaz_dir.y = Math.cos(azimuth) * Math.cos(altitude);
    oaz_dir.z = Math.sin(altitude);
    return oaz_dir.normalize();
}

export function getSunPosition(lat: number, lon: number) {
    // Lấy thời gian hiện tại (JavaScript Date tự động dùng múi giờ local)
    const now = new Date();
    // Lấy vị trí mặt trời
    const sunPos = SunCalc.getPosition(now, lat, lon);
    return {
        altitude: sunPos.altitude * (180 / Math.PI), // Độ cao (elevation) - chuyển từ radian sang độ
        azimuth: sunPos.azimuth * (180 / Math.PI) + 180, // Góc phương vị - chuyển từ radian sang độ và điều chỉnh (0° = Bắc)
        altitudeRad: sunPos.altitude, // Độ cao (radian)
        azimuthRad: sunPos.azimuth, // Góc phương vị (radian)
        time: now.toLocaleString('vi-VN', {timeZone: 'Asia/Ho_Chi_Minh'})
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
    const lx = -sunDir.x * invLength;
    const ly = -sunDir.y * invLength;
    const lz = -sunDir.z * invLength;

    // ✅ Plane normal = (0, 0, 1), constant = -planeZ
    // dot = (0,0,1) · (lx,ly,lz) - (-planeZ) * 0 = lz
    const dot = lz;
    const nc = planeZ; // -(-planeZ)

    // ✅ Build matrix (plane normal nx=0, ny=0, nz=1)
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

/*export function buildShadowMatrix(
    sunDir: THREE.Vector3,
    planeZ: number,
    out: THREE.Matrix4
) {
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);
    const lightDir = sunDir.clone().normalize();
    const lightPos4D = new THREE.Vector4(-lightDir.x, -lightDir.y, -lightDir.z, 0);
    const dot =
        plane.normal.dot(new THREE.Vector3(lightPos4D.x, lightPos4D.y, lightPos4D.z)) -
        plane.constant * lightPos4D.w;
    const m = out.elements;

    m[0]  = dot - lightPos4D.x * plane.normal.x;
    m[4]  = -lightPos4D.x * plane.normal.y;
    m[8]  = -lightPos4D.x * plane.normal.z;
    m[12] = -lightPos4D.x * -plane.constant;

    m[1]  = -lightPos4D.y * plane.normal.x;
    m[5]  = dot - lightPos4D.y * plane.normal.y;
    m[9]  = -lightPos4D.y * plane.normal.z;
    m[13] = -lightPos4D.y * -plane.constant;

    m[2]  = -lightPos4D.z * plane.normal.x;
    m[6]  = -lightPos4D.z * plane.normal.y;
    m[10] = dot - lightPos4D.z * plane.normal.z;
    m[14] = -lightPos4D.z * -plane.constant;

    m[3]  = -lightPos4D.w * plane.normal.x;
    m[7]  = -lightPos4D.w * plane.normal.y;
    m[11] = -lightPos4D.w * plane.normal.z;
    m[15] = dot - lightPos4D.w * -plane.constant;
}*/

