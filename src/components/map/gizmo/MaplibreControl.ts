import * as THREE from 'three';
import {Vector3} from 'three';
import {TransformControls} from 'three/examples/jsm/controls/TransformControls.js';

export type HoverParameter = {
    object3D: THREE.Object3D;
    ndc_x: number;
    ndc_y: number;
}

class MaplibreTransformControls extends TransformControls {
    private map: any;
    private currentTile: any;
    private applyGlobeMatrix: boolean;
    private tempVector = new THREE.Vector3();
    private tempVector2 = new THREE.Vector3();
    private tempQuaternion = new THREE.Quaternion();
    private unit: {
        X: Vector3;
        Y: Vector3;
        Z: Vector3;
    } = {X: new Vector3(1, 0, 0), Y: new Vector3(0, 1, 0), Z: new Vector3(0, 0, 1)};
    private max_X: number = Infinity;
    private min_X: number = -Infinity;
    private min_Y: number = -Infinity;
    private max_Y: number = Infinity;
    private min_Z: number = -Infinity;
    private max_Z: number = Infinity;
    onHover?: (parameter: HoverParameter) => void;
    onNotHover?: () => void;
    constructor(camera: THREE.Camera, domElement: HTMLElement, map: any, applyGlobeMatrix: boolean = false) {
        super(camera, domElement);
        this.map = map;
        this.applyGlobeMatrix = applyGlobeMatrix;
        this.overrideGizmoUpdate();
    }
    overrideGizmoUpdate(): void {
        const gizmo = (this as any)._gizmo;
        if (gizmo && typeof gizmo.updateMatrixWorld === 'function') {
            const originalUpdate = gizmo.updateMatrixWorld.bind(gizmo);
            const self = this;
            gizmo.updateMatrixWorld = function (force?: boolean) {
                // Call original update
                originalUpdate(force);
                let handles: any[] = [];
                let default_d = 100;
                if (self.object) {
                    const box3 = new THREE.Box3();
                    box3.setFromObject(self.object);
                    const dx = box3.max.x - box3.min.x;
                    const dy = box3.max.y - box3.min.y;
                    const dz = box3.max.z - box3.min.z;
                    default_d = Math.max(dx, dy, dz);
                }
                handles = handles.concat(this.picker[this.mode].children);
                handles = handles.concat(this.gizmo[this.mode].children);
                handles = handles.concat(this.helper[this.mode].children);
                for (let i = 0; i < handles.length; i++) {
                    const handle = handles[i];
                    handle.scale.set(default_d, default_d, default_d);
                    handle.updateMatrix();
                    handle.updateMatrixWorld(true);
                }
            }
        }
    }

    setCurrentTile(tile: any) {
        this.currentTile = tile;
    }

    private updateRayCast(ndc: THREE.Vector2, raycaster: THREE.Raycaster): boolean {
        if (!this.map || !this.currentTile) return false;
        const tr: any = (this.map as any).transform;
        if (!tr?.getProjectionData) {
            false;
        }
        const proj = tr.getProjectionData({
            overscaledTileID: this.currentTile,
            applyGlobeMatrix: this.applyGlobeMatrix,
        });
        const mvp = new THREE.Matrix4().fromArray(proj.mainMatrix as any);
        const inv = mvp.clone().invert();
        const pNear = new THREE.Vector4(ndc.x, ndc.y, -1, 1).applyMatrix4(inv);
        pNear.multiplyScalar(1 / pNear.w);
        const pFar = new THREE.Vector4(ndc.x, ndc.y, 1, 1).applyMatrix4(inv);
        pFar.multiplyScalar(1 / pFar.w);
        const origin = new THREE.Vector3(pNear.x, pNear.y, pNear.z);
        const direction = new THREE.Vector3(pFar.x, pFar.y, pFar.z).sub(origin).normalize();
        raycaster.ray.origin.copy(origin);
        raycaster.ray.direction.copy(direction);
        return true;
    }

    pointerHover(pointer: any): void {
        if (this.object === undefined || this.dragging === true) return;
        if (pointer === null) {
            return;
        }
        const raycaster = this.getRaycaster();
        const ndc = new THREE.Vector2(
            pointer.x,
            pointer.y
        );
        if (!this.updateRayCast(ndc, raycaster)) {
            return;
        }
        const gizmo = (this as any)._gizmo;
        const intersect = this.intersectObjectWithRay(gizmo.picker[this.mode], this.getRaycaster());
        if (intersect) {
            this.axis = intersect.object.name;
            if (this.onHover) {
                this.onHover({
                    object3D: this.object,
                    ndc_x: pointer.x,
                    ndc_y: pointer.y,
                });
            }
            this.map.triggerRepaint();
        } else {
            if (this.onNotHover) {
                this.onNotHover();
            }
            this.enableEventMap();
            this.axis = null;
        }
    }

