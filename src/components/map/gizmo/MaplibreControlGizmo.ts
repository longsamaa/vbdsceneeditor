import {TransformControlsGizmo} from 'three/examples/jsm/controls/TransformControls.js';

export class MaplibreControlGizmo extends TransformControlsGizmo {
    constructor() {
        super();
        // Override method trực tiếp
        const originalUpdate = this.updateMatrixWorld.bind(this);
        this.updateMatrixWorld = (force: boolean): void => {
            console.log("maplibre control gizmo updateMatrixWorld called!");
            originalUpdate(force);
        };
    }

    updateMatrixWorld(force: boolean) {
        super.updateMatrixWorld(force);
        console.log("maplibre control gizmo update");
    }
}