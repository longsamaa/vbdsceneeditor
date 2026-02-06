import * as THREE from 'three';

export class MaplibreShadowMesh extends THREE.Mesh {
    private sunDirVector = new THREE.Vector3();
    private plane = new THREE.Plane();
    private lightPos4D = new THREE.Vector4();
    private shadowMatrix = new THREE.Matrix4();
    private meshMatrix = new THREE.Matrix4();
    private tempVector3 = new THREE.Vector3();
    constructor(mesh: THREE.Mesh, color: number = 0x000000, opacity: number = 0.15) {
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

    update(sunDirX: number, sunDirY: number, sunDirZ: number, planeZ: number = 0) {
        this.sunDirVector.set(sunDirX, sunDirY, sunDirZ);
        this.sunDirVector.normalize();
        this.plane.normal.set(0, 0, 1);
        this.plane.constant = -planeZ;
        this.lightPos4D.set(
            -this.sunDirVector.x,
            -this.sunDirVector.y,
            -this.sunDirVector.z,
            0
        );
        this.tempVector3.set(this.lightPos4D.x, this.lightPos4D.y, this.lightPos4D.z);
        const dot = this.plane.normal.dot(this.tempVector3) - this.plane.constant * this.lightPos4D.w;
        const m = this.shadowMatrix.elements;
        const nx = this.plane.normal.x; // = 0
        const ny = this.plane.normal.y; // = 0
        const nz = this.plane.normal.z; // = 1
        const nc = -this.plane.constant; // = planeZ
        const lx = this.lightPos4D.x;
        const ly = this.lightPos4D.y;
        const lz = this.lightPos4D.z;
        const lw = this.lightPos4D.w; // = 0
        m[0] = dot - lx * nx;
        m[4] = -lx * ny;
        m[8] = -lx * nz;
        m[12] = -lx * nc;
        m[1] = -ly * nx;
        m[5] = dot - ly * ny;
        m[9] = -ly * nz;
        m[13] = -ly * nc;
        m[2] = -lz * nx;
        m[6] = -lz * ny;
        m[10] = dot - lz * nz;
        m[14] = -lz * nc;
        m[3] = -lw * nx;
        m[7] = -lw * ny;
        m[11] = -lw * nz;
        m[15] = dot - lw * nc;
        this.matrix.multiplyMatrices(this.shadowMatrix, this.meshMatrix);
    }

    /* update(sunDir: THREE.Vector3, planeZ: number = 0) {
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
     }*/
}