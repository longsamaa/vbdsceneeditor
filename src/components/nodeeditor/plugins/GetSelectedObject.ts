import { NodeEditor, ClassicPreset } from 'rete';


class GetSelectedObject extends  ClassicPreset.Node {
    constructor(){

    }
    data(): Record<string, any> {
        const ctrl = this.controls['number'] as ClassicPreset.InputControl<'number'>;
        return { value: ctrl?.value ?? 0 };
    }
}