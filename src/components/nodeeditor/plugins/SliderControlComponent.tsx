import { useState } from 'react';
import type { SliderControl } from './SliderControl';

export function SliderControlComponent({ data }: { data: SliderControl }) {
    const [val, setVal] = useState(data.value);

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px',
            }}
            onPointerDown={e => e.stopPropagation()}
        >
            <label style={{ color: '#fff', fontSize: 11, minWidth: 40 }}>{data.label}</label>
            <input
                type="range"
                min={data.min}
                max={data.max}
                step={data.step}
                value={val}
                onChange={e => {
                    const v = parseFloat(e.target.value);
                    setVal(v);
                    data.setValue(v);
                }}
                style={{ width: 60 }}
            />
            <span style={{ color: '#fff', fontSize: 10, minWidth: 30 }}>{val.toFixed(2)}</span>
        </div>
    );
}
