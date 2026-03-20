import { ClassicPreset } from 'rete';
import {object3DSocketType} from './SocketType'
import * as THREE from 'three';
import type { EditorInstance } from '../EditorInstance';
import { LabeledControl } from './LabeledControl';
import { SliderControl } from './SliderControl';
import { ShadowLitMaterial } from '../../map/shadow/ShadowLitMaterial';

export class TransformNode extends ClassicPreset.Node{
    static labelName : string = 'Transform';
    editorInstance: EditorInstance;
    scaleCtrl = new LabeledControl('Scale', 1, 0.1);
    rotateZCtrl = new LabeledControl('Rotate Z', 0, 1);
    opacityCtrl = new SliderControl('Opacity', 1, 0, 1, 0.01);

    constructor(editorInstance: EditorInstance){
        super(TransformNode.labelName);
        this.editorInstance = editorInstance;
        this.addInput(object3DSocketType.label, new ClassicPreset.Input(object3DSocketType.socket, object3DSocketType.label));
        this.addControl('scale', this.scaleCtrl);
        this.addControl('rotateZ', this.rotateZCtrl);
        this.addControl('opacity', this.opacityCtrl);
    }
    data(inputs :  Record<string, any>) :  Record<string, THREE.Object3D | null> {
        const obj = inputs[object3DSocketType.label]?.[0] as THREE.Object3D | undefined;
        if (obj) {
            const scale = this.scaleCtrl.value ?? 1;
            const scaleUnit = obj.userData.scaleUnit ?? 1;
            const s = scale * scaleUnit;
            obj.scale.set(s, -scale, s);

            const deg = this.rotateZCtrl.value ?? 0;
            obj.rotation.y = THREE.MathUtils.degToRad(deg);

            const opacity = this.opacityCtrl.value ?? 1;
            obj.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) {
                    const mat = (child as THREE.Mesh).material;
                    if (mat instanceof ShadowLitMaterial) {
                        mat.setOpacity(opacity);
                    }
                }
            });

            obj.updateMatrix();
            obj.updateMatrixWorld(true);
        }
        return { value: obj ?? null };
    }
}