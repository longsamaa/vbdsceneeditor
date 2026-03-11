import {useState} from 'react';
import {Settings, Map} from 'lucide-react';
import './GraphicsSettings.css';

export type GraphicsQuality = 'low' | 'high';

export interface GraphicsConfig {
    quality: GraphicsQuality;
    shadowMapSize: number;
    pixelRatio: number;
}

const PRESETS: Record<GraphicsQuality, GraphicsConfig> = {
    low: {quality: 'low', shadowMapSize: 2048, pixelRatio: 1},
    high: {quality: 'high', shadowMapSize: 8192, pixelRatio: window.devicePixelRatio},
};

interface Props {
    onChange?: (config: GraphicsConfig) => void;
    onToggleBoundaries?: (visible: boolean) => void;
}

export const GraphicsSettings = ({onChange, onToggleBoundaries}: Props) => {
    const [open, setOpen] = useState(false);
    const [quality, setQuality] = useState<GraphicsQuality>('high');
    const [boundariesVisible, setBoundariesVisible] = useState(false);

    const handleChange = (q: GraphicsQuality) => {
        setQuality(q);
        onChange?.(PRESETS[q]);
        setOpen(false);
    };

    const handleToggleBoundaries = () => {
        const next = !boundariesVisible;
        setBoundariesVisible(next);
        onToggleBoundaries?.(next);
    };

    return (
        <div className="gs-container">
            <div className="gs-btn-row">
                <button className="gs-btn" onClick={() => setOpen(!open)} title="Graphics Settings">
                    <Settings size={18} strokeWidth={2}/>
                </button>
                <button
                    className={`gs-btn ${boundariesVisible ? '' : 'gs-btn-off'}`}
                    onClick={handleToggleBoundaries}
                    title="Toggle Boundaries"
                >
                    <Map size={18} strokeWidth={2}/>
                </button>
            </div>
            {open && (
                <div className="gs-dropdown">
                    <div className="gs-title">Graphics Quality</div>
                    <button
                        className={`gs-option ${quality === 'low' ? 'active' : ''}`}
                        onClick={() => handleChange('low')}
                    >
                        <span className="gs-option-label">Low</span>
                        <span className="gs-option-desc">Shadow 2K, 1x pixel ratio</span>
                    </button>
                    <button
                        className={`gs-option ${quality === 'high' ? 'active' : ''}`}
                        onClick={() => handleChange('high')}
                    >
                        <span className="gs-option-label">High</span>
                        <span className="gs-option-desc">Shadow 8K, native pixel ratio</span>
                    </button>
                </div>
            )}
        </div>
    );
};
