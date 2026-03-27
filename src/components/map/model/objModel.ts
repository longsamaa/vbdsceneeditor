import * as THREE from 'three';
import {OBJLoader} from 'three/examples/jsm/loaders/OBJLoader.js';
import type {LightGroup, ModelData} from '../Interface.ts'
import {tileLocalToLatLon} from '../convert/map_convert'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {ShadowLitMaterial} from '../shadow/ShadowLitMaterial';



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

export async function downloadModel(url: string): Promise<ModelData> {
    if (url.endsWith('.glb') || url.endsWith('.gltf')) {
        return await loadModelFromGlb(url);
    }
    const loader = new OBJLoader();
    const object = await loader.loadAsync(url);
    return { object3d: object, animations: null };
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
    const default_mat = new THREE.MeshLambertMaterial({color: 0xFFFFFF, side: THREE.FrontSide});
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
            }
        }
    });
    model.updateMatrix();
    model.updateMatrixWorld(true);
}

export async function loadModelFromGlb(url: string): Promise<ModelData> {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${resp.status}`);
    const buffer = await resp.arrayBuffer();
    const loader = new GLTFLoader();
    const gltf = await new Promise<any>((resolve, reject) => {
        loader.parse(buffer, '', resolve, reject);
    });
    const obj = gltf.scene as THREE.Object3D;
    return {
        object3d: obj,
        animations: gltf.animations
    };
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
    // transformModel: scale.set(scaleUnit * objectScale, -objectScale, scaleUnit * objectScale)
    const scale = model.scale.x / scaleUnit;
    // transformModel: rotation.y = degToRad(bearing)
    const bearing = THREE.MathUtils.radToDeg(model.rotation.y);
    const box = new THREE.Box3();
    box.setFromObject(model);
    const height = box.max.z - box.min.z;
    return {
        latlon,
        tileCoord: localPos,
        elevation: model.position.z,
        scale,
        bearing,
        height,
    };
}

/*CREATE LIGHT GROUP DIRECTION LIGHT, HEMILIGHT*/

export function createLightGroup(dir: THREE.Vector3): LightGroup {
    const group = new THREE.Group() as LightGroup;
    group.name = 'light_group';
    const dirLight = new THREE.DirectionalLight(0xffffff, 5);
    dirLight.name = 'dir_light';
    dirLight.color.setHSL(0.12, 0.7, 0.98);
    dirLight.target.position.copy(dir.clone().multiplyScalar(3000000));
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 2.5);
    hemiLight.name = 'hemi_light';
    hemiLight.color.setHSL(0.55, 0.4, 0.95);
    hemiLight.groundColor.setHSL(0.08, 0.25, 0.6);
    hemiLight.position.set(0, 0, -1);
    const ambientLight = new THREE.AmbientLight(0xffffff, 1);
    ambientLight.color.setHSL(0.15, 0.2, 1);
    group.dirLight = dirLight;
    group.hemiLight = hemiLight;
    group.ambientLight = ambientLight;
    group.add(dirLight, dirLight.target, hemiLight, ambientLight);
    return group;
}


export function createBuildingGroup(scene: THREE.Scene){
    const building_group = new THREE.Group();
    building_group.name = 'building_group';
    scene.add(building_group);
}

export function createShadowGroup(scene: THREE.Scene): void {
    const shadow_group = new THREE.Group();
    shadow_group.name = "shadow_group";
    scene.add(shadow_group);
}

export function objectEnableClippingPlaneZ(object: THREE.Object3D, enable: boolean): void {
    const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            const mats: THREE.Material[] = Array.isArray(child.material) ? child.material : [child.material];
            for (const m of mats) {
                if (m instanceof ShadowLitMaterial) {
                    m.setClippingPlane(enable ? planeZ : null);
                    m.needsUpdate = true;
                }
            }
        }
    });
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

/**
 * Replace mesh material with ShadowLitMaterial, extracting all relevant properties
 * from the original material (color, map, alphaMap, alphaTest, opacity, vertexColors, side).
 */
function convertOneMaterial(origMat: THREE.MeshStandardMaterial, geometry: THREE.BufferGeometry): ShadowLitMaterial {
    const shadowMat = new ShadowLitMaterial();

    if (!origMat) {
        return shadowMat;
    }

    shadowMat.name = origMat.name;

    // base color
    if (origMat.color) {
        shadowMat.uniforms.baseColor.value.copy(origMat.color);
    }

    // diffuse map (base texture)
    if (origMat.map) {
        shadowMat.uniforms.baseMap.value = origMat.map;
        shadowMat.uniforms.hasBaseMap.value = 1;
        shadowMat.uniforms.baseColor.value.set(1, 1, 1);
    }

    // alpha map (separate alpha texture)
    if (origMat.alphaMap) {
        shadowMat.uniforms.alphaMap.value = origMat.alphaMap;
        shadowMat.uniforms.hasAlphaMap.value = 1;
    }

    // alpha test — detect RGBA textures that need alpha cutoff
    const hasAlpha = origMat.alphaTest > 0 || origMat.transparent || origMat.alphaMap != null
        || (origMat.map?.format === THREE.RGBAFormat);
    if (origMat.alphaTest > 0) {
        shadowMat.uniforms.alphaTest.value = origMat.alphaTest;
    } else if (hasAlpha) {
        shadowMat.uniforms.alphaTest.value = 0.5;
    }

    // opacity
    if (origMat.opacity < 1.0) {
        shadowMat.setOpacity(origMat.opacity);
    }
    if (hasAlpha) {
        shadowMat.transparent = true;
    }

    // side
    shadowMat.side = THREE.DoubleSide;
    shadowMat.name = origMat.name; 
    // vertex colors
    if (origMat.vertexColors && geometry.hasAttribute('color')) {
        shadowMat.defines = { ...shadowMat.defines, USE_VERTEX_COLOR: '' };
        shadowMat.needsUpdate = true;
    }

    return shadowMat;
}

export function applyShadowLitMaterial(mesh: THREE.Mesh): ShadowLitMaterial[] {
    if (Array.isArray(mesh.material)) {
        const origin_mat : THREE.Material[] = mesh.material; 
        const shadowMats = mesh.material.map((mat) =>
            convertOneMaterial(mat as THREE.MeshStandardMaterial, mesh.geometry)
        );
        mesh.material = shadowMats;
        mesh.userData._originMat = origin_mat; 
        return shadowMats;
    }
    const origin_mat : THREE.Material = mesh.material; 
    const shadowMat = convertOneMaterial(mesh.material as THREE.MeshStandardMaterial, mesh.geometry);
    mesh.material = shadowMat;
    mesh.userData._originMat = origin_mat;
    mesh.material.name = origin_mat.name;  
    return [shadowMat];
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

export function parseUrl(url: string): { fileName: string; extension: string } {
    const clean = url.split('?')[0].split('#')[0];
    const lastSlash = clean.lastIndexOf('/');
    const fullName = lastSlash >= 0 ? clean.substring(lastSlash + 1) : clean;
    const dotIdx = fullName.lastIndexOf('.');
    if (dotIdx <= 0) return { fileName: fullName, extension: '' };
    return { fileName: fullName, extension: fullName.substring(dotIdx + 1).toLowerCase() };
}



