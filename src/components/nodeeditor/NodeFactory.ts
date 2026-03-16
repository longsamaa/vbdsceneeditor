import {ClassicPreset } from 'rete';
import {GetSelectedObjectNode} from './plugins/GetSelectedObject'
import {TransformNode} from './plugins/TransformObject'
import type { DataflowNode } from 'rete-engine';
import type { EditorInstance } from './EditorInstance';
type DNode = ClassicPreset.Node & DataflowNode;
export type NodeFactory = { label: string; create: (editorInstance: EditorInstance) => DNode };
export const NODE_LIST : NodeFactory[] = [
    {label : GetSelectedObjectNode.labelName, create : (ei) => new GetSelectedObjectNode(ei)},
    {label : TransformNode.labelName, create : (ei) => new TransformNode(ei)}
]