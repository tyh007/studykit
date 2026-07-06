import type { Node, Edge } from '@xyflow/react';
import type { LiteratureCanvasNode, LiteratureCanvasEdge, LiteraturePaper } from '../../../types';

export interface CanvasNodeActions {
  onContentChange: (nodeId: string, text: string) => void;
  onContentPatch: (nodeId: string, patch: Record<string, any>) => void;
  onStylePatch: (nodeId: string, patch: Record<string, any>) => void;
  onResize: (nodeId: string, width: number, height: number) => void;
  onDelete: (nodeId: string) => void;
  onOpenPaper?: (paper: LiteraturePaper) => void;
}

export interface CanvasEdgeActions {
  onDelete: (edgeId: string) => void;
}

export interface CanvasNodeData {
  canvasNode: LiteratureCanvasNode;
  paper?: LiteraturePaper | null;
  actions: CanvasNodeActions;
  [key: string]: unknown;
}

export interface CanvasEdgeData {
  canvasEdge: LiteratureCanvasEdge;
  actions: CanvasEdgeActions;
  [key: string]: unknown;
}

export type CanvasFlowNode = Node<CanvasNodeData>;
export type CanvasFlowEdge = Edge<CanvasEdgeData>;
