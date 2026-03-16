import {ClassicPreset } from 'rete';
import {object3DSocketType} from './SocketType'
import * as THREE from 'three';
import type { EditorInstance } from '../EditorInstance';
export class GetSelectedObjectNode extends ClassicPreset.Node {
    static labelName : string = 'Get Selected Object';
    editorInstance: EditorInstance;
    constructor(editorInstance: EditorInstance){
        super(GetSelectedObjectNode.labelName);
        this.editorInstance = editorInstance;
        this.addOutput(object3DSocketType.label, new ClassicPreset.Output(object3DSocketType.socket, object3DSocketType.label));
    }
    getSelectedObject(): THREE.Object3D | null {
        const map = this.editorInstance.getMap();
        console.log((map as any)?._selectedObject); 
        return (map as any)?._selectedObject ?? null;
    }

    setSelectedObject(obj: THREE.Object3D | null) {
        const map = this.editorInstance.getMap();
        if (map) (map as any)._selectedObject = obj;
    }

    data(): Record<string, THREE.Object3D | null> {
        return { [object3DSocketType.label]: this.getSelectedObject() };
    }
}