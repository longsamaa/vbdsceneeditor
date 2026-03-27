import * as THREE from 'three';

export type ExtrudeGizmoCallbacks = {
    onDragStart?: (faceNormal: THREE.Vector3, faceCenter: THREE.Vector3) => void;
    onDrag?: (distance: number, faceNormal: THREE.Vector3, faceCenter: THREE.Vector3) => void;
    onDragEnd?: (distance: number, faceNormal: THREE.Vector3, faceCenter: THREE.Vector3) => void;
};

/**
 * Extrude gizmo: hiển thị vòng tròn + arrow trên 1 face.
 * Kéo arrow dọc theo normal → callback trả về distance.
 */
export class ExtrudeGizmo extends THREE.Group {
    private circle: THREE.Mesh;
    private arrow: THREE.Group;
    private arrowShaft: THREE.Mesh;
    private arrowHead: THREE.Mesh;
    private handle: THREE.Mesh; // invisible picker sphere

    private faceNormal = new THREE.Vector3();
    private faceCenter = new THREE.Vector3();

    private dragging = false;
    private dragStartPoint = new THREE.Vector3();
    private currentDistance = 0;

    private dragPlane = new THREE.Plane();
    private dragLine: THREE.Line; // visual line along normal during drag

    private _hovered = false;
    private defaultColor = 0xffcc00;
    private hoverColor = 0xffff00;
    private activeColor = 0xff8800;

    callbacks: ExtrudeGizmoCallbacks = {};

    constructor(callbacks?: ExtrudeGizmoCallbacks) {
        super();
        this.name = 'ExtrudeGizmo';
        this.callbacks = callbacks ?? {};

        // Circle ring
        const circleGeo = new THREE.RingGeometry(0.9, 1.0, 32);
        const circleMat = new THREE.MeshBasicMaterial({
            color: this.defaultColor,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.6,
            depthTest: false,
        });
        this.circle = new THREE.Mesh(circleGeo, circleMat);
        this.circle.name = 'extrude_circle';
        this.circle.renderOrder = 999;
        this.add(this.circle);

        // Arrow group
        this.arrow = new THREE.Group();
        this.arrow.name = 'extrude_arrow';

        // Arrow shaft (cylinder)
        const shaftGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8);
        shaftGeo.translate(0, 0.6, 0); // origin at base
        const shaftMat = new THREE.MeshBasicMaterial({
            color: this.defaultColor,
            depthTest: false,
        });
        this.arrowShaft = new THREE.Mesh(shaftGeo, shaftMat);
        this.arrowShaft.renderOrder = 999;
        this.arrow.add(this.arrowShaft);

        // Arrow head (cone)
        const headGeo = new THREE.ConeGeometry(0.12, 0.3, 8);
        headGeo.translate(0, 1.35, 0); // on top of shaft
        const headMat = new THREE.MeshBasicMaterial({
            color: this.defaultColor,
            depthTest: false,
        });
        this.arrowHead = new THREE.Mesh(headGeo, headMat);
        this.arrowHead.renderOrder = 999;
        this.arrow.add(this.arrowHead);

        // Arrow points along local +Y, will be rotated to face normal
        this.add(this.arrow);

        // Invisible handle for raycasting (larger hit area)
        const handleGeo = new THREE.SphereGeometry(0.25, 8, 8);
        handleGeo.translate(0, 1.35, 0);
        const handleMat = new THREE.MeshBasicMaterial({
            visible: false,
        });
        this.handle = new THREE.Mesh(handleGeo, handleMat);
        this.handle.name = 'extrude_handle';
        this.arrow.add(this.handle);

