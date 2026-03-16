import { useEffect, useRef, useCallback, useState } from 'react';
import { NodeEditor, ClassicPreset } from 'rete';
import { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { ReactPlugin, Presets as ReactPresets } from 'rete-react-plugin';
import { DataflowEngine } from 'rete-engine';
import type { DataflowNode } from 'rete-engine';
import { createRoot } from 'react-dom/client';

// --- Sockets ---

const numberSocket = new ClassicPreset.Socket('number');
const stringSocket = new ClassicPreset.Socket('string');

// --- Nodes with data() for DataflowEngine ---

class NumberNode extends ClassicPreset.Node {
    constructor(initial: number = 0) {
        super('Number');
        this.addOutput('value', new ClassicPreset.Output(numberSocket, 'Value'));
        this.addControl('number', new ClassicPreset.InputControl('number', { initial }));
    }
    data(): Record<string, any> {
        const ctrl = this.controls['number'] as ClassicPreset.InputControl<'number'>;
        return { value: ctrl?.value ?? 0 };
    }
}

class AddNode extends ClassicPreset.Node {
    constructor() {
        super('Add');
        this.addInput('a', new ClassicPreset.Input(numberSocket, 'A'));
        this.addInput('b', new ClassicPreset.Input(numberSocket, 'B'));
        this.addOutput('result', new ClassicPreset.Output(numberSocket, 'Result'));
    }
    data(inputs: Record<string, any>): Record<string, any> {
        const a = (inputs['a'] ?? [0])[0];
        const b = (inputs['b'] ?? [0])[0];
        return { result: a + b };
    }
}

class SubtractNode extends ClassicPreset.Node {
    constructor() {
        super('Subtract');
        this.addInput('a', new ClassicPreset.Input(numberSocket, 'A'));
        this.addInput('b', new ClassicPreset.Input(numberSocket, 'B'));
        this.addOutput('result', new ClassicPreset.Output(numberSocket, 'Result'));
    }
    data(inputs: Record<string, any>): Record<string, any> {
        const a = (inputs['a'] ?? [0])[0];
        const b = (inputs['b'] ?? [0])[0];
        return { result: a - b };
    }
}

class MultiplyNode extends ClassicPreset.Node {
    constructor() {
        super('Multiply');
        this.addInput('a', new ClassicPreset.Input(numberSocket, 'A'));
        this.addInput('b', new ClassicPreset.Input(numberSocket, 'B'));
        this.addOutput('result', new ClassicPreset.Output(numberSocket, 'Result'));
    }
    data(inputs: Record<string, any>): Record<string, any> {
        const a = (inputs['a'] ?? [1])[0];
        const b = (inputs['b'] ?? [1])[0];
        return { result: a * b };
    }
}

class TextNode extends ClassicPreset.Node {
    constructor(initial: string = '') {
        super('Text');
        this.addOutput('text', new ClassicPreset.Output(stringSocket, 'Text'));
        this.addControl('text', new ClassicPreset.InputControl('text', { initial }));
    }
    data(): Record<string, any> {
        const ctrl = this.controls['text'] as ClassicPreset.InputControl<'text'>;
        return { text: ctrl?.value ?? '' };
    }
}

class OutputNode extends ClassicPreset.Node {
    constructor() {
        super('Output');
        this.addInput('value', new ClassicPreset.Input(numberSocket, 'Value'));
    }
    data(inputs: Record<string, any>): Record<string, any> {
        const val = (inputs['value'] ?? ['N/A'])[0];
        return { value: val };
    }
}

// --- Node factory ---

type DNode = ClassicPreset.Node & DataflowNode;
type NodeFactory = { label: string; create: () => DNode };

const NODE_LIST: NodeFactory[] = [
    { label: 'Number', create: () => new NumberNode(0) },
    { label: 'Add', create: () => new AddNode() },
    { label: 'Subtract', create: () => new SubtractNode() },
    { label: 'Multiply', create: () => new MultiplyNode() },
    { label: 'Text', create: () => new TextNode('') },
    { label: 'Output', create: () => new OutputNode() },
];

// --- Editor setup (use `any` for Schemes to avoid rete v2 generic conflicts) ---

type EditorInstance = {
    editor: NodeEditor<any>;
    area: AreaPlugin<any, any>;
    engine: DataflowEngine<any>;
};

async function createEditor(container: HTMLElement): Promise<EditorInstance> {
    const editor = new NodeEditor<any>();
    const area = new AreaPlugin<any, any>(container);
    const connection = new ConnectionPlugin<any, any>();
    const reactPlugin = new ReactPlugin<any, any>({ createRoot });
    const engine = new DataflowEngine<any>();

    reactPlugin.addPreset(ReactPresets.classic.setup());
    connection.addPreset(ConnectionPresets.classic.setup());

    editor.use(area);
    editor.use(engine);
    area.use(connection);
    area.use(reactPlugin);

    AreaExtensions.selectableNodes(area, AreaExtensions.selector(), {
        accumulating: AreaExtensions.accumulateOnCtrl(),
    });

    // --- Connection selection & deletion ---
    let selectedConnectionId: string | null = null;

    // Click on connection SVG path to select it
    container.addEventListener('click', (e) => {
        const target = e.target as Element;
        // Check if clicked on an SVG path (connection line)
        const path = target.closest('path');
        if (path) {
            // Walk up to find the connection wrapper with data-testid
            const wrapper = path.closest('[data-testid="connection"]');
            if (wrapper) {
                const connId = wrapper.getAttribute('data-id');
                if (connId) {
                    // Deselect previous
                    container.querySelectorAll('[data-testid="connection"].conn-selected')
                        .forEach(el => el.classList.remove('conn-selected'));
                    // Select this one
                    wrapper.classList.add('conn-selected');
                    selectedConnectionId = connId;
                    e.stopPropagation();
                    return;
                }
            }
        }
        // Click elsewhere: deselect connection
        if (selectedConnectionId) {
            container.querySelectorAll('.conn-selected').forEach(el => el.classList.remove('conn-selected'));
            selectedConnectionId = null;
        }
    }, true);

    // Delete selected nodes/connections on Delete or Backspace
    const handleKeyDown = async (e: KeyboardEvent) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        const tgt = e.target as HTMLElement;
        if (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA') return;

        // Delete selected connection
        if (selectedConnectionId) {
            await editor.removeConnection(selectedConnectionId);
            selectedConnectionId = null;
        }

        // Delete selected nodes
        const selected = editor.getNodes().filter((n: any) => n.selected);
        for (const node of selected) {
            const conns = editor.getConnections().filter(
                (c: any) => c.source === node.id || c.target === node.id
            );
            for (const conn of conns) {
                await editor.removeConnection(conn.id);
            }
            await editor.removeNode(node.id);
        }
    };
    container.addEventListener('keydown', handleKeyDown);
    container.setAttribute('tabindex', '0');

    // Style for selected connections
    const style = document.createElement('style');
    style.textContent = `
        .conn-selected path {
            stroke: #ff6b6b !important;
            stroke-width: 5px !important;
        }
    `;
    container.appendChild(style);

    const numA = new NumberNode(10);
    const numB = new NumberNode(20);
    const add = new AddNode();

    await editor.addNode(numA);
    await editor.addNode(numB);
    await editor.addNode(add);

    await editor.addConnection(
        new ClassicPreset.Connection(numA, 'value', add, 'a')
    );
    await editor.addConnection(
        new ClassicPreset.Connection(numB, 'value', add, 'b')
    );

    await area.translate(numA.id, { x: 0, y: 0 });
    await area.translate(numB.id, { x: 0, y: 250 });
    await area.translate(add.id, { x: 350, y: 100 });

    AreaExtensions.zoomAt(area, editor.getNodes());

    return { editor, area, engine };
}

// --- Execute using DataflowEngine ---

async function executeGraph(inst: EditorInstance): Promise<string[]> {
    const { editor, engine } = inst;
    const logs: string[] = [];

    engine.reset();

    const nodes = editor.getNodes();
    const connections = editor.getConnections();

    // Find leaf nodes (no outgoing connections)
    const sources = new Set(connections.map((c: any) => c.source));
    const leafNodes = nodes.filter((n: any) => !sources.has(n.id));
    const targets = leafNodes.length > 0 ? leafNodes : nodes;

    for (const node of targets) {
        try {
            const result = await engine.fetch(node.id);
            const values = Object.entries(result)
                .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                .join(', ');
            logs.push(`[${node.label}] ${values}`);
        } catch (e: any) {
            logs.push(`[${node.label}] Error: ${e.message}`);
        }
    }

    return logs;
}

// --- Component ---

type MenuState = { visible: false } | { visible: true; x: number; y: number };

export default function ReteEditor({ onClose }: { onClose: () => void }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<EditorInstance | null>(null);
    const [menu, setMenu] = useState<MenuState>({ visible: false });
    const [search, setSearch] = useState('');
    const [execLog, setExecLog] = useState<string[] | null>(null);

    const init = useCallback(async () => {
        if (!containerRef.current || editorRef.current) return;
        editorRef.current = await createEditor(containerRef.current);
    }, []);

    useEffect(() => {
        init();
        return () => {
            editorRef.current?.area.destroy();
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
        const node = factory.create();
        await editor.addNode(node);
        const { x, y } = area.area.pointer;
        await area.translate(node.id, { x, y });
        setMenu({ visible: false });
    }, [menu]);

    const handleExecute = useCallback(async () => {
        if (!editorRef.current) return;
        const logs = await executeGraph(editorRef.current);
        setExecLog(logs);
        console.log('--- Execute Graph (DataflowEngine) ---');
        logs.forEach(l => console.log(l));
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
