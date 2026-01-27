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
