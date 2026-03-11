import * as THREE from 'three'
import {createMapLibreMatrix} from '../shadow/ShadowCamera.ts'

const REFLECT_Z = new THREE.Matrix4().makeScale(1, 1, -1);

/**
 * Create a planar reflection camera matrix.
 * Mirrors the main camera across the water plane (Z = 0).
 */
export function createWaterReflectionMatrix(
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
    offset = { x: 0, y: 0 }
): THREE.Matrix4 {
    const viewProj = createMapLibreMatrix(
        fovInRadians,
        width,
        height,
        nearZ,
        farZ,
        cameraToCenterDistance,
        rollInRadians,
        pitchInRadians,
        bearingInRadians,
        centerX,
        centerY,
        pixelPerMeter,
        elevation,
        offset
    );

    // Reflect Z across plane Z=0: flip Z axis
    viewProj.multiply(REFLECT_Z);

    return viewProj;
}
