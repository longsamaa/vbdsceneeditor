import * as THREE from 'three';
import {OBJLoader} from 'three/examples/jsm/loaders/OBJLoader.js';
import type {ModelData} from '../Interface.ts'
import {tileLocalToLatLon} from '../convert/map_convert'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';


export function createYupToZUpMatrix(): THREE.Matrix4 {
    const matrix = new THREE.Matrix4();
    matrix.set(
        1, 0, 0, 0,
        0, 0, -1, 0,
        0, 1, 0, 0,
        0, 0, 0, 1
    );
    return matrix;
}
export function convertRawMeshYupToZup(mesh: THREE.Mesh): void {
    const matrix_y_up_to_z_up: THREE.Matrix4 = createYupToZUpMatrix();
    const tmpMatrix = new THREE.Matrix4();
    tmpMatrix.multiplyMatrices(matrix_y_up_to_z_up, mesh.matrixWorld);
    mesh.geometry.applyMatrix4(tmpMatrix);
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
}
export function bakeWorldAndConvertYupToZup(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    root.traverse(obj => {
        if (!(obj instanceof THREE.Mesh)) return;
        convertRawMeshYupToZup(obj);
        reverseFaceWinding(obj.geometry);
    });
    // 4. Reset toàn bộ hierarchy
    root.traverse(obj => {
        obj.position.set(0, 0, 0);
        obj.rotation.set(0, 0, 0);
        obj.scale.set(1, 1, 1);
        obj.updateMatrix();
        obj.updateMatrixWorld();
    });
    root.updateMatrixWorld(true);
}


export function downloadTexture(url: string): Promise<THREE.Texture> {
    return new Promise((resolve, reject) => {
        const loader = new THREE.TextureLoader();
        loader.loadAsync(url).then((texture) => {
            resolve(texture);
        }).catch((err) => {
            reject(err);
        });
    });
}

export function downloadModel(url: string): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
            const loader = new OBJLoader();
            loader.loadAsync(url).then((object) => {
                // const zUpObject = convertRawObject3DToZUp(object);
                resolve(object);
            }).catch((err) => {
                reject(err);
            });
        }
    );
}

export function reverseFaceWinding(geometry: THREE.BufferGeometry): void {
    // geometry.computeVertexNormals();
    const index = geometry.index;
    if (index) {
        const indices = index.array;
        for (let i = 0; i < indices.length; i += 3) {
            const tmp = indices[i];
            indices[i] = indices[i + 2];
            indices[i + 2] = tmp;
        }
        index.needsUpdate = true;
    } else {
        // if index null
        const position = geometry.getAttribute('position');
        if (position) {
            const posArray = position.array;
            const itemSize = position.itemSize; // Thường là 3 (x, y, z)

            // Duyệt qua từng triangle (mỗi 3 vertices)
            for (let i = 0; i < posArray.length; i += itemSize * 3) {
                // Hoán đổi vertex 0 và vertex 2 của mỗi triangle
                for (let j = 0; j < itemSize; j++) {
                    const tmp = posArray[i + j]; // vertex 0
                    posArray[i + j] = posArray[i + itemSize * 2 + j]; // vertex 2
                    posArray[i + itemSize * 2 + j] = tmp;
                }
            }
            position.needsUpdate = true;
        }
        const normal = geometry.getAttribute('normal');
        if (normal) {
            const normArray = normal.array;
            const itemSize = normal.itemSize;

            for (let i = 0; i < normArray.length; i += itemSize * 3) {
                for (let j = 0; j < itemSize; j++) {
                    const tmp = normArray[i + j];
                    normArray[i + j] = normArray[i + itemSize * 2 + j];
                    normArray[i + itemSize * 2 + j] = tmp;
                }
            }
            normal.needsUpdate = true;
        }
        const uv = geometry.getAttribute('uv');
        if (uv) {
            const uvArray = uv.array;
            const itemSize = uv.itemSize; // Thường là 2 (u, v)

            for (let i = 0; i < uvArray.length; i += itemSize * 3) {
                for (let j = 0; j < itemSize; j++) {
                    const tmp = uvArray[i + j];
                    uvArray[i + j] = uvArray[i + itemSize * 2 + j];
                    uvArray[i + itemSize * 2 + j] = tmp;
                }
            }
            uv.needsUpdate = true;
        }
    }
}

export function prepareModelForRender(model: THREE.Object3D, setDefaultMat: boolean = true): void {
    model.matrixAutoUpdate = false;
    // convert y up to z up
    const default_mat = new THREE.MeshLambertMaterial({color: 0xC0C0C0, side: THREE.DoubleSide});
    default_mat.polygonOffset = true;
    default_mat.polygonOffsetFactor = -1;
    default_mat.polygonOffsetUnits  = -1;
    //phai lat x len do y up to z up
    model.rotation.x = -Math.PI / 2;
    model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            reverseFaceWinding(child.geometry);
            if (setDefaultMat) {
                (child as THREE.Mesh).material = default_mat;
            } else {
                const mat = (child as THREE.Mesh).material;
                if (Array.isArray(mat)) {
                    for (const m of mat) {
                        m.side = THREE.DoubleSide;
                    }
                } else {
                    mat.side = THREE.DoubleSide;
                }
            }
        }
    });
    model.updateMatrix();
    model.updateMatrixWorld(true);
}

