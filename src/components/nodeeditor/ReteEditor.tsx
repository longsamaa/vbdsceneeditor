import { useEffect, useRef, useCallback, useState } from 'react';
import { NodeEditor, ClassicPreset } from 'rete';
import type { GetSchemes } from 'rete';
import { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { ReactPlugin, Presets as ReactPresets } from 'rete-react-plugin';
import type { ReactArea2D } from 'rete-react-plugin';
import { createRoot } from 'react-dom/client';

type Schemes = GetSchemes<
    ClassicPreset.Node,
    ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>
>;
type AreaExtra = ReactArea2D<Schemes>;

const numberSocket = new ClassicPreset.Socket('number');
const stringSocket = new ClassicPreset.Socket('string');

class NumberNode extends ClassicPreset.Node {
    constructor(initial: number = 0) {
        super('Number');
        this.addOutput('value', new ClassicPreset.Output(numberSocket, 'Value'));
        this.addControl('number', new ClassicPreset.InputControl('number', { initial }));
    }
}

class AddNode extends ClassicPreset.Node {
    constructor() {
        super('Add');
        this.addInput('a', new ClassicPreset.Input(numberSocket, 'A'));
        this.addInput('b', new ClassicPreset.Input(numberSocket, 'B'));
        this.addOutput('result', new ClassicPreset.Output(numberSocket, 'Result'));
    }
}

class SubtractNode extends ClassicPreset.Node {
    constructor() {
        super('Subtract');
        this.addInput('a', new ClassicPreset.Input(numberSocket, 'A'));
        this.addInput('b', new ClassicPreset.Input(numberSocket, 'B'));
        this.addOutput('result', new ClassicPreset.Output(numberSocket, 'Result'));
    }
}

class MultiplyNode extends ClassicPreset.Node {
    constructor() {
        super('Multiply');
        this.addInput('a', new ClassicPreset.Input(numberSocket, 'A'));
        this.addInput('b', new ClassicPreset.Input(numberSocket, 'B'));
        this.addOutput('result', new ClassicPreset.Output(numberSocket, 'Result'));
    }
}

class TextNode extends ClassicPreset.Node {
    constructor(initial: string = '') {
        super('Text');
        this.addOutput('text', new ClassicPreset.Output(stringSocket, 'Text'));
        this.addControl('text', new ClassicPreset.InputControl('text', { initial }));
    }
}

class OutputNode extends ClassicPreset.Node {
    constructor() {
        super('Output');
        this.addInput('value', new ClassicPreset.Input(numberSocket, 'Value'));
    }
}

type NodeFactory = { label: string; create: () => ClassicPreset.Node };

const NODE_LIST: NodeFactory[] = [
    { label: 'Number', create: () => new NumberNode(0) },
    { label: 'Add', create: () => new AddNode() },
    { label: 'Subtract', create: () => new SubtractNode() },
    { label: 'Multiply', create: () => new MultiplyNode() },
    { label: 'Text', create: () => new TextNode('') },
    { label: 'Output', create: () => new OutputNode() },
];

async function createEditor(container: HTMLElement) {
    const editor = new NodeEditor<Schemes>();
    const area = new AreaPlugin<Schemes, AreaExtra>(container);
    const connection = new ConnectionPlugin<Schemes, AreaExtra>();
    const reactPlugin = new ReactPlugin<Schemes, AreaExtra>({ createRoot });

    reactPlugin.addPreset(ReactPresets.classic.setup());
    connection.addPreset(ConnectionPresets.classic.setup());

    editor.use(area);
    area.use(connection);
    area.use(reactPlugin);

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

    return { editor, area };
}

function executeGraph(editor: NodeEditor<Schemes>): string[] {
    const nodes = editor.getNodes();
    const connections = editor.getConnections();
    const results = new Map<string, Record<string, any>>();
    const logs: string[] = [];

    // Build dependency graph
    const incomingMap = new Map<string, { nodeId: string; outputKey: string; inputKey: string }[]>();
    for (const conn of connections) {
        const list = incomingMap.get(conn.target) || [];
        list.push({ nodeId: conn.source, outputKey: conn.sourceOutput, inputKey: conn.targetInput });
        incomingMap.set(conn.target, list);
    }

    // Topological sort (simple BFS)
    const inDegree = new Map<string, number>();
    for (const n of nodes) inDegree.set(n.id, 0);
    for (const conn of connections) {
        inDegree.set(conn.target, (inDegree.get(conn.target) || 0) + 1);
    }
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
        if (deg === 0) queue.push(id);
    }
    const sorted: string[] = [];
    while (queue.length > 0) {
        const id = queue.shift()!;
        sorted.push(id);
        for (const conn of connections) {
            if (conn.source === id) {
                const newDeg = (inDegree.get(conn.target) || 1) - 1;
                inDegree.set(conn.target, newDeg);
                if (newDeg === 0) queue.push(conn.target);
            }
        }
    }

    // Execute nodes in order
    for (const nodeId of sorted) {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) continue;

        const inputs: Record<string, any> = {};
        const incoming = incomingMap.get(nodeId) || [];
        for (const inc of incoming) {
            const sourceResults = results.get(inc.nodeId);
            if (sourceResults) {
                inputs[inc.inputKey] = sourceResults[inc.outputKey];
            }
        }

        const outputs: Record<string, any> = {};

        switch (node.label) {
            case 'Number': {
                const ctrl = node.controls['number'] as ClassicPreset.InputControl<'number'> | undefined;
                outputs['value'] = ctrl?.value ?? 0;
                logs.push(`[Number] = ${outputs['value']}`);
                break;
            }
            case 'Text': {
                const ctrl = node.controls['text'] as ClassicPreset.InputControl<'text'> | undefined;
                outputs['text'] = ctrl?.value ?? '';
                logs.push(`[Text] = "${outputs['text']}"`);
                break;
            }
            case 'Add': {
                const a = inputs['a'] ?? 0;
                const b = inputs['b'] ?? 0;
                outputs['result'] = a + b;
                logs.push(`[Add] ${a} + ${b} = ${outputs['result']}`);
                break;
            }
            case 'Subtract': {
                const a = inputs['a'] ?? 0;
                const b = inputs['b'] ?? 0;
                outputs['result'] = a - b;
                logs.push(`[Subtract] ${a} - ${b} = ${outputs['result']}`);
                break;
            }
            case 'Multiply': {
                const a = inputs['a'] ?? 0;
                const b = inputs['b'] ?? 0;
                outputs['result'] = a * b;
                logs.push(`[Multiply] ${a} * ${b} = ${outputs['result']}`);
                break;
            }
            case 'Output': {
                const val = inputs['value'] ?? 'N/A';
                logs.push(`[Output] => ${val}`);
                break;
            }
            default:
                logs.push(`[${node.label}] (unknown)`);
        }

        results.set(nodeId, outputs);
    }

    return logs;
}

type MenuState = { visible: false } | { visible: true; x: number; y: number; clientX: number; clientY: number };

export default function ReteEditor({ onClose }: { onClose: () => void }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<{ editor: NodeEditor<Schemes>; area: AreaPlugin<Schemes, AreaExtra> } | null>(null);
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
            clientX: e.clientX,
            clientY: e.clientY,
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
                        onClick={() => {
                            if (!editorRef.current) return;
                            const logs = executeGraph(editorRef.current.editor);
                            setExecLog(logs);
                            console.log('--- Execute Graph ---');
                            logs.forEach(l => console.log(l));
                        }}
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
