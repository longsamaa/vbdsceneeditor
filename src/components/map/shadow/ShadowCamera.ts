import * as THREE from 'three'
import {projectToWorldCoordinates} from "../convert/map_convert.ts";
import type {LatLon} from "../Interface.ts";
import type {CustomRenderMethodInput, UnwrappedTileID} from "maplibre-gl";

export function perspective(out: THREE.Matrix4,
                            fovy: number,
                            aspect: number,
                            near: number,
                            far: number) {
    const f = 1.0 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    out.set(
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) * nf, -1,
        0, 0, 2 * far * near * nf, 0
    );
    return out;
}

export function calculateTileMatrixThree(
    unwrappedTileID: UnwrappedTileID,
    worldSize: number,
    EXTENT : number = 8192,
): THREE.Matrix4 {
    const canonical = unwrappedTileID.canonical;
    const scale = worldSize / Math.pow(2, canonical.z);
    const unwrappedX =
        canonical.x + Math.pow(2, canonical.z) * unwrappedTileID.wrap;
    // --- Translate ---
    const translate = new THREE.Matrix4().makeTranslation(
        unwrappedX * scale,
        canonical.y * scale,
        0
    );
    // --- Scale (tile extent -> world units) ---
    const tileScale = scale / EXTENT;
    const scaleM = new THREE.Matrix4().makeScale(
        tileScale,
        tileScale,
        1
    );
    // worldMatrix = T * S   (QUAN TRỌNG)
    const worldMatrix = new THREE.Matrix4();
    worldMatrix.multiplyMatrices(translate, scaleM);
    return worldMatrix;
}

/*
export function testCreateMatrix(pixelPerOneMeter: number,
                                 worldSize: number,
                                 cameraToCenterDistance: number,
                                 lightDir: THREE.Vector3,
                                 cameraZ: number,
                                 center: LatLon,
                                 width: number,
                                 height: number,
                                 args: CustomRenderMethodInput): THREE.Matrix4 {
    const point = projectToWorldCoordinates(worldSize, center);
    const fov = args.fov;
    const nearz = args.nearZ;
    const farz = args.farZ;
// Projection matrix
    const projMatrix = new THREE.Matrix4();
    perspective(
        projMatrix,
        fov * Math.PI / 180,
        width / height,
        nearz,
        farz
    );
// Tính trong local space
    const center_p = new THREE.Vector3(point.x, point.y, 0);
    const scale = cameraZ / lightDir.z;
    const lightPos_world = center_p.clone().addScaledVector(lightDir, scale);
// Chuyển sang local space
    const center_local = new THREE.Vector3(0, 0, 0);
    const lightPos_local = lightPos_world.clone().sub(center_p);
// View matrix trong local space
    const viewMatrix = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 0, 1);
    viewMatrix.lookAt(lightPos_local, center_local, up);
// View-Projection matrix
    const m = new THREE.Matrix4();
    m.multiplyMatrices(projMatrix, viewMatrix);
// Final matrix
    const finalMatrix = new THREE.Matrix4();
    finalMatrix.copy(m);
// 1. Flip Y axis
    finalMatrix.multiply(new THREE.Matrix4().makeScale(1, -1, 1));
// 2. Translate về center
    const translateMatrix = new THREE.Matrix4();
    translateMatrix.makeTranslation(-center_p.x, -center_p.y, 0);
    finalMatrix.multiply(translateMatrix);
// 3. Scale z theo pixelPerMeter
    finalMatrix.multiply(new THREE.Matrix4().makeScale(1, 1, pixelPerOneMeter));
    return finalMatrix;
}*/
export function createMapLibreMatrix(
    fovInRadians: number,
    width: number,
    height: number,
    nearZ: number,
    farZ: number,
    cameraToCenterDistance: number,
    rollInRadians: number,
    pitchInRadians: number,
    bearingInRadians: number,
    centerX: number,
    centerY: number,
    worldSize: number,
    pixelPerMeter: number,
    elevation: number,
    offset = { x: 0, y: 0 } // center of perspective offset
) {
    const m = new Float64Array(16);
    // Tính perspective manual (giống gl-matrix)
    const f = 1.0 / Math.tan(fovInRadians / 2);
    const nf = 1 / (nearZ - farZ);
    const aspect = width / height;
    m[0] = f / aspect;
    m[1] = 0;
    m[2] = 0;
    m[3] = 0;
    m[4] = 0;
    m[5] = f;
    m[6] = 0;
    m[7] = 0;
    m[8] = 0;
    m[9] = 0;
    m[10] = (farZ + nearZ) * nf;
    m[11] = -1;
    m[12] = 0;
    m[13] = 0;
    m[14] = 2 * farZ * nearZ * nf;
    m[15] = 0;
    // 2. Apply center of perspective offset
    m[8] = -offset.x * 2 / width;
    m[9] = offset.y * 2 / height;
    // 3. Convert sang THREE.Matrix4 và tiếp tục transforms
    const mat = new THREE.Matrix4();
    mat.fromArray(m);
    // 4. Scale (flip Y)
    mat.multiply(new THREE.Matrix4().makeScale(1, -1, 1));
    // 5. Translate camera distance
    mat.multiply(new THREE.Matrix4().makeTranslation(0, 0, -cameraToCenterDistance));
    // 6-9. Rotations
    mat.multiply(new THREE.Matrix4().makeRotationZ(-rollInRadians));
    mat.multiply(new THREE.Matrix4().makeRotationX(pitchInRadians));
    mat.multiply(new THREE.Matrix4().makeRotationZ(-bearingInRadians));
    // 10. Translate to center point
    mat.multiply(new THREE.Matrix4().makeTranslation(-centerX, -centerY, 0));
    // 11. Scale Z
    mat.multiply(new THREE.Matrix4().makeScale(1, 1, pixelPerMeter));
    // 12. Translate elevation
    mat.multiply(new THREE.Matrix4().makeTranslation(0, 0, -elevation));
    return mat;
}

export function createShadowMapMatrix(
    targetX: number,
    targetY: number,
    worldSize: number,
    pixelPerMeter: number,
    fov: number,
    width: number,
    height: number,
    near: number,
    far: number,
    distance: number,
    azimuth : number,
    elevationSun : number,
    roll : number,
    offset : {x : number , y : number},
    elevation: number = 0
): THREE.Matrix4 {
    // Gọi hàm gốc
    return createMapLibreMatrix(
        fov,
        width,
        height,
        near,
        far,
        distance,
        roll,
        THREE.MathUtils.degToRad(elevationSun),
        THREE.MathUtils.degToRad(azimuth),
        targetX,
        targetY,
        worldSize,
        pixelPerMeter,
        elevation,
        offset
    );
}
