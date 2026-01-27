import './TransformToolbar.css';
import { Move3D, Rotate3D, Scale3D } from 'lucide-react';
export type TransformMode = 'translate' | 'rotate' | 'scale' | 'reset';
interface Props {
    mode: TransformMode;
    onChange: (m: TransformMode) => void;
}
const ICON_SIZE = 18;
export const TransformToolbar = ({ mode, onChange }: Props) => {
    return (
        <div className="tc-toolbar">
            <button
                className={`tc-btn ${mode === 'translate' ? 'active' : ''}`}
                data-tooltip="Move Object"
                onClick={() => onChange('translate')}
            >
                <Move3D size={ICON_SIZE} />
            </button>

            <button
                className={`tc-btn ${mode === 'rotate' ? 'active' : ''}`}
                data-tooltip="Rotate Object"
                onClick={() => onChange('rotate')}
            >
                <Rotate3D size={ICON_SIZE} />
            </button>

            <button
                className={`tc-btn ${mode === 'scale' ? 'active' : ''}`}
                data-tooltip="Scale Object"
                onClick={() => onChange('scale')}
            >
                <Scale3D size={ICON_SIZE} />
            </button>
        </div>
    );
};
