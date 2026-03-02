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
        pixelPerMeter,
        elevation,
        offset
    );
}


export function createShadowMapMatrixOrtho(
    targetX: number,
    targetY: number,
    pixelPerMeter: number,
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
    return createSunOrthoShadowMatrix(
        targetX,
        targetY,
        pixelPerMeter,
        roll,
        THREE.MathUtils.degToRad(elevationSun),
        THREE.MathUtils.degToRad(azimuth),
        width,
        height,
        near,
        far,
        distance,
        elevation,
        offset
    );
}

export function createSunOrthoShadowMatrix(
    centerX: number,
    centerY: number,
    pixelPerMeter: number,
    rollInRadians: number,
    pitchInRadians: number,
    bearingInRadians: number,
    sizeX: number,
    sizeY: number,
    nearZ : number,
    farZ : number,
    cameraToCenterDistance : number,
    elevation : number,
    offset : {x : number , y : number},
): THREE.Matrix4 {
    // Match MapLibre main camera order for the world-space part:
    //   Translate(-center) → ScaleZ(ppm) → Translate(-elev)
    // Then replace camera rotation/projection with sun direction + ortho.
    //
    // Ortho * FlipY * Translate(-dist) * RotX(sunElev) * RotZ(-sunAz) * Translate(-center) * ScaleZ(ppm) * Translate(-elev)

    const m = createOrthoMatrix(sizeX, sizeY, nearZ, farZ, offset);
    const mat = new THREE.Matrix4();
    mat.fromArray(m);
    // Flip Y (MapLibre Y-down → Y-up)
    mat.multiply(new THREE.Matrix4().makeScale(1, -1, 1));
    // Push camera back along light direction
    mat.multiply(new THREE.Matrix4().makeTranslation(0, 0, -cameraToCenterDistance));
    // Sun rotation (elevation around X, azimuth around Z)
    mat.multiply(new THREE.Matrix4().makeRotationX(pitchInRadians));
    mat.multiply(new THREE.Matrix4().makeRotationZ(-bearingInRadians));
    // Translate to center (same as MapLibre)
    mat.multiply(new THREE.Matrix4().makeTranslation(-centerX, -centerY, 0));
    // Scale Z — AFTER translate, BEFORE elevation (same position as MapLibre main camera)
    mat.multiply(new THREE.Matrix4().makeScale(1, 1, pixelPerMeter));
    // Elevation offset
    mat.multiply(new THREE.Matrix4().makeTranslation(0, 0, -elevation));
    return mat;
}

export function createOrthoMatrix(
    width: number,
    height: number,
    nearZ: number,
    farZ: number,
    offset: { x: number; y: number } = { x: 0, y: 0 }
): Float64Array {
    const m = new Float64Array(16);
    const left   = -width / 2;
    const right  =  width / 2;
    const bottom = -height / 2;
    const top    =  height / 2;
    const near   = nearZ;
    const far    = farZ;
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);
    // Row 1
    m[0]  = -2 * lr;
    m[1]  = 0;
    m[2]  = 0;
    m[3]  = 0;
    // Row 2
    m[4]  = 0;
    m[5]  = -2 * bt;
    m[6]  = 0;
    m[7]  = 0;
    // Row 3
    m[8]  = 0;
    m[9]  = 0;
    m[10] = 2 * nf;
    m[11] = 0;  
    // Row 4
    m[12] = (left + right) * lr;
    m[13] = (top + bottom) * bt;
    m[14] = (far + near) * nf;
    m[15] = 1;

    if (offset.x !== 0 || offset.y !== 0) {
        m[12] += -offset.x * 2 / width;
        m[13] +=  offset.y * 2 / height;
    }

    return m;
}