    pointerDown(pointer: any): void {
        if (this.object === undefined || this.dragging === true || (pointer != null && pointer.button !== 0)) return;
        let raycaster = null;
        if (this.axis !== null) {
            if (pointer !== null) {
                const raycaster = this.getRaycaster();
                const ndc = new THREE.Vector2(
                    pointer.x,
                    pointer.y
                );
                if (!this.updateRayCast(ndc, raycaster)) {
                    return;
                }
                const plane = (this as any)._plane;
                const planeIntersect = this.intersectObjectWithRay(plane, this.getRaycaster(), true);
                if (planeIntersect) {
                    this.object.updateMatrixWorld();
                    this.object.parent?.updateMatrixWorld();
                    (this as any)._positionStart.copy(this.object.position);
                    (this as any)._quaternionStart.copy(this.object.quaternion);
                    (this as any)._scaleStart.copy(this.object.scale);
                    this.object.matrixWorld.decompose(
                        (this as any).worldPositionStart,
                        (this as any).worldQuaternionStart,
                        (this as any)._worldScaleStart
                    );
                    (this as any).pointStart.copy(planeIntersect.point).sub((this as any).worldPositionStart);
                }
            }
            this.dragging = true;
            this.dispatchEvent({type: 'mouseDown', mode: this.mode});
        }
    }

    private disableMap(): void {
        if (!this.map) return;
        this.map.dragPan.disable();
    }

    private enableEventMap(): void {
        if (!this.map) return;
        this.map.dragPan._enabled = true;
        this.map.dragPan.enable();
    }

