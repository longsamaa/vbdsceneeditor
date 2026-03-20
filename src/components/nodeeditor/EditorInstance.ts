import React from 'react';
import { NodeEditor, ClassicPreset } from 'rete';
import { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { ReactPlugin, Presets as ReactPresets } from 'rete-react-plugin';
import { DataflowEngine } from 'rete-engine';
import { createRoot } from 'react-dom/client';
import { NODE_LIST, type NodeFactory } from './NodeFactory';
import type maplibregl from 'maplibre-gl';
import { LabeledControl } from './plugins/LabeledControl';
import { LabeledControlComponent } from './plugins/LabeledControlComponent';
import { SliderControl } from './plugins/SliderControl';
import { SliderControlComponent } from './plugins/SliderControlComponent';

// --- Graph serialization ---

interface SerializedNode {
    id: string;
    label: string;
    x: number;
    y: number;
}

interface SerializedConnection {
    source: string;
    sourceOutput: string;
    target: string;
    targetInput: string;
}

export interface SerializedGraph {
    nodes: SerializedNode[];
    connections: SerializedConnection[];
}

// --- EditorInstance class ---

export class EditorInstance {
    editor = new NodeEditor<any>();
    area!: AreaPlugin<any, any>;
    engine = new DataflowEngine<any>();
    private _map: maplibregl.Map | null = null;

    getMap(): maplibregl.Map | null {
        return this._map;
    }

    setMap(map: maplibregl.Map | null) {
        this._map = map;
    }

    getNodeList(): NodeFactory[] {
        return NODE_LIST;
    }

    async init(container: HTMLElement) {
        this.area = new AreaPlugin<any, any>(container);
        const connection = new ConnectionPlugin<any, any>();
        const reactPlugin = new ReactPlugin<any, any>({ createRoot });

        reactPlugin.addPreset(ReactPresets.classic.setup({
            customize: {
                control(data) {
                    if (data.payload instanceof SliderControl) {
                        return () => React.createElement(SliderControlComponent, { data: data.payload as SliderControl });
                    }
                    if (data.payload instanceof LabeledControl) {
                        return () => React.createElement(LabeledControlComponent, { data: data.payload as LabeledControl });
                    }
                    return null;
                }
            }
        }));
        connection.addPreset(ConnectionPresets.classic.setup());

        this.editor.use(this.area);
        this.editor.use(this.engine);
        this.area.use(connection);
        this.area.use(reactPlugin);

        AreaExtensions.selectableNodes(this.area, AreaExtensions.selector(), {
            accumulating: AreaExtensions.accumulateOnCtrl(),
        });

        // --- Connection selection & deletion ---
        let selectedConnectionId: string | null = null;
        const editor = this.editor;

        container.addEventListener('click', (e) => {
            const target = e.target as Element;
            const path = target.closest('path');
            if (path) {
                const wrapper = path.closest('[data-testid="connection"]');
                if (wrapper) {
                    const connId = wrapper.getAttribute('data-id');
                    if (connId) {
                        container.querySelectorAll('[data-testid="connection"].conn-selected')
                            .forEach(el => el.classList.remove('conn-selected'));
                        wrapper.classList.add('conn-selected');
                        selectedConnectionId = connId;
                        e.stopPropagation();
                        return;
                    }
                }
            }
            if (selectedConnectionId) {
                container.querySelectorAll('.conn-selected').forEach(el => el.classList.remove('conn-selected'));
                selectedConnectionId = null;
            }
        }, true);

        const handleKeyDown = async (e: KeyboardEvent) => {
            if (e.key !== 'Delete' && e.key !== 'Backspace') return;
            const tgt = e.target as HTMLElement;
            if (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA') return;

            if (selectedConnectionId) {
                await editor.removeConnection(selectedConnectionId);
                selectedConnectionId = null;
            }

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

        const style = document.createElement('style');
        style.textContent = `
            .conn-selected path {
                stroke: #ff6b6b !important;
                stroke-width: 5px !important;
            }
        `;
        container.appendChild(style);

        AreaExtensions.zoomAt(this.area, this.editor.getNodes());
    }

    async addNode(factory: NodeFactory, x: number, y: number) {
        const node = factory.create(this);
        await this.editor.addNode(node);
        await this.area.translate(node.id, { x, y });
    }

    async addNodeAtPointer(factory: NodeFactory) {
        const { x, y } = this.area.area.pointer;
        await this.addNode(factory, x, y);
    }

    exportGraph(): SerializedGraph {
        const nodes = this.editor.getNodes().map((n: any) => {
            const view = this.area.nodeViews.get(n.id);
            const pos = view ? view.position : { x: 0, y: 0 };
            return { id: n.id, label: n.label, x: pos.x, y: pos.y };
        });
        const connections = this.editor.getConnections().map((c: any) => ({
            source: c.source,
            sourceOutput: c.sourceOutput,
            target: c.target,
            targetInput: c.targetInput,
        }));
        return { nodes, connections };
    }

    exportGraphJSON(): string {
        return JSON.stringify(this.exportGraph(), null, 2);
    }

    async loadGraph(graph: SerializedGraph) {
        for (const c of this.editor.getConnections()) {
            await this.editor.removeConnection(c.id);
        }
        for (const n of this.editor.getNodes()) {
            await this.editor.removeNode(n.id);
        }
        const idMap = new Map<string, string>();
        for (const sn of graph.nodes) {
            const factory = NODE_LIST.find(f => f.label === sn.label);
            if (!factory) continue;
            const node = factory.create(this);
            idMap.set(sn.id, node.id);
            await this.editor.addNode(node);
            await this.area.translate(node.id, { x: sn.x, y: sn.y });
        }

        for (const sc of graph.connections) {
            const sourceId = idMap.get(sc.source);
            const targetId = idMap.get(sc.target);
            if (!sourceId || !targetId) continue;
            const sourceNode = this.editor.getNode(sourceId);
            const targetNode = this.editor.getNode(targetId);
            if (!sourceNode || !targetNode) continue;
            const conn = new ClassicPreset.Connection(sourceNode, sc.sourceOutput, targetNode, sc.targetInput);
            await this.editor.addConnection(conn);
        }
    }

    async loadGraphJSON(json: string) {
        const graph: SerializedGraph = JSON.parse(json);
        await this.loadGraph(graph);
    }

    async execute(): Promise<string[]> {
        const logs: string[] = [];
        this.engine.reset();

        const nodes = this.editor.getNodes();
        const connections = this.editor.getConnections();

        const sources = new Set(connections.map((c: any) => c.source));
        const leafNodes = nodes.filter((n: any) => !sources.has(n.id));
        const targets = leafNodes.length > 0 ? leafNodes : nodes;

        for (const node of targets) {
            try {
                const result = await this.engine.fetch(node.id);
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

    downloadGraph(filename = 'graph.json') {
        const json = this.exportGraphJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    openLoadDialog(): Promise<void> {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) { resolve(); return; }
                const text = await file.text();
                await this.loadGraphJSON(text);
                resolve();
            };
            input.click();
        });
    }

    destroy() {
        this.area.destroy();
    }
}
