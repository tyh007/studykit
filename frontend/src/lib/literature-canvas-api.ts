import { getAuthToken } from './api';
import type {
  LiteratureCanvas,
  LiteratureCanvasNode,
  LiteratureCanvasEdge,
  LiteratureCanvasScene,
  LiteratureCanvasState,
  LiteraturePaper,
} from '../types';

const API_BASE = (typeof window !== 'undefined' && (window as any).__ENV?.VITE_API_URL)
  ? `${(window as any).__ENV.VITE_API_URL}/api`
  : import.meta.env.VITE_API_URL
    ? `${import.meta.env.VITE_API_URL}/api`
    : '/api';

async function litRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export interface ViewportPayload {
  x: number;
  y: number;
  zoom: number;
}

export interface CreateCanvasNodeInput {
  node_type: 'paper' | 'note' | 'text' | 'question' | 'group' | 'shape';
  ref_type?: string;
  ref_id?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  z_index?: number;
  content_json?: Record<string, any>;
  style_json?: Record<string, any>;
}

export interface UpdateCanvasNodeInput {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  z_index?: number;
  content_json?: Record<string, any>;
  style_json?: Record<string, any>;
}

export interface CreateCanvasEdgeInput {
  source_node_id: string;
  target_node_id: string;
  edge_type: 'canvas' | 'paper_relation';
  relation_type?: 'cites' | 'extends' | 'contradicts' | 'supports' | 'related' | 'method' | 'dataset';
  label?: string;
  content_json?: Record<string, any>;
  style_json?: Record<string, any>;
}

export interface UpdateCanvasEdgeInput {
  label?: string;
  content_json?: Record<string, any>;
  style_json?: Record<string, any>;
}

export interface CreateCanvasSceneInput {
  name: string;
  viewport: ViewportPayload;
  sort_order?: number;
}

export interface UpdateCanvasSceneInput {
  name?: string;
  viewport?: ViewportPayload;
  sort_order?: number;
}

export const literatureCanvasApi = {
  listOrCreate(projectId: string): Promise<LiteratureCanvas[]> {
    return litRequest<LiteratureCanvas[]>(`/literature/canvas?projectId=${projectId}`);
  },

  state(canvasId: string): Promise<LiteratureCanvasState> {
    return litRequest<LiteratureCanvasState>(`/literature/canvas/${canvasId}/state`);
  },

  updateViewport(canvasId: string, viewport: ViewportPayload): Promise<LiteratureCanvas> {
    return litRequest<LiteratureCanvas>(`/literature/canvas/${canvasId}/viewport`, {
      method: 'PATCH',
      body: JSON.stringify({ viewport }),
    });
  },

  scenes(canvasId: string): Promise<LiteratureCanvasScene[]> {
    return litRequest<LiteratureCanvasScene[]>(`/literature/canvas/${canvasId}/scenes`);
  },

  createScene(canvasId: string, data: CreateCanvasSceneInput): Promise<LiteratureCanvasScene> {
    return litRequest<LiteratureCanvasScene>(`/literature/canvas/${canvasId}/scenes`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateScene(
    canvasId: string,
    sceneId: string,
    data: UpdateCanvasSceneInput
  ): Promise<LiteratureCanvasScene> {
    return litRequest<LiteratureCanvasScene>(`/literature/canvas/${canvasId}/scenes/${sceneId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  deleteScene(canvasId: string, sceneId: string): Promise<{ success: boolean }> {
    return litRequest<{ success: boolean }>(`/literature/canvas/${canvasId}/scenes/${sceneId}`, {
      method: 'DELETE',
    });
  },

  createNode(canvasId: string, data: CreateCanvasNodeInput): Promise<LiteratureCanvasNode> {
    return litRequest<LiteratureCanvasNode>(`/literature/canvas/${canvasId}/nodes`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateNode(
    canvasId: string,
    nodeId: string,
    data: UpdateCanvasNodeInput
  ): Promise<LiteratureCanvasNode> {
    return litRequest<LiteratureCanvasNode>(`/literature/canvas/${canvasId}/nodes/${nodeId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  deleteNode(canvasId: string, nodeId: string): Promise<{ success: boolean }> {
    return litRequest<{ success: boolean }>(`/literature/canvas/${canvasId}/nodes/${nodeId}`, {
      method: 'DELETE',
    });
  },

  createEdge(canvasId: string, data: CreateCanvasEdgeInput): Promise<LiteratureCanvasEdge> {
    return litRequest<LiteratureCanvasEdge>(`/literature/canvas/${canvasId}/edges`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateEdge(
    canvasId: string,
    edgeId: string,
    data: UpdateCanvasEdgeInput
  ): Promise<LiteratureCanvasEdge> {
    return litRequest<LiteratureCanvasEdge>(`/literature/canvas/${canvasId}/edges/${edgeId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  deleteEdge(canvasId: string, edgeId: string): Promise<{ success: boolean }> {
    return litRequest<{ success: boolean }>(`/literature/canvas/${canvasId}/edges/${edgeId}`, {
      method: 'DELETE',
    });
  },

  importPapers(
    canvasId: string,
    paperIds: string[],
    origin?: { x: number; y: number }
  ): Promise<{ created: LiteratureCanvasNode[]; skipped: string[] }> {
    return litRequest<{ created: LiteratureCanvasNode[]; skipped: string[] }>(
      `/literature/canvas/${canvasId}/import-papers`,
      {
        method: 'POST',
        body: JSON.stringify({ paperIds, origin }),
      }
    );
  },
};
