import type { CanvasFlowNode } from './canvas-types';

export const GROUP_INNER_PADDING = 16;

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

export interface NodeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getNodeBounds(node: CanvasFlowNode): NodeBounds {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width || 240,
    height: node.height || 140,
  };
}

export function isPointInBounds(px: number, py: number, bounds: NodeBounds): boolean {
  return (
    px >= bounds.x &&
    px <= bounds.x + bounds.width &&
    py >= bounds.y &&
    py <= bounds.y + bounds.height
  );
}

export function getNodeCenter(node: CanvasFlowNode): { x: number; y: number } {
  return {
    x: node.position.x + (node.width || 240) / 2,
    y: node.position.y + (node.height || 140) / 2,
  };
}

export function findContainingGroup(
  node: CanvasFlowNode,
  allNodes: CanvasFlowNode[]
): CanvasFlowNode | null {
  if (node.type === 'group') return null;
  const center = getNodeCenter(node);
  const groupNodes = allNodes.filter(isTrueGroupNode);
  let best: CanvasFlowNode | null = null;
  let bestArea = Infinity;
  for (const group of groupNodes) {
    if (group.id === node.id) continue;
    const bounds = getNodeBounds(group);
    if (!isPointInBounds(center.x, center.y, bounds)) continue;
    const area = bounds.width * bounds.height;
    if (area < bestArea) {
      bestArea = area;
      best = group;
    }
  }
  return best;
}

export function computeAutoFitGroup(group: CanvasFlowNode, childNodes: CanvasFlowNode[]) {
  const realChildren = childNodes.filter(
    (node) => node.id !== group.id && node.type !== 'group'
  );
  if (realChildren.length === 0) {
    return null;
  }
  const bounds = getBoundsForNodes(realChildren);
  if (!bounds) return null;
  const padding = GROUP_INNER_PADDING;
  const headerHeight = 36;
  return {
    x: bounds.minX - padding,
    y: bounds.minY - padding - headerHeight,
    width: Math.max(220, bounds.width + padding * 2),
    height: Math.max(140, bounds.height + padding * 2 + headerHeight),
  };
}

export function ensureGroupBelowChildren(
  group: CanvasFlowNode,
  children: CanvasFlowNode[]
): number {
  if (children.length === 0) return group.zIndex ?? 0;
  const minChildZ = Math.min(
    ...children.map((child) => child.zIndex ?? 0)
  );
  return minChildZ - 1;
}
