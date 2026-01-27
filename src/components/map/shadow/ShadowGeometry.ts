import * as THREE from 'three';

export class MaplibreShadowMesh extends THREE.Mesh {
    private meshMatrix: THREE.Matrix4 = new THREE.Matrix4();
    private shadowMatrix: THREE.Matrix4 = new THREE.Matrix4();

    constructor(mesh: THREE.Mesh, color: number = 0x000000, opacity: number = 0.35) {
        const shadow_mat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: opacity,
            depthWrite: false,
            stencilWrite: true,
            stencilFunc: THREE.EqualStencilFunc,
            stencilRef: 0,
            stencilZPass: THREE.IncrementStencilOp,
            side: THREE.DoubleSide
        });
        super(mesh.geometry, shadow_mat);
        this.meshMatrix = mesh.matrixWorld;
    }

    update(sunDir: THREE.Vector3, planeZ: number = 0) {
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);
        const lightDir = sunDir.clone().normalize();
        const lightPos4D = new THREE.Vector4(-lightDir.x, -lightDir.y, -lightDir.z, 0);
        const dot = plane.normal.dot(new THREE.Vector3(lightPos4D.x, lightPos4D.y, lightPos4D.z))
            - plane.constant * lightPos4D.w;
        const m = this.shadowMatrix.elements;
        m[0] = dot - lightPos4D.x * plane.normal.x;
        m[4] = -lightPos4D.x * plane.normal.y;
        m[8] = -lightPos4D.x * plane.normal.z;
        m[12] = -lightPos4D.x * -plane.constant;

        m[1] = -lightPos4D.y * plane.normal.x;
        m[5] = dot - lightPos4D.y * plane.normal.y;
        m[9] = -lightPos4D.y * plane.normal.z;
        m[13] = -lightPos4D.y * -plane.constant;

        m[2] = -lightPos4D.z * plane.normal.x;
        m[6] = -lightPos4D.z * plane.normal.y;
        m[10] = dot - lightPos4D.z * plane.normal.z;
        m[14] = -lightPos4D.z * -plane.constant;

        m[3] = -lightPos4D.w * plane.normal.x;
        m[7] = -lightPos4D.w * plane.normal.y;
        m[11] = -lightPos4D.w * plane.normal.z;
        m[15] = dot - lightPos4D.w * -plane.constant;
        this.matrix.multiplyMatrices(this.shadowMatrix, this.meshMatrix);
    }
}