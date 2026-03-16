import { useState } from 'react';
import type { LabeledControl } from './LabeledControl';

export function LabeledControlComponent({ data }: { data: LabeledControl }) {
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
                type="number"
                step={data.step}
                value={val}
                onChange={e => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) {
                        setVal(v);
                        data.setValue(v);
                    }
                }}
                style={{
                    width: 70,
                    padding: '2px 4px',
                    border: '1px solid #555',
                    borderRadius: 3,
                    background: '#1e1e1e',
                    color: '#fff',
                    fontSize: 11,
                }}
            />
        </div>
    );
}
