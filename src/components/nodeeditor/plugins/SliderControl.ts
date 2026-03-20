import { ClassicPreset } from 'rete';

export class SliderControl extends ClassicPreset.Control {
    value: number;
    label: string;
    min: number;
    max: number;
    step: number;

    constructor(label: string, initial: number = 0, min: number = 0, max: number = 1, step: number = 0.01) {
        super();
        this.label = label;
        this.value = initial;
        this.min = min;
        this.max = max;
        this.step = step;
    }

    setValue(v: number) {
        this.value = v;
    }
}
