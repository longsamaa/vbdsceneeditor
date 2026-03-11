import {useEffect, useRef, useState} from 'react';
import './LayerEditCtrl.css';
import {Layers, X, Eye, EyeOff, Trash2, Plus, Link, HardDrive} from 'lucide-react';

export interface EditableLayer {
    id: string;
    name: string;
    isVisible: boolean;
    canAddObject?: boolean;
}

interface Props {
    layers: EditableLayer[];
    activeLayerId?: string;
    onSelect: (id: string) => void;
    onVisibleLayer: (id: string, visible: boolean) => void;
    onDeleteLayer : (id : string) => void;
    onAdd: () => void;
    onAddObject?: (layerId: string, file: File) => void;
    onAddObjectFromUrl?: (layerId: string, url: string) => void;
}

export const LayerEditControl = ({
                                     layers,
                                     onSelect,
                                     onAdd,
                                     onVisibleLayer,
                                     onDeleteLayer,
                                     onAddObject,
                                     onAddObjectFromUrl,
                                 }: Props) => {
    const [open, setOpen] = useState(false);
    const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
    const [visibleMap, setVisibleMap] = useState<Record<string, boolean>>({});
    const [addMode, setAddMode] = useState<'local' | 'url'>('local');
    const [urlInput, setUrlInput] = useState('http://10.222.3.84:9000/indoornavigation/Crane3d.glb');
    const fileInputRef = useRef<HTMLInputElement>(null);
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
                    {activeLayerId && layers.find(l => l.id === activeLayerId)?.canAddObject && (
                        <div className="lec-add-section">
                            <div className="lec-mode-toggle">
                                <label className={`lec-mode-label ${addMode === 'local' ? 'active' : ''}`}>
                                    <input type="radio" name="addMode" checked={addMode === 'local'} onChange={() => setAddMode('local')} />
                                    <HardDrive size={12}/> Local
                                </label>
                                <label className={`lec-mode-label ${addMode === 'url' ? 'active' : ''}`}>
                                    <input type="radio" name="addMode" checked={addMode === 'url'} onChange={() => setAddMode('url')} />
                                    <Link size={12}/> URL
                                </label>
                            </div>
                            {addMode === 'local' ? (
                                <>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".glb,.gltf"
                                        style={{display: 'none'}}
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file && activeLayerId && onAddObject) {
                                                onAddObject(activeLayerId, file);
                                            }
                                            e.target.value = '';
                                        }}
                                    />
                                    <button
                                        className="lec-add-object-btn"
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <Plus size={14} strokeWidth={2}/> Add from file
                                    </button>
                                </>
                            ) : (
                                <div className="lec-url-input">
                                    <input
                                        type="text"
                                        className="lec-url-field"
                                        placeholder="https://...model.glb"
                                        value={urlInput}
                                        onChange={(e) => setUrlInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && urlInput.trim() && activeLayerId) {
                                                onAddObjectFromUrl?.(activeLayerId, urlInput.trim());
                                                setUrlInput('');
                                            }
                                        }}
                                    />
                                    <button
                                        className="lec-add-object-btn"
                                        onClick={() => {
                                            if (urlInput.trim() && activeLayerId) {
                                                onAddObjectFromUrl?.(activeLayerId, urlInput.trim());
                                                setUrlInput('');
                                            }
                                        }}
                                    >
                                        <Plus size={14} strokeWidth={2}/> Add from URL
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
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
