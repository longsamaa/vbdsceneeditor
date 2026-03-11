import {useState} from 'react';
import {X, RefreshCw, Save, CloudUpload, Trash2} from 'lucide-react';
import './PropertiesPanel.css';

export interface ObjectProperties {
    gid?: string | null;
    id?: string | null;
    longitude?: number | null;
    latitude?: number | null;
    name?: string | null;
    scale?: number | null;
    bearing?: number | null;
    elevation?: number | null;
    startdate?: string | null;
    enddate?: string | null;
    modeltype?: string | null;
    modelname?: string | null;
    modelurl?: string | null;
    texturename?: string | null;
    textureurl?: string | null;
    coordinates?: string | null;
    height?: number | null;
    tileKey?: string | null;
}

interface Props {
    properties: ObjectProperties;
    editable?: boolean;
    showDbActions?: boolean;
    onClose: () => void;
    onUpdate?: (props: ObjectProperties) => void;
    onSave?: (props: ObjectProperties) => void;
    onUpdateToDb?: (props: ObjectProperties) => void;
    onDeleteFromDb?: (props: ObjectProperties) => void;
}

const FIELD_CONFIG: Array<{ key: keyof ObjectProperties; label: string; editableField?: boolean; type?: 'number' | 'text' }> = [
    {key: 'gid', label: 'GID'},
    {key: 'id', label: 'ID'},
    {key: 'longitude', label: 'Longitude', editableField: true, type: 'number'},
    {key: 'latitude', label: 'Latitude', editableField: true, type: 'number'},
    {key: 'name', label: 'Name', editableField: true, type: 'text'},
    {key: 'scale', label: 'Scale', editableField: true, type: 'number'},
    {key: 'bearing', label: 'Bearing', editableField: true, type: 'number'},
    {key: 'elevation', label: 'Elevation', editableField: true, type: 'number'},
    {key: 'startdate', label: 'Start Date'},
    {key: 'enddate', label: 'End Date'},
    {key: 'modeltype', label: 'Model Type'},
    {key: 'modelname', label: 'Model Name'},
    {key: 'modelurl', label: 'Model URL'},
    {key: 'texturename', label: 'Texture Name'},
    {key: 'textureurl', label: 'Texture URL'},
    {key: 'coordinates', label: 'Coordinates'},
    {key: 'height', label: 'Height', editableField: true, type: 'number'},
    {key: 'tileKey', label: 'Tile Key'},
];

export const PropertiesPanel = ({properties, editable, showDbActions, onClose, onUpdate, onSave, onUpdateToDb, onDeleteFromDb}: Props) => {
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [localProps, setLocalProps] = useState<ObjectProperties>({...properties});

    // Sync when properties change from outside (e.g. gizmo transform)
    const [prevProps, setPrevProps] = useState(properties);
    if (properties !== prevProps) {
        setPrevProps(properties);
        setLocalProps({...properties});
    }

    const canEdit = (field: { editableField?: boolean }) => editable && field.editableField;

    const startEdit = (key: string, value: string) => {
        setEditingKey(key);
        setEditValue(value);
    };

    const commitEdit = (key: keyof ObjectProperties, type?: 'number' | 'text') => {
        const val = type === 'number' ? parseFloat(editValue) : editValue;
        const finalVal = (type === 'number' && isNaN(val as number)) ? editValue : val;
        setLocalProps(prev => ({...prev, [key]: finalVal}));
        setEditingKey(null);
    };

    const formatValue = (val: unknown): string => {
        if (val === null || val === undefined) return 'null';
        if (typeof val === 'number') {
            return Number.isInteger(val) ? val.toString() : val.toFixed(6);
        }
        return String(val);
    };

    return (
        <div className="prop-container">
            <div className="prop-panel">
                <div className="prop-header">
                    <span>Properties</span>
                    <button className="prop-close" onClick={onClose} aria-label="Close">
                        <X size={16} strokeWidth={2}/>
                    </button>
                </div>
                <div className="prop-body">
                    {FIELD_CONFIG.map((field) => {
                        const {key, label, type} = field;
                        const val = localProps[key];
                        const isEditing = editingKey === key;
                        const isEditable = canEdit(field);
                        return (
                            <div key={key} className="prop-row">
                                <span className="prop-label">{label}</span>
                                {isEditing ? (
                                    <input
                                        className="prop-input"
                                        type={type === 'number' ? 'number' : 'text'}
                                        value={editValue}
                                        autoFocus
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onBlur={() => commitEdit(key, type)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') commitEdit(key, type);
                                            if (e.key === 'Escape') setEditingKey(null);
                                        }}
                                    />
                                ) : (
                                    <span
                                        className={`prop-value ${isEditable ? 'editable' : ''}`}
                                        onDoubleClick={() => isEditable && startEdit(key, formatValue(val))}
                                        title={formatValue(val)}
                                    >
                                        {formatValue(val)}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
                {(editable || showDbActions) && (
                    <div className="prop-actions-wrap">
                        {editable && (
                            <div className="prop-actions">
                                <button
                                    className="prop-btn prop-btn-update"
                                    onClick={() => onUpdate?.(localProps)}
                                >
                                    <RefreshCw size={13} strokeWidth={2}/> Update
                                </button>
                                <button
                                    className="prop-btn prop-btn-save"
                                    onClick={() => onSave?.(localProps)}
                                >
                                    <Save size={13} strokeWidth={2}/> Save to DB
                                </button>
                            </div>
                        )}
                        {showDbActions && (
                            <div className="prop-actions">
                                <button
                                    className="prop-btn prop-btn-update-db"
                                    onClick={() => onUpdateToDb?.(localProps)}
                                >
                                    <CloudUpload size={13} strokeWidth={2}/> Update to DB
                                </button>
                                <button
                                    className="prop-btn prop-btn-delete"
                                    onClick={() => {
                                        if (confirm('Delete this record from DB?')) {
                                            onDeleteFromDb?.(localProps);
                                        }
                                    }}
                                >
                                    <Trash2 size={13} strokeWidth={2}/> Delete from DB
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
