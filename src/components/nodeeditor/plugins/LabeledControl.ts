import { ClassicPreset } from 'rete';

export class LabeledControl extends ClassicPreset.Control {
    value: number;
    label: string;
    step: number;

    constructor(label: string, initial: number = 0, step: number = 0.1) {
        super();
        this.label = label;
        this.value = initial;
        this.step = step;
    }

    setValue(v: number) {
        this.value = v;
    }
}
