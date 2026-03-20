import React, { useState } from 'react';
import { X } from 'lucide-react';
import './ObjectPalette.css';

export type PrimitiveType = 'box' | 'cylinder' | 'gable-roof';
export type TextureSlot = 'wall' | 'top';

interface PaletteItem {
    type: PrimitiveType;
    label: string;
    icon: React.ReactNode;
}

interface PaletteCategory {
    name: string;
    items: PaletteItem[];
}

interface TextureOption {
    name: string;
    thumbnail: string;
}

const WALL_TEXTURES: TextureOption[] = [
    { name: 'Brick', thumbnail: '/textures/wall_brick.jpg' },
    { name: 'Building', thumbnail: '/textures/wall_building.jpg' },
    { name: 'Plaster', thumbnail: '/textures/wall_plaster.jpg' },
];

const TOP_TEXTURES: TextureOption[] = [
    { name: 'Top View', thumbnail: '/textures/top_view.jpg' },
    { name: 'Tile Grey', thumbnail: '/textures/roof_tile_grey.jpg' },
    { name: 'Metal', thumbnail: '/textures/roof_metal.jpg' },
];

const BoxIcon = () => (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="24,10 40,18 24,26 8,18" fill="#9aa0aa" stroke="#6b7280" strokeWidth="1" />
        <polygon points="8,18 24,26 24,40 8,32" fill="#7a8090" stroke="#6b7280" strokeWidth="1" />
        <polygon points="40,18 24,26 24,40 40,32" fill="#b0b6c0" stroke="#6b7280" strokeWidth="1" />
    </svg>
);

const CylinderIcon = () => (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12,16 L12,34 Q12,40 24,40 Q36,40 36,34 L36,16" fill="#9aa0aa" stroke="#6b7280" strokeWidth="1" />
        <ellipse cx="24" cy="34" rx="12" ry="5" fill="#7a8090" stroke="#6b7280" strokeWidth="0.5" />
        <ellipse cx="24" cy="16" rx="12" ry="5" fill="#b0b6c0" stroke="#6b7280" strokeWidth="1" />
    </svg>
);

const GableRoofIcon = () => (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="6,26 24,10 42,26 24,20" fill="#8a9098" stroke="#6b7280" strokeWidth="1" />
        <polygon points="24,10 42,26 38,28 24,14" fill="#a0a8b0" stroke="#6b7280" strokeWidth="0.5" />
        <polygon points="6,26 24,20 24,38 6,38" fill="#7a8090" stroke="#6b7280" strokeWidth="1" />
        <polygon points="42,26 24,20 24,38 42,38" fill="#b0b6c0" stroke="#6b7280" strokeWidth="1" />
        <polygon points="6,26 6,38 24,38 24,20" fill="#7a8090" stroke="#6b7280" strokeWidth="0.5" opacity="0.5" />
    </svg>
);

const categories: PaletteCategory[] = [
    {
        name: 'Volumes',
        items: [
            { type: 'box', label: 'Box', icon: <BoxIcon /> },
            { type: 'cylinder', label: 'Cylinder', icon: <CylinderIcon /> },
        ],
    },
    {
        name: 'Roofs',
        items: [
            { type: 'gable-roof', label: 'Gable roof', icon: <GableRoofIcon /> },
        ],
    },
];

type TabType = 'add' | 'texture';

interface ObjectPaletteProps {
    onSelect: (type: PrimitiveType) => void;
    onClose: () => void;
    showTextureTab?: boolean;
    onSelectTexture?: (slot: TextureSlot, textureName: string | null, textureUrl: string | null) => void;
}

export function ObjectPalette({ onSelect, onClose, showTextureTab, onSelectTexture }: ObjectPaletteProps) {
    const [activeTab, setActiveTab] = useState<TabType>('add');
    const [selectedWall, setSelectedWall] = useState<string | null>(null);
    const [selectedTop, setSelectedTop] = useState<string | null>(null);

    const handleTextureSelect = (slot: TextureSlot, option: TextureOption) => {
        const setter = slot === 'wall' ? setSelectedWall : setSelectedTop;
        const current = slot === 'wall' ? selectedWall : selectedTop;

        if (current === option.name) {
            setter(null);
            onSelectTexture?.(slot, null, null);
            return;
        }
        setter(option.name);
        onSelectTexture?.(slot, option.name, option.thumbnail);
    };

    return (
        <div className="obj-palette">
            <div className="obj-palette-header">
                <div className="obj-palette-tabs">
                    <button
                        className={`obj-palette-tab ${activeTab === 'add' ? 'active' : ''}`}
                        onClick={() => setActiveTab('add')}
                    >
                        Add Object
                    </button>
                    {showTextureTab && (
                        <button
                            className={`obj-palette-tab ${activeTab === 'texture' ? 'active' : ''}`}
                            onClick={() => setActiveTab('texture')}
                        >
                            Texture
                        </button>
                    )}
                </div>
                <button className="obj-palette-close" onClick={onClose} aria-label="Close">
                    <X size={14} strokeWidth={2} />
                </button>
            </div>
            {activeTab === 'add' && (
                <>
                    {categories.map((cat) => (
                        <div key={cat.name}>
                            <div className="obj-palette-category">{cat.name}</div>
                            <div className="obj-palette-grid">
                                {cat.items.map((item) => (
                                    <div
                                        key={item.type}
                                        className="obj-palette-item"
                                        onClick={() => onSelect(item.type)}
                                        title={item.label}
                                    >
                                        <div className="obj-palette-icon">{item.icon}</div>
                                        <div className="obj-palette-label">{item.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </>
            )}
            {activeTab === 'texture' && showTextureTab && (
                <div className="obj-palette-texture">
                    <div className="obj-palette-category">Wall</div>
                    <div className="obj-palette-grid">
                        {WALL_TEXTURES.map((opt) => (
                            <div
                                key={opt.name}
                                className={`obj-palette-item ${selectedWall === opt.name ? 'selected' : ''}`}
                                onClick={() => handleTextureSelect('wall', opt)}
                            >
                                <div
                                    className="obj-palette-tex-thumb"
                                    style={{ backgroundImage: `url(${opt.thumbnail})` }}
                                />
                                <div className="obj-palette-label">{opt.name}</div>
                            </div>
                        ))}
                    </div>
                    <div className="obj-palette-category">Top</div>
                    <div className="obj-palette-grid">
                        {TOP_TEXTURES.map((opt) => (
                            <div
                                key={opt.name}
                                className={`obj-palette-item ${selectedTop === opt.name ? 'selected' : ''}`}
                                onClick={() => handleTextureSelect('top', opt)}
                            >
                                <div
                                    className="obj-palette-tex-thumb"
                                    style={{ backgroundImage: `url(${opt.thumbnail})` }}
                                />
                                <div className="obj-palette-label">{opt.name}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