        // Drag line - dashed line dọc theo normal, hiện khi drag
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, -5, 0),
            new THREE.Vector3(0, 5, 0),
        ]);
        const lineMat = new THREE.LineDashedMaterial({
            color: this.activeColor,
            dashSize: 0.1,
            gapSize: 0.05,
            depthTest: false,
        });
        this.dragLine = new THREE.Line(lineGeo, lineMat);
        this.dragLine.computeLineDistances();
        this.dragLine.renderOrder = 998;
        this.dragLine.visible = false;
        this.dragLine.name = 'extrude_dragline';
        this.add(this.dragLine);

        this.frustumCulled = false;
        this.traverse(c => { c.frustumCulled = false; });
        this.visible = false;
    }

    /**
     * Đặt gizmo lên face: center + normal
     * size: scale gizmo theo kích thước object
     */
    show(center: THREE.Vector3, normal: THREE.Vector3, size: number = 1): void {
        this.faceCenter.copy(center);
        this.faceNormal.copy(normal).normalize();

        this.position.copy(center);

        // Rotate gizmo so local +Y aligns with face normal
        const up = new THREE.Vector3(0, 1, 0);
        const quat = new THREE.Quaternion().setFromUnitVectors(up, this.faceNormal);
        this.quaternion.copy(quat);

        this.scale.setScalar(size);
        this.updateMatrix();
        this.updateMatrixWorld(true);
        this.visible = true;
        this.currentDistance = 0;
    }

    hide(): void {
        this.visible = false;
        this.dragging = false;
        this.currentDistance = 0;
    }

    /** Check if mouse hovers the arrow handle. Returns true if hovered. */
    checkHover(raycaster: THREE.Raycaster): boolean {
        if (!this.visible) return false;
        const intersects = raycaster.intersectObject(this.handle, false);
        const hovered = intersects.length > 0;
        if (hovered !== this._hovered) {
            this._hovered = hovered;
            this.setColor(hovered ? this.hoverColor : this.defaultColor);
        }
        return hovered;
    }

    /** Call on pointerdown. Returns true if gizmo captured the event. */
    onPointerDown(raycaster: THREE.Raycaster): boolean {
        if (!this.visible || !this._hovered) return false;
        this.dragging = true;
        this.currentDistance = 0;

        // Create drag plane perpendicular to camera but containing the normal line
        // Use a plane that contains faceCenter and is perpendicular to a vector
        // orthogonal to both the normal and the ray direction
        const rayDir = raycaster.ray.direction.clone();
        const planeNormal = new THREE.Vector3().crossVectors(this.faceNormal, rayDir);
        planeNormal.crossVectors(planeNormal, this.faceNormal).normalize();
        if (planeNormal.lengthSq() < 0.001) {
            planeNormal.crossVectors(this.faceNormal, new THREE.Vector3(0, 1, 0));
            planeNormal.crossVectors(planeNormal, this.faceNormal).normalize();
        }
        this.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, this.faceCenter);

        // Find start point on drag plane
        raycaster.ray.intersectPlane(this.dragPlane, this.dragStartPoint);

        this.setColor(this.activeColor);
        this.dragLine.visible = true;
        this.callbacks.onDragStart?.(this.faceNormal.clone(), this.faceCenter.clone());
        return true;
    }

    /** Call on pointermove. Returns true if gizmo is handling drag. */
    onPointerMove(raycaster: THREE.Raycaster): boolean {
        if (!this.dragging) return false;

        const intersectPoint = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(this.dragPlane, intersectPoint)) return true;

        // Project movement onto face normal
        const delta = intersectPoint.sub(this.dragStartPoint);
        this.currentDistance = delta.dot(this.faceNormal);

        this.callbacks.onDrag?.(this.currentDistance, this.faceNormal.clone(), this.faceCenter.clone());
        return true;
    }

    /** Call on pointerup. Returns true if gizmo was dragging. */
    onPointerUp(): boolean {
        if (!this.dragging) return false;
        this.dragging = false;
        this.dragLine.visible = false;
        this.setColor(this._hovered ? this.hoverColor : this.defaultColor);
        this.callbacks.onDragEnd?.(this.currentDistance, this.faceNormal.clone(), this.faceCenter.clone());
        this.currentDistance = 0;
        return true;
    }

    isDragging(): boolean {
        return this.dragging;
    }

    isHovered(): boolean {
        return this._hovered;
    }

    private setColor(color: number): void {
        (this.circle as THREE.Mesh).material = new THREE.MeshBasicMaterial({
            color, side: THREE.DoubleSide, transparent: true, opacity: 0.6, depthTest: false,
        });
        (this.arrowShaft.material as THREE.MeshBasicMaterial).color.set(color);
        (this.arrowHead.material as THREE.MeshBasicMaterial).color.set(color);
    }

    dispose(): void {
        this.traverse(child => {
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
                if (child.material instanceof THREE.Material) child.material.dispose();
            }
        });
    }
}