    pointerMove(pointer: any): void {
        const axis = this.axis;
        const mode = this.mode;
        const object = this.object;
        let space = this.space;
        if (mode === 'scale') {
            space = 'local';
        } else if (axis === 'E' || axis === 'XYZE' || axis === 'XYZ') {
            space = 'world';
        }
        if (object === undefined || axis === null || this.dragging === false || (pointer !== null && pointer.button !== -1)) return;
        if (pointer !== null) {
            const raycaster = this.getRaycaster();
            const ndc = new THREE.Vector2(
                pointer.x,
                pointer.y
            );
            if (!this.updateRayCast(ndc, raycaster)) {
                return;
            }
            this.disableMap();
            const plane = (this as any)._plane;
            const planeIntersect = this.intersectObjectWithRay(plane, raycaster, true);
            if (!planeIntersect) return;
            (this as any).pointEnd.copy(planeIntersect.point).sub((this as any).worldPositionStart);
            if (mode === 'translate') {
                (this as any)._offset.copy((this as any).pointEnd).sub((this as any).pointStart);
                if (space === 'local' && axis !== 'XYZ') {
                    (this as any)._offset.applyQuaternion((this as any)._worldQuaternionInv);
                }
                if (axis.indexOf('X') === -1) (this as any)._offset.x = 0;
                if (axis.indexOf('Y') === -1) (this as any)._offset.y = 0;
                if (axis.indexOf('Z') === -1) (this as any)._offset.z = 0;
                if (space === 'local' && axis !== 'XYZ') {
                    (this as any)._offset.applyQuaternion((this as any)._quaternionStart).divide((this as any)._parentScale);
                } else {
                    (this as any)._offset.applyQuaternion((this as any)._parentQuaternionInv).divide((this as any)._parentScale);
                }
                (this as any).object.position.copy((this as any)._positionStart).add((this as any)._offset.clone().multiplyScalar(0.7));
                if (this.translationSnap) {
                    if (space === 'local') {
                        object.position.applyQuaternion((this as any)._tempQuaternion.copy((this as any)._quaternionStart).invert());
                        if (axis.search('X') !== -1) {
                            object.position.x = Math.round(object.position.x / this.translationSnap) * this.translationSnap;
                        }
                        if (axis.search('Y') !== -1) {
                            object.position.y = Math.round(object.position.y / this.translationSnap) * this.translationSnap;
                        }
                        if (axis.search('Z') !== -1) {
                            object.position.z = Math.round(object.position.z / this.translationSnap) * this.translationSnap;
                        }
                        object.position.applyQuaternion((this as any)._quaternionStart);
                    }
                }
                object.position.x = Math.max(this.min_X, Math.min(this.max_X, object.position.x));
                object.position.y = Math.max(this.min_Y, Math.min(this.max_Y, object.position.y));
                object.position.z = Math.max(this.min_Z, Math.min(this.max_Z, object.position.z));
            }
            if (mode === 'scale') {
                if (axis.search('XYZ') !== -1) {
                    let d = (this as any).pointEnd.length() / (this as any).pointStart.length();
                    if ((this as any).pointEnd.dot((this as any).pointStart) < 0) d *= -1;
                    this.tempVector2.set(d, d, d);
                } else {
                    this.tempVector.copy((this as any).pointStart);
                    this.tempVector2.copy((this as any).pointEnd);
                    this.tempVector.applyQuaternion((this as any)._worldQuaternionInv);
                    this.tempVector2.applyQuaternion((this as any)._worldQuaternionInv);
                    this.tempVector2.divide(this.tempVector);
                    if (axis.search('X') === -1) {
                        this.tempVector2.x = 1;
                    }
                    if (axis.search('Y') === -1) {
                        this.tempVector2.y = 1;
                    }
                    if (axis.search('Z') === -1) {
                        this.tempVector2.z = 1;
                    }
                }
                object.scale.copy((this as any)._scaleStart).multiply(this.tempVector2);
                if (this.scaleSnap) {
                    if (axis.search('X') !== -1) {
                        object.scale.x = Math.round(object.scale.x / this.scaleSnap) * this.scaleSnap || this.scaleSnap;
                    }
                    if (axis.search('Y') !== -1) {
                        object.scale.y = Math.round(object.scale.y / this.scaleSnap) * this.scaleSnap || this.scaleSnap;
                    }
                    if (axis.search('Z') !== -1) {
                        object.scale.z = Math.round(object.scale.z / this.scaleSnap) * this.scaleSnap || this.scaleSnap;
                    }
                }
            }
            if (mode === 'rotate') {
                (this as any)._offset.copy((this as any).pointEnd).sub((this as any).pointStart);
                const ROTATION_SPEED = 20 / (this as any).worldPosition.distanceTo(this.tempVector.setFromMatrixPosition(this.camera.matrixWorld));
                let _inPlaneRotation = false;
                if (axis === 'X' || axis === 'Y' || axis === 'Z') {
                    (this as any).rotationAxis.copy(this.unit[axis]);
                    this.tempVector.copy(this.unit[axis]);
                    if (space === 'local') {
                        this.tempVector.applyQuaternion((this as any).worldQuaternion);
                    }
                    this.tempVector.cross((this as any).eye);
                    if (this.tempVector.length() === 0) {
                        _inPlaneRotation = true;
                    } else {
                        (this as any).rotationAngle = (this as any)._offset.dot(this.tempVector.normalize()) * ROTATION_SPEED;
                    }
                }
                if (this.rotationSnap) (this as any).rotationAngle = Math.round((this as any).rotationAngle / this.rotationSnap) * this.rotationSnap;
                if (space === 'local' && axis !== 'E' && axis !== 'XYZE') {
                    object.quaternion.copy((this as any)._quaternionStart);
                    object.quaternion.multiply(this.tempQuaternion.setFromAxisAngle((this as any).rotationAxis, (this as any).rotationAngle)).normalize();
                    object.updateMatrixWorld();
                } else {
                    (this as any).rotationAxis.applyQuaternion((this as any)._parentQuaternionInv);
                    object.quaternion.copy(this.tempQuaternion.setFromAxisAngle((this as any).rotationAxis, (this as any).rotationAngle));
                    object.quaternion.multiply((this as any)._quaternionStart).normalize();
                }
            }
        }
        this.map.triggerRepaint();
        object.updateMatrixWorld();
        object.updateMatrix();
        this.dispatchEvent({type: 'change'});
        this.dispatchEvent({type: 'objectChange'});
        /*  if(this.onHover)
          {
              this.onHover({
                  object3D : object,
                  ndc_x : pointer.x,
                  ndc_y : pointer.y,
              });
          }*/
    }


    private intersectObjectWithRay(object: THREE.Object3D, raycaster: THREE.Raycaster, includeInvisible?: boolean): any {
        const allIntersections = raycaster.intersectObject(object, true);
        for (let i = 0; i < allIntersections.length; i++) {
            if (allIntersections[i].object.visible || includeInvisible) {
                return allIntersections[i];
            }
        }
        return false;
    }

    protected getPointer(event: PointerEvent) {
        if (this.domElement === null) {
            return;
        }
        ;
        if (this.domElement.ownerDocument.pointerLockElement) {
            return {
                x: 0,
                y: 0,
                button: event.button,
                clientX: 0,
                clientY: 0
            };
        } else {
            const rect = this.domElement.getBoundingClientRect();
            return {
                x: (event.clientX - rect.left) / rect.width * 2 - 1,
                y: -(event.clientY - rect.top) / rect.height * 2 + 1,
                button: event.button,
                clientX: event.clientX,
                clientY: event.clientY
            };
        }
    }
}

export default MaplibreTransformControls