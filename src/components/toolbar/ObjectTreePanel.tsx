import {useState} from 'react';
import {ChevronDown, Box, X, Download, DatabaseBackup, RefreshCw} from 'lucide-react';
import './ObjectTreePanel.css';

export interface TileNode {
    tileKey: string;
    objects: Array<{ name: string; id: string }>;
}

interface Props {
    layerId: string;
    tiles: TileNode[];
    onClose: () => void;
    onSelectObject?: (tileKey: string, objectIndex: number) => void;
    onExportTile?: (tileKey: string) => void;
    onSaveTileToDb?: (tileKey: string) => void;
    onUpdateTileToDb?: (tileKey: string) => void;
}

export const ObjectTreePanel = ({layerId, tiles, onClose, onSelectObject, onExportTile, onSaveTileToDb, onUpdateTileToDb}: Props) => {
    const [collapsedTiles, setCollapsedTiles] = useState<Set<string>>(new Set());
    const [selectedObj, setSelectedObj] = useState<string | null>(null);

    const toggleTile = (tileKey: string) => {
        setCollapsedTiles(prev => {
            const next = new Set(prev);
            if (next.has(tileKey)) next.delete(tileKey);
            else next.add(tileKey);
            return next;
        });
    };

    const totalObjects = tiles.reduce((sum, t) => sum + t.objects.length, 0);

    return (
        <div className="otp-container">
            <div className="otp-panel">
                <div className="otp-header">
                    <span>Objects ({totalObjects})</span>
                    <button className="otp-close" onClick={onClose} aria-label="Close">
                        <X size={16} strokeWidth={2}/>
                    </button>
                </div>
                <div className="otp-tree">
                    {tiles.length === 0 && (
                        <div className="otp-empty">No objects in this layer</div>
                    )}
                    {tiles.map(tile => {
                        const isCollapsed = collapsedTiles.has(tile.tileKey);
                        return (
                            <div key={tile.tileKey} className="otp-tile">
                                <div
                                    className={`otp-tile-header ${isCollapsed ? 'collapsed' : ''}`}
                                    onClick={() => toggleTile(tile.tileKey)}
                                >
                                    <ChevronDown size={14} strokeWidth={2}/>
                                    <span>Tile {tile.tileKey}</span>
                                    {onExportTile && (
                                        <button
                                            className="otp-export-btn"
                                            title="Export 3D tile"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onExportTile(tile.tileKey);
                                            }}
                                        >
                                            <Download size={12} strokeWidth={2}/>
                                        </button>
                                    )}
                                    {onSaveTileToDb && (
                                        <button
                                            className="otp-export-btn"
                                            title="Save tile to DB"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onSaveTileToDb(tile.tileKey);
                                            }}
                                        >
                                            <DatabaseBackup size={12} strokeWidth={2}/>
                                        </button>
                                    )}
                                    {onUpdateTileToDb && (
                                        <button
                                            className="otp-export-btn"
                                            title="Update tile to DB"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onUpdateTileToDb(tile.tileKey);
                                            }}
                                        >
                                            <RefreshCw size={12} strokeWidth={2}/>
                                        </button>
                                    )}
                                    <span className="otp-tile-count">{tile.objects.length}</span>
                                </div>
                                {!isCollapsed && tile.objects.map((obj, idx) => {
                                    const objKey = `${tile.tileKey}/${obj.name}/${idx}`;
                                    return (
                                        <div
                                            key={objKey}
                                            className={`otp-object ${selectedObj === objKey ? 'selected' : ''}`}
                                            onClick={() => {
                                                setSelectedObj(objKey);
                                                onSelectObject?.(tile.tileKey, idx);
                                            }}
                                            title={obj.name}
                                        >
                                            <Box size={12} strokeWidth={2} className="otp-object-icon"/>
                                            <span className="otp-object-name">{obj.name}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
