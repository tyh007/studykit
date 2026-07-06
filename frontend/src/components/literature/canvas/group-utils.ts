import type { CanvasFlowNode } from './canvas-types';

export function getGroupChildIds(node: CanvasFlowNode): string[] {
  const content = node.data.canvasNode.content_json as Record<string, unknown> | null;
  const ids = content?.child_node_ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export function isTrueGroupNode(node: CanvasFlowNode): boolean {
  const content = node.data.canvasNode.content_json as Record<string, unknown> | null;
  return node.type === 'group' && content?.group_mode === 'true_group';
}

export function getBoundsForNodes(nodes: CanvasFlowNode[]) {
  if (nodes.length === 0) return null;
  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const maxX = Math.max(...nodes.map((node) => node.position.x + (node.width || 240)));
  const maxY = Math.max(...nodes.map((node) => node.position.y + (node.height || 140)));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
