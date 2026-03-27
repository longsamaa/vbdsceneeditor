import { useState } from 'react';
import './TexturePanel.css';

export type TextureSlot = 'wall' | 'top';

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
    { name: 'Roof Tiles', thumbnail: '/textures/roof_tiles.jpg' },
    { name: 'Metal', thumbnail: '/textures/roof_metal.jpg' },
];

interface TexturePanelProps {
    onSelectTexture: (slot: TextureSlot, textureName: string | null, textureUrl: string | null) => void;
}

export function TexturePanel({ onSelectTexture }: TexturePanelProps) {
    const [selectedWall, setSelectedWall] = useState<string | null>(null);
    const [selectedTop, setSelectedTop] = useState<string | null>(null);

    const handleSelect = (slot: TextureSlot, option: TextureOption) => {
        const setter = slot === 'wall' ? setSelectedWall : setSelectedTop;
        const current = slot === 'wall' ? selectedWall : selectedTop;

        if (current === option.name) {
            setter(null);
            onSelectTexture(slot, null, null);
            return;
        }

        setter(option.name);
        onSelectTexture(slot, option.name, option.thumbnail);
    };

    return (
        <div className="tex-panel">
            <div className="tex-section">
                <div className="tex-section-title">Wall Texture</div>
                <div className="tex-grid">
                    {WALL_TEXTURES.map((opt) => (
                        <div
                            key={opt.name}
                            className={`tex-item ${selectedWall === opt.name ? 'selected' : ''}`}
                            onClick={() => handleSelect('wall', opt)}
                        >
                            <div
                                className="tex-thumb"
                                style={{ backgroundImage: `url(${opt.thumbnail})` }}
                            />
                            <div className="tex-name">{opt.name}</div>
                        </div>
                    ))}
                </div>
            </div>
            <div className="tex-section">
                <div className="tex-section-title">Top Texture</div>
                <div className="tex-grid">
                    {TOP_TEXTURES.map((opt) => (
                        <div
                            key={opt.name}
                            className={`tex-item ${selectedTop === opt.name ? 'selected' : ''}`}
                            onClick={() => handleSelect('top', opt)}
                        >
                            <div
                                className="tex-thumb"
                                style={{ backgroundImage: `url(${opt.thumbnail})` }}
                            />
                            <div className="tex-name">{opt.name}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
