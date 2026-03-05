import * as THREE from 'three';
import {GroundShadowMaterial} from './ShadowLitMaterial';

export class MaplibreShadowMesh extends THREE.Mesh {
    private sunDirVector = new THREE.Vector3();
    private plane = new THREE.Plane();
    private lightPos4D = new THREE.Vector4();
    private shadowMatrix = new THREE.Matrix4();
    private meshMatrix = new THREE.Matrix4();
    private scaleMatrix = new THREE.Matrix4();
    private tempVector3 = new THREE.Vector3();
    constructor(mesh: THREE.Mesh, color: number = 0x000000, opacity: number = 0.4) {
        const groundShadowMat = new THREE.MeshBasicMaterial({
            color: color,
            polygonOffset: true,
            polygonOffsetFactor: 4,
            polygonOffsetUnits: 4,
            transparent: true,
            opacity: opacity,
            depthWrite: false,
            stencilWrite: true,
            stencilFunc: THREE.EqualStencilFunc,
            stencilRef: 0,
            stencilZPass: THREE.IncrementStencilOp,
            side: THREE.DoubleSide
        });
        super(mesh.geometry, groundShadowMat);
        this.meshMatrix = mesh.matrixWorld;
        this.frustumCulled = false;
        // Clip shadow theo bounding box XY của object — cắt phần nằm trong footprint
        mesh.geometry.computeBoundingBox();
    }

    update(sunDirX: number, sunDirY: number, sunDirZ: number, planeZ: number = 0) {
        this.sunDirVector.set(sunDirX, sunDirY, sunDirZ);
        this.sunDirVector.normalize();
        this.plane.normal.set(0, 0, 1);
        this.plane.constant = -planeZ;
        this.lightPos4D.set(
            this.sunDirVector.x,
            this.sunDirVector.y,
            this.sunDirVector.z,
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
        const scale = 1.0;
        this.scaleMatrix.copy(this.meshMatrix);
        this.scaleMatrix.scale(this.tempVector3.set(scale, scale, 1));
        this.matrix.multiplyMatrices(this.shadowMatrix, this.scaleMatrix);
    }
}

export class GroundShadowMesh extends THREE.Mesh {
    private sunDirVector = new THREE.Vector3();
    private plane = new THREE.Plane();
    private lightPos4D = new THREE.Vector4();
    private shadowMatrix = new THREE.Matrix4();
    private meshMatrix = new THREE.Matrix4();
    private scaleMatrix = new THREE.Matrix4();
    private tempVector3 = new THREE.Vector3();
    constructor(mesh: THREE.Mesh, opacity: number = 0.5) {
        const groundShadowMat = new GroundShadowMaterial();
        groundShadowMat.setOpacity(opacity);
        super(mesh.geometry, groundShadowMat);
        this.meshMatrix = mesh.matrixWorld;
        this.frustumCulled = false;
        mesh.geometry.computeBoundingBox();
    }

    update(sunDirX: number, sunDirY: number, sunDirZ: number, planeZ: number = 0) {
        this.sunDirVector.set(sunDirX, sunDirY, sunDirZ);
        this.sunDirVector.normalize();
        this.plane.normal.set(0, 0, 1);
        this.plane.constant = -planeZ;
        this.lightPos4D.set(
            this.sunDirVector.x,
            this.sunDirVector.y,
            this.sunDirVector.z,
            0
        );
        this.tempVector3.set(this.lightPos4D.x, this.lightPos4D.y, this.lightPos4D.z);
        const dot = this.plane.normal.dot(this.tempVector3) - this.plane.constant * this.lightPos4D.w;
        const m = this.shadowMatrix.elements;
        const nx = this.plane.normal.x;
        const ny = this.plane.normal.y;
        const nz = this.plane.normal.z;
        const nc = -this.plane.constant;
        const lx = this.lightPos4D.x;
        const ly = this.lightPos4D.y;
        const lz = this.lightPos4D.z;
        const lw = this.lightPos4D.w;
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
        const scale = 1.0;
        this.scaleMatrix.copy(this.meshMatrix);
        this.scaleMatrix.scale(this.tempVector3.set(scale, scale, 1));
        this.matrix.multiplyMatrices(this.shadowMatrix, this.scaleMatrix);
    }

    getGroundShadowMaterial(): GroundShadowMaterial {
        return this.material as GroundShadowMaterial;
    }
}