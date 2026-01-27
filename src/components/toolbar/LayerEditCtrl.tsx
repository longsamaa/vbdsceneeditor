import {useEffect, useState} from 'react';
import './LayerEditCtrl.css';
import {Layers, X, Eye, EyeOff, Trash2} from 'lucide-react';

export interface EditableLayer {
    id: string;
    name: string;
    isVisible: boolean;
}

interface Props {
    layers: EditableLayer[];
    activeLayerId?: string;
    onSelect: (id: string) => void;
    onVisibleLayer: (id: string, visible: boolean) => void;
    onDeleteLayer : (id : string) => void;
    onAdd: () => void;
}

export const LayerEditControl = ({
                                     layers,
                                     onSelect,
                                     onAdd,
                                     onVisibleLayer,
                                     onDeleteLayer,
                                 }: Props) => {
    const [open, setOpen] = useState(false);
    const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
    const [visibleMap, setVisibleMap] = useState<Record<string, boolean>>({});
    useEffect(() => {
        const next: Record<string, boolean> = {};
        for (const layer of layers) {
            next[layer.id] = layer.isVisible;
        }
        setVisibleMap(next);
    }, [layers]);
    const toggleVisible = (id: string) => {
        setVisibleMap(prev => {
            const visible = !prev[id];
            const next = {
                ...prev,
                [id]: visible,
            };
            onVisibleLayer(id, visible);
            return next;
        });
    };
    return (
        <div className="lec-container">
            {!open && (
                <button
                    className="lec-toggle-btn"
                    onClick={() => setOpen(true)}
                >
                    <Layers size={16} strokeWidth={2}/>
                </button>
            )}
            {open && (
                <div className="lec-panel">
                    <div className="lec-header">
                        <span>Edit Layers</span>
                        <button
                            className="lec-close"
                            onClick={() => setOpen(false)}
                            aria-label="Close"
                        >
                            <X size={16} strokeWidth={2}/>
                        </button>
                    </div>
                    <div className="lec-list">
                        {layers.map(layer => (
                            <div
                                key={layer.id}
                                className={`lec-item ${layer.id === activeLayerId ? 'active' : ''}`}
                                onClick={() => {
                                    setActiveLayerId(layer.id);
                                    onSelect(layer.id);
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={layer.id === activeLayerId}
                                    readOnly
                                />
                                {/* icon layer */}
                                <span className="lec-name">{layer.name}</span>
                                <button
                                    className="lec-eye-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleVisible(layer.id);
                                    }}
                                >
                                    {visibleMap[layer.id] ? (
                                        <Eye size={16} className="lec-action-icon"/>
                                    ) : (
                                        <EyeOff size={16} className="lec-action-icon"/>
                                    )}
                                </button>
                                <button className="lec-delete-btn"
                                        title="Delete layer"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (confirm('Delete this layer?')) {
                                                onDeleteLayer(layer.id);
                                            }
                                        }}
                                >
                                    <Trash2 size={14} strokeWidth={2} />
                                </button>
                            </div>
                        ))}
                    </div>
                    <button
                        className="lec-add-btn"
                        onClick={onAdd}
                    >
                        + Add new layer for edit
                    </button>
                </div>
            )}
        </div>
    );
};
