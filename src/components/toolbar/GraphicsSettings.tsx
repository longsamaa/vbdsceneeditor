import {useState} from 'react';
import {Settings, Map, Layers, Mountain, Bookmark} from 'lucide-react';
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

export interface BookmarkItem {
    name: string;
    center: [number, number];
    zoom: number;
    pitch: number;
}

const BOOKMARKS: BookmarkItem[] = [
    {name: 'Tp. Ho Chi Minh', center: [106.70624452109166, 10.775262597735237], zoom: 17, pitch: 60},
    {name: 'Vung Tau', center: [107.08311546024306, 10.326704491011832], zoom: 17, pitch: 60},
];

interface Props {
    onChange?: (config: GraphicsConfig) => void;
    onToggleBoundaries?: (visible: boolean) => void;
    onToggleStyleLayers?: (visible: boolean) => void;
    onToggleTerrain?: (visible: boolean) => void;
    onJumpTo?: (bookmark: BookmarkItem) => void;
}

export const GraphicsSettings = ({onChange, onToggleBoundaries, onToggleStyleLayers, onToggleTerrain, onJumpTo}: Props) => {
    const [open, setOpen] = useState(false);
    const [bookmarkOpen, setBookmarkOpen] = useState(false);
    const [quality, setQuality] = useState<GraphicsQuality>('high');
    const [boundariesVisible, setBoundariesVisible] = useState(false);
    const [styleLayersVisible, setStyleLayersVisible] = useState(true);
    const [terrainVisible, setTerrainVisible] = useState(true);

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

    const handleToggleStyleLayers = () => {
        const next = !styleLayersVisible;
        setStyleLayersVisible(next);
        onToggleStyleLayers?.(next);
    };

    const handleToggleTerrain = () => {
        const next = !terrainVisible;
        setTerrainVisible(next);
        onToggleTerrain?.(next);
    };

    return (
        <div className="gs-container">
            <div className="gs-btn-row">
                <button className="gs-btn" onClick={() => { setOpen(!open); setBookmarkOpen(false); }} title="Graphics Settings">
                    <Settings size={18} strokeWidth={2}/>
                </button>
                <button
                    className={`gs-btn ${boundariesVisible ? '' : 'gs-btn-off'}`}
                    onClick={handleToggleBoundaries}
                    title="Toggle Boundaries"
                >
                    <Map size={18} strokeWidth={2}/>
                </button>
                <button
                    className={`gs-btn ${styleLayersVisible ? '' : 'gs-btn-off'}`}
                    onClick={handleToggleStyleLayers}
                    title="Toggle Style Layers"
                >
                    <Layers size={18} strokeWidth={2}/>
                </button>
                <button
                    className={`gs-btn ${terrainVisible ? '' : 'gs-btn-off'}`}
                    onClick={handleToggleTerrain}
                    title="Toggle Terrain"
                >
                    <Mountain size={18} strokeWidth={2}/>
                </button>
                <button
                    className="gs-btn"
                    onClick={() => { setBookmarkOpen(!bookmarkOpen); setOpen(false); }}
                    title="Bookmarks"
                >
                    <Bookmark size={18} strokeWidth={2}/>
                </button>
            </div>
            {bookmarkOpen && (
                <div className="gs-dropdown">
                    <div className="gs-title">Bookmarks</div>
                    {BOOKMARKS.map((bm) => (
                        <button
                            key={bm.name}
                            className="gs-option"
                            onClick={() => { onJumpTo?.(bm); setBookmarkOpen(false); }}
                        >
                            <span className="gs-option-label">{bm.name}</span>
                            <span className="gs-option-desc">zoom {bm.zoom}, pitch {bm.pitch}</span>
                        </button>
                    ))}
                </div>
            )}
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