export async function loadModelFromGlb(url: string): Promise<ModelData> {
    const loader = new GLTFLoader();
    try {
        const gltf = await loader.loadAsync(url);
        const obj = gltf.scene as THREE.Object3D;
        return {
            object3d: obj,
            animations: gltf.animations
        };
    } catch (err) {
        console.error(`[loadModelFromGlb] failed to load`, url, err);
        throw err;
    }
}

//load model for instancing layer
export async function loadModelFromGlbNotAnimation(url: string): Promise<THREE.Object3D> {
    const loader = new GLTFLoader();
    try {
        const gltf = await loader.loadAsync(url);
        const obj = gltf.scene as THREE.Object3D;
        return obj;
    } catch (err) {
        console.error(`[loadModelFromGlb] failed to load`, url, err);
        throw err;
    }
}


/*export function prepareModelForEditor() : void {

}*/
export function obj3dReviceShadow(model: THREE.Object3D): void {
    model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = false;
        }
    });
}

export function decomposeObject(model: THREE.Object3D) {
    if (!model.userData) return {};
    const userData = model.userData;
    const scaleUnit = userData.scaleUnit;
    const localPos = model.position;
    const tile = userData.tile;
    const latlon = tileLocalToLatLon(tile.z, tile.x, tile.y, localPos.x, localPos.y);
    const scaleX = model.scale.x / scaleUnit;
    //Them dau - do phai lat Y
    const scaleY = -model.scale.y / scaleUnit;
    const scaleZ = model.scale.z;
    //rotate bearing
    const rad_bearing = model.rotation.z * -1;
    const bearing = THREE.MathUtils.radToDeg(rad_bearing);
    const box = new THREE.Box3();
    box.setFromObject(model);
    const min = box.min;
    const max = box.max;
    const height = max.z - min.z;
    return {
        latlon,
        tileCoord: localPos,
        elevation: model.position.z,
        scale: {scaleX, scaleY, scaleZ},
        bearing: bearing,
        height: height,
    };
}

/*CREATE LIGHT GROUP DIRECTION LIGHT, HEMILIGHT*/
export function createLightGroup(scene: THREE.Scene, dir: THREE.Vector3): void {
    const light_group = new THREE.Group();
    light_group.name = 'light_group';
    // Directional Light - Ánh nắng mặt trời buổi sáng
    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.name = 'dir_light';
    dirLight.color.setHSL(
        0.12,
        0.7,
        0.98
    );
    dirLight.target.position.copy(dir.clone().multiplyScalar(10000));
    light_group.add(dirLight);
    light_group.add(dirLight.target);
    // Hemisphere Light - Ánh sáng tán xạ từ bầu trời
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 2.5);
    hemiLight.name = 'hemi_light';
    hemiLight.color.setHSL(
        0.55,
        0.4,
        0.95
    );
    hemiLight.groundColor.setHSL(
        0.08,
        0.25,
        0.6
    );
    hemiLight.position.set(0, 0, 1);
    light_group.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    ambientLight.color.setHSL(0.15, 0.2, 1);
    light_group.add(ambientLight);
    scene.add(light_group);
}

export function objectEnableClippingPlaneZ(object: THREE.Object3D, enable: boolean): void {
    object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            const mat: THREE.Material = child.material;
            //mat phang z vector huong len
            const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
            if (Array.isArray(mat)) {
                mat.forEach(m => {
                    //Tat clipping plane
                    if (!enable) {
                        m.clippingPlanes = [];
                        m.clipIntersection = false;
                        m.clipShadows = false;
                        m.needsUpdate = true;
                    } else {
                        //bat clipping plane
                        m.clippingPlanes = [planeZ];
                        m.clipIntersection = false;
                        m.clipShadows = false;
                        m.needsUpdate = true;
                    }
                });
            } else {
                if (!enable) {
                    mat.clippingPlanes = [];
                    mat.clipIntersection = false;
                    mat.clipShadows = false;
                    mat.needsUpdate = true;
                } else {
                    //bat clipping plane
                    mat.clippingPlanes = [planeZ];
                    mat.clipIntersection = false;
                    mat.clipShadows = false;
                    mat.needsUpdate = true;
                }
            }
        }
    })
}

export function transformModel(posX: number,
                               posY: number,
                               posZ: number,
                               bearing: number,
                               objectScale: number,
                               scaleUnit: number,
                               objec3d: THREE.Object3D): void {
    objec3d.scale.set(
        scaleUnit * objectScale,
        -objectScale,
        scaleUnit * objectScale,
    );
    objec3d.position.set(posX,
        posY,
        posZ);
    objec3d.rotation.y = THREE.MathUtils.degToRad(bearing);
    objec3d.matrixAutoUpdate = false;
    objec3d.updateMatrix();
    objec3d.updateMatrixWorld(true);
}

export function isGlbModel(modelUrl: string): boolean {
    try {
        const url = new URL(modelUrl, window.location.origin);
        return url.pathname.toLowerCase().endsWith('.glb');
    } catch {
        // fallback nếu modelUrl không phải URL chuẩn
        return modelUrl.toLowerCase().split('?')[0].endsWith('.glb');
    }
}


