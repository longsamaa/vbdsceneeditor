import { useEffect, useRef, useCallback, useState } from 'react';
import { NODE_LIST, type NodeFactory } from './NodeFactory';
import { EditorInstance, type SerializedGraph } from './EditorInstance';
import type maplibregl from 'maplibre-gl';

// --- Component ---

type MenuState = { visible: false } | { visible: true; x: number; y: number };

export default function Editor({ onClose, map }: { onClose: () => void; map: maplibregl.Map | null }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<EditorInstance | null>(null);
    const [menu, setMenu] = useState<MenuState>({ visible: false });
    const [search, setSearch] = useState('');
    const [execLog, setExecLog] = useState<string[] | null>(null);

    const init = useCallback(async () => {
        if (!containerRef.current || editorRef.current) return;
        const inst = new EditorInstance();
        inst.setMap(map);
        await inst.init(containerRef.current);
        editorRef.current = inst;
    }, []);

    useEffect(() => {
        init();
        return () => {
            editorRef.current?.destroy();
            editorRef.current = null;
        };
    }, [init]);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        setMenu({
            visible: true,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        });
        setSearch('');
    }, []);

    const addNode = useCallback(async (factory: NodeFactory) => {
        if (!editorRef.current || !menu.visible) return;
        const { editor, area } = editorRef.current;
        const node = factory.create(editorRef.current);
        await editor.addNode(node);
        const { x, y } = area.area.pointer;
        await area.translate(node.id, { x, y });
        setMenu({ visible: false });
    }, [menu]);

    const handleExecute = useCallback(async () => {
        if (!editorRef.current) return;
        const logs = await editorRef.current.execute();
        setExecLog(logs);
        console.log('--- Execute Graph (DataflowEngine) ---');
        logs.forEach(l => console.log(l));
    }, []);

    const handleExport = useCallback(() => {
        if (!editorRef.current) return;
        const graph = editorRef.current.exportGraph();
        const json = JSON.stringify(graph, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'graph.json';
        a.click();
        URL.revokeObjectURL(url);
    }, []);

    const handleLoad = useCallback(() => {
        if (!editorRef.current) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file || !editorRef.current) return;
            const text = await file.text();
            const graph: SerializedGraph = JSON.parse(text);
            await editorRef.current.loadGraph(graph);
        };
        input.click();
    }, []);

    const filtered = NODE_LIST.filter(n =>
        n.label.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div
            onPointerDown={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onWheel={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
            style={{
                position: 'fixed',
                bottom: 0,
                left: 0,
                width: 700,
                height: 450,
                zIndex: 9999,
                background: '#1e1e1e',
                display: 'flex',
                flexDirection: 'column',
                borderRadius: '0 8px 0 0',
                boxShadow: '4px -4px 20px rgba(0,0,0,0.4)',
                overflow: 'hidden',
            }}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 12px',
                background: '#2d2d2d',
                borderBottom: '1px solid #444',
            }}>
                <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>Node Editor</span>
                <div style={{ display: 'flex', gap: 6 }}>
                    <button
                        onClick={handleExport}
                        style={{
                            background: '#2196f3',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 4,
                            padding: '3px 12px',
                            cursor: 'pointer',
                            fontSize: 12,
                            fontWeight: 600,
                        }}
                    >
                        Export
                    </button>
                    <button
                        onClick={handleLoad}
                        style={{
                            background: '#ff9800',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 4,
                            padding: '3px 12px',
                            cursor: 'pointer',
                            fontSize: 12,
                            fontWeight: 600,
                        }}
                    >
                        Load
                    </button>
                    <button
                        onClick={handleExecute}
                        style={{
                            background: '#4caf50',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 4,
                            padding: '3px 12px',
                            cursor: 'pointer',
                            fontSize: 12,
                            fontWeight: 600,
                        }}
                    >
                        Execute
                    </button>
                    <button
                        onClick={onClose}
                        style={{
                            background: '#e44',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 4,
                            padding: '3px 10px',
                            cursor: 'pointer',
                            fontSize: 12,
                        }}
                    >
                        X
                    </button>
                </div>
            </div>
            <div
                ref={containerRef}
                onContextMenu={handleContextMenu}
                onClick={() => menu.visible && setMenu({ visible: false })}
                style={{ flex: 1, position: 'relative' }}
            >
                {menu.visible && (
                    <div
                        style={{
                            position: 'absolute',
                            left: menu.x,
                            top: menu.y,
                            zIndex: 100,
                            background: '#2d2d2d',
                            border: '1px solid #555',
                            borderRadius: 6,
                            padding: 4,
                            minWidth: 160,
                            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                        }}
                        onMouseDown={e => e.stopPropagation()}
                        onPointerDown={e => e.stopPropagation()}
                    >
                        <input
                            autoFocus
                            placeholder="Search nodes..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                padding: '5px 8px',
                                border: '1px solid #555',
                                borderRadius: 4,
                                background: '#1e1e1e',
                                color: '#fff',
                                fontSize: 12,
                                outline: 'none',
                                marginBottom: 4,
                            }}
                            onKeyDown={e => {
                                if (e.key === 'Escape') setMenu({ visible: false });
                                if (e.key === 'Enter' && filtered.length > 0) {
                                    addNode(filtered[0]);
                                }
                            }}
                        />
                        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                            {filtered.map(factory => (
                                <div
                                    key={factory.label}
                                    onClick={() => addNode(factory)}
                                    style={{
                                        padding: '6px 10px',
                                        color: '#ddd',
                                        fontSize: 12,
                                        cursor: 'pointer',
                                        borderRadius: 3,
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#4a90d9')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                >
                                    {factory.label}
                                </div>
                            ))}
                            {filtered.length === 0 && (
                                <div style={{ padding: '6px 10px', color: '#888', fontSize: 12 }}>
                                    No nodes found
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
            {execLog && (
                <div style={{
                    borderTop: '1px solid #444',
                    background: '#181818',
                    maxHeight: 120,
                    overflowY: 'auto',
                    padding: '6px 12px',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: '#ccc',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ color: '#4caf50', fontWeight: 600, fontSize: 11 }}>Output</span>
                        <span
                            onClick={() => setExecLog(null)}
                            style={{ color: '#888', cursor: 'pointer', fontSize: 11 }}
                        >
                            clear
                        </span>
                    </div>
                    {execLog.map((line, i) => (
                        <div key={i} style={{ lineHeight: 1.6 }}>{line}</div>
                    ))}
                </div>
            )}
        </div>
    );
}
