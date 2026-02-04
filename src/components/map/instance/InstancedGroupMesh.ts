import * as THREE from 'three'

const _matrix = new THREE.Matrix4()

class InstancedGroupMesh extends THREE.Group {
    isInstancedGroupMesh = true

    count: number = 0
    meshCollect: Record<string, THREE.Mesh[]> = {}
    instanceCollect: Record<string, THREE.InstancedMesh> = {}
    userDataArray: Record<string, unknown>[] = []
    constructor(group: THREE.Group, count: number) {
        super()
        this.count = count
        const { meshCollect, instanceCollect } = this;
        this.userDataArray = new Array(count).fill(null).map(() => ({}));
        // collect all mesh counts, in case there are more than one copy of the same mesh in this group
        group.traverse((obj) => {
            if (obj.type !== 'Mesh') return
            const mesh = obj as THREE.Mesh
            // this is important
            mesh.updateMatrix()
            mesh.updateMatrixWorld(true);
            // same geometry and same material consider as the same mesh
            const uuid = mesh.geometry.uuid + '/' + (mesh.material as THREE.Material).uuid
            if (meshCollect[uuid]) {
                meshCollect[uuid].push(mesh)
            } else {
                meshCollect[uuid] = [mesh]
            }
        })
        // create all instances
        Object.keys(meshCollect).forEach(uuid => {
            const meshes = meshCollect[uuid]
            const mesh = meshes[0]
            const instancedMesh = new THREE.InstancedMesh(mesh.geometry, mesh.material, meshes.length * count)
            instanceCollect[uuid] = instancedMesh
            this.add(instancedMesh)
        })
    }
    setMatrixAt(index: number, matrix: THREE.Matrix4) {
        Object.keys(this.meshCollect).forEach(uuid => {
            const instancedMesh = this.instanceCollect[uuid]
            const collect = this.meshCollect[uuid]
            collect.forEach((mesh: THREE.Mesh, i: number) => {
                _matrix.copy(mesh.matrix);
                _matrix.premultiply(matrix);
                instancedMesh.setMatrixAt(collect.length * index + i, _matrix);
                instancedMesh.instanceMatrix.needsUpdate = true;
            })
        })
    }
    getMatrixAt(index: number, target = new THREE.Matrix4()) {
        const uuids = Object.keys(this.meshCollect)
        if (uuids.length === 0) return null
        const uuid = uuids[0]
        const instancedMesh = this.instanceCollect[uuid]
        // lấy instance đầu tiên của logical index
        const rawIndex = this.meshCollect[uuid].length * index
        instancedMesh.getMatrixAt(rawIndex, target)
        return target
    }
    setUserDataAt(index: number, userData: Record<string, unknown>): void {
        if (index < 0 || index >= this.count) {
            console.warn(`Index ${index} out of bounds`)
            return
        }
        this.userDataArray[index] = userData
    }
    getUserDataAt(index: number): Record<string, unknown> | null {
        if (index < 0 || index >= this.count) {
            console.warn(`Index ${index} out of bounds`)
            return null
        }
        return this.userDataArray[index]
    }

}

export default InstancedGroupMesh;