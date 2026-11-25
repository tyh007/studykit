import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type NodeChange,
  type EdgeChange,
  type Viewport,
} from '@xyflow/react';
import { literatureCanvasApi } from '../../../lib/literature-canvas-api';
import type {
  LiteratureCanvasNode,
  LiteratureCanvasEdge,
  LiteratureCanvasScene,
  LiteraturePaper,
} from '../../../types';
import type { CanvasFlowNode, CanvasFlowEdge } from './canvas-types';
import { debounce } from './canvas-utils';
import {
  computeAutoFitGroup,
  ensureGroupBelowChildren,
  findContainingGroup,
  getBoundsForNodes,
  getGroupChildIds,
  isTrueGroupNode,
} from './group-utils';
import { kindToEdgePayload, type RelationKind } from './relation-types';

const VIEWPORT_DEBOUNCE_MS = 1000;
const CONTENT_DEBOUNCE_MS = 600;

type AddableNodeType = 'text' | 'note' | 'question' | 'group' | 'shape';

export function useLiteratureCanvas(projectId: string) {
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [papersById, setPapersById] = useState<Record<string, LiteraturePaper>>({});
  const [scenes, setScenes] = useState<LiteratureCanvasScene[]>([]);
  const [initialViewport, setInitialViewport] = useState<Viewport | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>();
  const [openPaper, setOpenPaper] = useState<LiteraturePaper | null>(null);
  const { fitView, getViewport, screenToFlowPosition, setCenter, setViewport } = useReactFlow();

  const [nodes, setNodes] = useNodesState<CanvasFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasFlowEdge>([]);

  // Per-node pending content buffers (so debounced PATCHes don't lose typing)
  const contentBuffers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    return () => {
      for (const timeout of Object.values(contentBuffers.current)) {
        clearTimeout(timeout);
      }
      contentBuffers.current = {};
    };
  }, [projectId]);

  // Refs used inside callbacks that should not re-create on every render
  const nodesRef = useRef<CanvasFlowNode[]>([]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  // Mirror papersById into a ref so async callbacks (e.g. import after upload)
  // can resolve newly-added papers without relying on a stale closure capture.
  const papersByIdRef = useRef<Record<string, LiteraturePaper>>({});
  useEffect(() => {
    papersByIdRef.current = papersById;
  }, [papersById]);

  const getDefaultNodePosition = useCallback(
    (width = 260) => {
      const selected = nodesRef.current.find((node) => node.selected);
      if (selected) {
        return {
          x: selected.position.x + (selected.width || width) + 36,
          y: selected.position.y,
        };
      }
      if (typeof window !== 'undefined') {
        return screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
      }
      return { x: 120, y: 120 };
    },
    [screenToFlowPosition]
  );

  useEffect(() => {
    setNodes((curr) =>
      curr.map((node) => {
        const paperId = node.data.canvasNode.ref_type === 'paper' ? node.data.canvasNode.ref_id : null;
        if (!paperId) return node;
        const nextPaper = papersById[paperId] ?? null;
        return node.data.paper === nextPaper
          ? node
          : { ...node, data: { ...node.data, paper: nextPaper } };
      })
    );
  }, [papersById, setNodes]);

  // ---- Load canvas + state on projectId change ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await literatureCanvasApi.listOrCreate(projectId);
        if (cancelled) return;
        const canvas = list[0];
        if (!canvas) {
          setCanvasId(null);
          return;
        }
        setCanvasId(canvas.id);
        const vp = canvas.viewport_json || {};
        if (
          typeof vp.x === 'number' &&
          typeof vp.y === 'number' &&
          typeof vp.zoom === 'number'
        ) {
          setInitialViewport({ x: vp.x, y: vp.y, zoom: vp.zoom });
        } else {
          setInitialViewport(null);
        }

        const state = await literatureCanvasApi.state(canvas.id);
        if (cancelled) return;
        const pmap: Record<string, LiteraturePaper> = {};
        for (const p of state.papers || []) pmap[p.id] = p;
        setPapersById(pmap);
        setScenes(state.scenes || []);

        // Build fresh action closures that read the latest nodesRef / canvasId
        const buildNodeActions = () => ({
          onContentChange: (nodeId: string, text: string) => handleContentChange(nodeId, text),
          onContentPatch: (nodeId: string, patch: Record<string, any>) => handleContentPatch(nodeId, patch),
          onStylePatch: (nodeId: string, patch: Record<string, any>) => handleStylePatch(nodeId, patch),
          onResize: (nodeId: string, width: number, height: number) => handleResizeNode(nodeId, width, height),
          onDelete: (nodeId: string) => handleDeleteNode(nodeId),
          onOpenPaper: (paper: LiteraturePaper) => setOpenPaper(paper),
        });
        const buildEdgeActions = () => ({
          onDelete: (edgeId: string) => handleDeleteEdge(edgeId),
          onUpdateKind: (edgeId: string, next: RelationKind) => handleUpdateEdge(edgeId, next),
        });

        const flowNodes: CanvasFlowNode[] = (state.nodes || []).map((n: LiteratureCanvasNode) => ({
          id: n.id,
          type: n.node_type,
          position: { x: n.x, y: n.y },
          width: n.width,
          height: n.height,
          zIndex: n.z_index,
          data: {
            canvasNode: n,
            paper: n.ref_type === 'paper' && n.ref_id ? pmap[n.ref_id] ?? null : null,
            actions: buildNodeActions(),
          },
        }));
        const flowEdges: CanvasFlowEdge[] = (state.edges || []).map((e: LiteratureCanvasEdge) => ({
          id: e.id,
          source: e.source_node_id,
          target: e.target_node_id,
          label: e.label || undefined,
          data: {
            canvasEdge: e,
            actions: buildEdgeActions(),
          },
        }));
        setNodes(flowNodes);
        setEdges(flowEdges);
      } catch (err) {
        console.error('Canvas load failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally exclude the action handlers so we don't refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ---- Viewport persistence (debounced 1000 ms) ----
  const saveViewport = useMemo(
    () =>
      debounce((id: string, vp: Viewport) => {
        literatureCanvasApi
          .updateViewport(id, { x: vp.x, y: vp.y, zoom: vp.zoom })
          .then(() => setLastSavedAt(Date.now()))
          .catch((err) => console.warn('Viewport save failed:', err))
          .finally(() => setSaving(false));
      }, VIEWPORT_DEBOUNCE_MS),
    []
  );

  const onViewportChange = useCallback(
    (vp: Viewport) => {
      if (!canvasId) return;
      setSaving(true);
      saveViewport(canvasId, vp);
    },
    [canvasId, saveViewport]
  );

  // ---- Group membership sync (called on drag/resize stop) ----
  // After a drag stop, look at every affected non-group node:
  //   - If its center is now inside a true_group, add it to that group's
  //     child_node_ids (and remove it from any other group).
  //   - If it was in a group but no longer inside, remove it.
  // Membership changes are persisted to the backend.
  const syncGroupMembership = useCallback(
    (changedIds: string[], isRemove: (id: string) => boolean) => {
      if (!canvasId) return;
      const currentNodes = nodesRef.current;
      const groupNodes = currentNodes.filter(isTrueGroupNode);
      if (groupNodes.length === 0) return;

      // Build current membership map
      const membership = new Map<string, string | null>();
      for (const node of currentNodes) {
        if (node.type === 'group') continue;
        const owningGroup = groupNodes.find((g) => getGroupChildIds(g).includes(node.id));
        membership.set(node.id, owningGroup ? owningGroup.id : null);
      }

      const groupUpdates = new Map<string, { added: string[]; removed: string[] }>();
      const ensureEntry = (gid: string) => {
        if (!groupUpdates.has(gid)) groupUpdates.set(gid, { added: [], removed: [] });
        return groupUpdates.get(gid)!;
      };

      for (const nodeId of changedIds) {
        const node = currentNodes.find((n) => n.id === nodeId);
        if (!node || node.type === 'group' || isRemove(nodeId)) continue;
        const previousGroupId = membership.get(nodeId) ?? null;
        const newGroup = findContainingGroup(node, currentNodes);
        const newGroupId = newGroup ? newGroup.id : null;
        if (previousGroupId === newGroupId) continue;

        if (previousGroupId) {
          ensureEntry(previousGroupId).removed.push(nodeId);
        }
        if (newGroupId) {
          ensureEntry(newGroupId).added.push(nodeId);
        }
        membership.set(nodeId, newGroupId);
      }

      if (groupUpdates.size === 0) return;

      setNodes((curr) => {
        return curr.map((node) => {
          const update = groupUpdates.get(node.id);
          if (!update) return node;
          const prev = getGroupChildIds(node);
          const nextChildIds = Array.from(
            new Set(
              prev
                .filter((cid) => !update.removed.includes(cid) && curr.some((c) => c.id === cid))
                .concat(update.added)
            )
          );
          const content = (node.data.canvasNode.content_json as Record<string, any>) || {};
          return {
            ...node,
            data: {
              ...node.data,
              canvasNode: {
                ...node.data.canvasNode,
                content_json: { ...content, child_node_ids: nextChildIds },
              },
            },
          };
        });
      });

      for (const [groupId, update] of groupUpdates) {
        const group = currentNodes.find((n) => n.id === groupId);
        if (!group) continue;
        const prev = getGroupChildIds(group);
        const next = Array.from(
          new Set(
            prev
              .filter((cid) => !update.removed.includes(cid))
              .concat(update.added)
          )
        );
        const content = (group.data.canvasNode.content_json as Record<string, any>) || {};
        const nextContent = { ...content, child_node_ids: next };
        literatureCanvasApi
          .updateNode(canvasId, groupId, { content_json: nextContent })
          .then((updated) => {
            setNodes((curr) =>
              curr.map((item) =>
                item.id === groupId
                  ? { ...item, data: { ...item.data, canvasNode: updated } }
                  : item
              )
            );
            setLastSavedAt(Date.now());
          })
          .catch((err) => console.warn('Group membership save failed:', err));
      }
    },
    [canvasId, setNodes]
  );

  // ---- Auto-fit a group whenever one of its children moves/resizes ----
  const refitGroupsContaining = useCallback(
    (changedIds: string[]) => {
      if (!canvasId) return;
      const currentNodes = nodesRef.current;
      const groupNodes = currentNodes.filter(isTrueGroupNode);
      const groupIds = new Set<string>();
      for (const group of groupNodes) {
        const childIds = getGroupChildIds(group);
        if (changedIds.some((id) => childIds.includes(id))) {
          groupIds.add(group.id);
        }
      }
      if (groupIds.size === 0) return;

      for (const groupId of groupIds) {
        const group = currentNodes.find((n) => n.id === groupId);
        if (!group) continue;
        const childIds = getGroupChildIds(group);
        const childNodes = currentNodes.filter((n) => childIds.includes(n.id));
        const fit = computeAutoFitGroup(group, childNodes);
        if (!fit) continue;
        const widthChanged = Math.abs(fit.width - (group.width || 0)) > 0.5;
        const heightChanged = Math.abs(fit.height - (group.height || 0)) > 0.5;
        const xChanged = Math.abs(fit.x - group.position.x) > 0.5;
        const yChanged = Math.abs(fit.y - group.position.y) > 0.5;
        if (!widthChanged && !heightChanged && !xChanged && !yChanged) continue;
        setNodes((curr) =>
          curr.map((n) =>
            n.id === groupId
              ? {
                  ...n,
                  position: { x: fit.x, y: fit.y },
                  width: fit.width,
                  height: fit.height,
                  data: {
                    ...n.data,
                    canvasNode: {
                      ...n.data.canvasNode,
                      x: fit.x,
                      y: fit.y,
                      width: fit.width,
                      height: fit.height,
                    },
                  },
                }
              : n
          )
        );
        literatureCanvasApi
          .updateNode(canvasId, groupId, {
            x: fit.x,
            y: fit.y,
            width: fit.width,
            height: fit.height,
          })
          .then((updated) => {
            setNodes((curr) =>
              curr.map((n) =>
                n.id === groupId
                  ? { ...n, data: { ...n.data, canvasNode: updated } }
                  : n
              )
            );
            setLastSavedAt(Date.now());
          })
          .catch((err) => console.warn('Group auto-fit save failed:', err));
      }
    },
    [canvasId, setNodes]
  );

  // ---- Keep group z-index below its children ----
  const adjustGroupZIndexes = useCallback(() => {
    if (!canvasId) return;
    const currentNodes = nodesRef.current;
    const groupNodes = currentNodes.filter(isTrueGroupNode);
    for (const group of groupNodes) {
      const childIds = getGroupChildIds(group);
      const children = currentNodes.filter((n) => childIds.includes(n.id));
      if (children.length === 0) continue;
      const desiredZ = ensureGroupBelowChildren(group, children);
      if ((group.zIndex ?? 0) === desiredZ) continue;
      setNodes((curr) =>
        curr.map((n) =>
          n.id === group.id ? { ...n, zIndex: desiredZ } : n
        )
      );
    }
  }, [canvasId, setNodes]);

  // ---- Drag stop: PATCH x/y (only on dragging === false change) ----
  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasFlowNode>[]) => {
      const childMoves: Array<{ id: string; x: number; y: number }> = [];
      const stopDragIds: string[] = [];
      const isRemove = (id: string) =>
        changes.some((ch) => ch.type === 'remove' && 'id' in ch && ch.id === id);

      // First pass: compute deltas from the position changes for true_groups.
      // When a true_group is dragged, its children need to follow by the same
      // delta. We collect the deltas here so the next pass can apply them.
      const groupDeltas = new Map<string, { dx: number; dy: number }>();
      for (const ch of changes) {
        if (ch.type !== 'position' || !ch.position) continue;
        const prev = (nodesRef.current as CanvasFlowNode[]).find((n) => n.id === ch.id);
        if (!prev || !isTrueGroupNode(prev)) continue;
        const dx = ch.position.x - prev.position.x;
        const dy = ch.position.y - prev.position.y;
        if (dx === 0 && dy === 0) continue;
        groupDeltas.set(ch.id, { dx, dy });
      }

      setNodes((curr) => {
        const changedIds = new Set(
          changes.flatMap((change) => ('id' in change ? [change.id] : []))
        );

        // Build a child-move map: childId -> { dx, dy } from any group delta
        // that includes the child in its child_node_ids.
        const childMove = new Map<string, { dx: number; dy: number }>();
        for (const node of curr) {
          if (node.type === 'group' || changedIds.has(node.id)) continue;
          for (const [groupId, delta] of groupDeltas) {
            const group = curr.find((n) => n.id === groupId);
            if (!group) continue;
            if (getGroupChildIds(group).includes(node.id)) {
              childMove.set(node.id, delta);
              break;
            }
          }
        }

        // Apply changes via React Flow's reducer, then build an immutable
        // result so that moved children get new object references (so
        // React Flow's store notices and re-renders them).
        const next = applyNodeChanges(changes, curr);
        return next.map((node) => {
          const delta = childMove.get(node.id);
          if (!delta) return node;
          const newX = node.position.x + delta.dx;
          const newY = node.position.y + delta.dy;
          const dragChange = changes.find(
            (ch) =>
              ch.type === 'position' &&
              'id' in ch &&
              ch.id === node.id &&
              (ch as any).dragging === false
          );
          if (dragChange && (dragChange as any).position) {
            childMoves.push({
              id: node.id,
              x: (dragChange as any).position.x,
              y: (dragChange as any).position.y,
            });
          } else {
            childMoves.push({ id: node.id, x: newX, y: newY });
          }
          return {
            ...node,
            position: { x: newX, y: newY },
            data: {
              ...node.data,
              canvasNode: {
                ...node.data.canvasNode,
                x: newX,
                y: newY,
              },
            },
          };
        });
      });

      // Collect ids that finished dragging (for membership refit/z-index)
      for (const ch of changes) {
        if (ch.type === 'position' && ch.dragging === false && ch.position) {
          stopDragIds.push(ch.id);
        }
      }

      if (!canvasId) return;
      for (const ch of changes) {
        if (ch.type === 'position' && ch.dragging === false && ch.position) {
          literatureCanvasApi
            .updateNode(canvasId, ch.id, { x: ch.position.x, y: ch.position.y })
            .then(() => setLastSavedAt(Date.now()))
            .catch((err) => console.warn('Node move save failed:', err));
        } else if (ch.type === 'remove') {
          setEdges((curr) => curr.filter((edge) => edge.source !== ch.id && edge.target !== ch.id));
          literatureCanvasApi
            .deleteNode(canvasId, ch.id)
            .then(() => setLastSavedAt(Date.now()))
            .catch((err) => console.warn('Node delete save failed:', err));
        }
      }
      for (const child of childMoves) {
        literatureCanvasApi
          .updateNode(canvasId, child.id, { x: child.x, y: child.y })
          .then(() => setLastSavedAt(Date.now()))
          .catch((err) => console.warn('Grouped node move save failed:', err));
      }

      if (stopDragIds.length > 0) {
        Promise.resolve().then(() => {
          syncGroupMembership(stopDragIds, isRemove);
          refitGroupsContaining(stopDragIds);
          adjustGroupZIndexes();
        });
      }
    },
    [canvasId, setEdges, setNodes]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<CanvasFlowEdge>[]) => {
      onEdgesChange(changes);
      if (!canvasId) return;
      for (const ch of changes) {
        if (ch.type === 'remove') {
          literatureCanvasApi
            .deleteEdge(canvasId, ch.id)
            .then(() => setLastSavedAt(Date.now()))
            .catch((err) => console.warn('Edge delete save failed:', err));
        }
      }
    },
    [canvasId, onEdgesChange]
  );

  // ---- Content persistence (debounced 600 ms) ----
  const handleContentPatch = useCallback(
    (nodeId: string, patch: Record<string, any>) => {
      if (!canvasId) return;
      setNodes((curr) =>
        curr.map((node) => {
          if (node.id !== nodeId) return node;
          const prev = (node.data.canvasNode.content_json as Record<string, any>) || {};
          return {
            ...node,
            data: {
              ...node.data,
              canvasNode: {
                ...node.data.canvasNode,
                content_json: { ...prev, ...patch },
              },
            },
          };
        })
      );
      if (contentBuffers.current[nodeId]) clearTimeout(contentBuffers.current[nodeId]);
      contentBuffers.current[nodeId] = setTimeout(() => {
        const node = nodesRef.current.find((n) => n.id === nodeId);
        const nextContent = (node?.data.canvasNode.content_json as Record<string, any>) || {};
        literatureCanvasApi
          .updateNode(canvasId, nodeId, { content_json: nextContent })
          .then((updated) => {
            setNodes((curr) =>
              curr.map((item) =>
                item.id === nodeId
                  ? { ...item, data: { ...item.data, canvasNode: updated } }
                  : item
              )
            );
            setLastSavedAt(Date.now());
          })
          .catch((err) => console.warn('Content save failed:', err))
          .finally(() => setSaving(false));
      }, CONTENT_DEBOUNCE_MS);
      setSaving(true);
    },
    [canvasId, setNodes]
  );

  const handleContentChange = useCallback(
    (nodeId: string, text: string) => {
      handleContentPatch(nodeId, { text });
    },
    [handleContentPatch]
  );

  const handleStylePatch = useCallback(
    (nodeId: string, patch: Record<string, any>) => {
      if (!canvasId) return;
      let nextStyle: Record<string, any> = {};
      setNodes((curr) =>
        curr.map((node) => {
          if (node.id !== nodeId) return node;
          const prev = (node.data.canvasNode.style_json as Record<string, any>) || {};
          nextStyle = { ...prev, ...patch };
          return {
            ...node,
            data: {
              ...node.data,
              canvasNode: {
                ...node.data.canvasNode,
                style_json: nextStyle,
              },
            },
          };
        })
      );
      setSaving(true);
      literatureCanvasApi
        .updateNode(canvasId, nodeId, { style_json: nextStyle })
        .then((updated) => {
          setNodes((curr) =>
            curr.map((node) =>
              node.id === nodeId
                ? { ...node, data: { ...node.data, canvasNode: updated } }
                : node
            )
          );
          setLastSavedAt(Date.now());
        })
        .catch((err) => console.warn('Style save failed:', err))
        .finally(() => setSaving(false));
    },
    [canvasId, setNodes]
  );

  const handleResizeNode = useCallback(
    (nodeId: string, width: number, height: number) => {
      if (!canvasId) return;
      const nextWidth = Math.max(80, Math.round(width));
      const nextHeight = Math.max(60, Math.round(height));
      setNodes((curr) =>
        curr.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                width: nextWidth,
                height: nextHeight,
                data: {
                  ...node.data,
                  canvasNode: {
                    ...node.data.canvasNode,
                    width: nextWidth,
                    height: nextHeight,
                  },
                },
              }
            : node
        )
      );
      literatureCanvasApi
        .updateNode(canvasId, nodeId, { width: nextWidth, height: nextHeight })
        .then((updated) => {
          setNodes((curr) =>
            curr.map((node) =>
              node.id === nodeId
                ? {
                    ...node,
                    width: updated.width,
                    height: updated.height,
                    data: { ...node.data, canvasNode: updated },
                  }
                : node
            )
          );
          setLastSavedAt(Date.now());
        })
        .catch((err) => console.warn('Node resize save failed:', err));
      Promise.resolve().then(() => {
        refitGroupsContaining([nodeId]);
        adjustGroupZIndexes();
      });
    },
    [canvasId, setNodes]
  );

  // ---- Add node ----
  const handleAddNode = useCallback(
    async (nodeType: AddableNodeType, position?: { x: number; y: number }) => {
      if (!canvasId) return;
      try {
        const width = nodeType === 'question' ? 320 : nodeType === 'shape' ? 220 : 240;
        const height = nodeType === 'question' ? 220 : nodeType === 'shape' ? 140 : 140;
        const pos = position ?? getDefaultNodePosition(width);
        const created = await literatureCanvasApi.createNode(canvasId, {
          node_type: nodeType,
          x: pos.x,
          y: pos.y,
          width,
          height,
          content_json: nodeType === 'question'
            ? { prompt: '', text: '', sources: [] }
            : nodeType === 'shape'
              ? { label: 'Text' }
              : { text: '' },
          style_json: nodeType === 'shape'
            ? { shape: 'rounded', fill: '#F8FAFC', stroke: '#7AA68A' }
            : undefined,
        });
        const flowNode: CanvasFlowNode = {
          id: created.id,
          type: nodeType,
          position: { x: created.x, y: created.y },
          width: created.width,
          height: created.height,
          data: {
            canvasNode: created,
            paper: null,
            actions: {
              onContentChange: (nodeId, text) => handleContentChange(nodeId, text),
              onContentPatch: (nodeId, patch) => handleContentPatch(nodeId, patch),
              onStylePatch: (nodeId, patch) => handleStylePatch(nodeId, patch),
              onResize: (nodeId, width, height) => handleResizeNode(nodeId, width, height),
              onDelete: (nodeId) => handleDeleteNode(nodeId),
              onOpenPaper: (paper) => setOpenPaper(paper),
            },
          },
        };
        setNodes((curr) => [...curr, flowNode]);
        setLastSavedAt(Date.now());
        setCenter(created.x + created.width / 2, created.y + created.height / 2, {
          zoom: getViewport().zoom,
          duration: 180,
        });
      } catch (err) {
        console.warn('Add node failed:', err);
      }
    },
    // handleDeleteNode is declared later; these action closures are invoked after render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvasId, getDefaultNodePosition, getViewport, handleContentChange, handleContentPatch, handleResizeNode, handleStylePatch, setCenter, setNodes]
  );

  // ---- Add a true group frame ----
  const handleAddGroup = useCallback(async (position?: { x: number; y: number }, childNodeIds: string[] = []) => {
    if (!canvasId) return;
    try {
      const childNodes = nodesRef.current.filter((node) => childNodeIds.includes(node.id) && node.type !== 'group');
      const bounds = getBoundsForNodes(childNodes);
      const pos = bounds
        ? { x: bounds.minX - 28, y: bounds.minY - 44 }
        : position ?? getDefaultNodePosition(360);
      const width = bounds ? Math.max(260, bounds.width + 56) : 360;
      const height = bounds ? Math.max(180, bounds.height + 72) : 240;
      const created = await literatureCanvasApi.createNode(canvasId, {
        node_type: 'group',
        x: pos.x,
        y: pos.y,
        width,
        height,
        content_json: {
          label: 'Group',
          child_node_ids: childNodes.map((node) => node.id),
          group_mode: 'true_group',
        },
      });
      const flowNode: CanvasFlowNode = {
        id: created.id,
        type: 'group',
        position: { x: created.x, y: created.y },
        width: created.width,
        height: created.height,
        data: {
          canvasNode: created,
          paper: null,
          actions: {
            onContentChange: (nodeId, text) => handleContentChange(nodeId, text),
            onContentPatch: (nodeId, patch) => handleContentPatch(nodeId, patch),
            onStylePatch: (nodeId, patch) => handleStylePatch(nodeId, patch),
            onResize: (nodeId, width, height) => handleResizeNode(nodeId, width, height),
            onDelete: (nodeId) => handleDeleteNode(nodeId),
            onOpenPaper: (paper) => setOpenPaper(paper),
          },
        },
      };
      setNodes((curr) => [...curr, flowNode]);
      setLastSavedAt(Date.now());
      setCenter(created.x + created.width / 2, created.y + created.height / 2, {
        zoom: getViewport().zoom,
        duration: 180,
      });
    } catch (err) {
      console.warn('Add group failed:', err);
    }
    // handleDeleteNode is declared later; these action closures are invoked after render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId, getDefaultNodePosition, getViewport, handleContentChange, handleContentPatch, handleResizeNode, handleStylePatch, setCenter, setNodes]);

  // ---- Import papers into canvas (server creates paper nodes in a grid) ----
  const handleImportPapers = useCallback(
    async (paperIds: string[], origin?: { x: number; y: number }) => {
      if (!canvasId) return;
      try {
        const res = await literatureCanvasApi.importPapers(canvasId, paperIds, origin);
        // Append created nodes to local state. Read papers from a ref so we
        // resolve papers even when this runs immediately after the caller
        // updated papersById (the closure capture would otherwise be stale
        // and the new nodes would render as "Missing paper").
        const resolvedPapers = papersByIdRef.current;
        setNodes((curr) => {
          const existing = new Set(curr.map((n) => n.id));
          const additions: CanvasFlowNode[] = res.created
            .filter((n) => !existing.has(n.id))
            .map((n) => ({
              id: n.id,
              type: n.node_type,
              position: { x: n.x, y: n.y },
              width: n.width,
              height: n.height,
              data: {
                canvasNode: n,
                paper: n.ref_type === 'paper' && n.ref_id ? resolvedPapers[n.ref_id] ?? null : null,
                actions: {
                  onContentChange: (nodeId, text) => handleContentChange(nodeId, text),
                  onContentPatch: (nodeId, patch) => handleContentPatch(nodeId, patch),
                  onStylePatch: (nodeId, patch) => handleStylePatch(nodeId, patch),
                  onResize: (nodeId, width, height) => handleResizeNode(nodeId, width, height),
                  onDelete: (nodeId) => handleDeleteNode(nodeId),
                  onOpenPaper: (paper) => setOpenPaper(paper),
                },
              },
            }));
          return [...curr, ...additions];
        });
        setLastSavedAt(Date.now());
      } catch (err) {
        console.warn('Import papers failed:', err);
      }
    },
    // handleDeleteNode is declared later; these action closures are invoked after render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvasId, handleContentChange, handleContentPatch, handleResizeNode, handleStylePatch, setNodes]
  );

  // ---- Delete node (and connected edges) ----
  const handleDeleteNode = useCallback(
    async (nodeId: string) => {
      if (!canvasId) return;
      // Optimistic UI update
      setNodes((curr) => curr.filter((n) => n.id !== nodeId));
      setEdges((curr) => curr.filter((e) => e.source !== nodeId && e.target !== nodeId));
      try {
        await literatureCanvasApi.deleteNode(canvasId, nodeId);
        setLastSavedAt(Date.now());
      } catch (err) {
        console.warn('Delete node failed:', err);
      }
    },
    [canvasId, setNodes, setEdges]
  );

  // ---- Delete edge ----
  const handleDeleteEdge = useCallback(
    async (edgeId: string) => {
      if (!canvasId) return;
      setEdges((curr) => curr.filter((e) => e.id !== edgeId));
      try {
        await literatureCanvasApi.deleteEdge(canvasId, edgeId);
        setLastSavedAt(Date.now());
      } catch (err) {
        console.warn('Delete edge failed:', err);
      }
    },
    [canvasId, setEdges]
  );

  // ---- Create edge (paper-to-paper relations sync to paper_relations) ----
  const handleCreateEdge = useCallback(
    async (params: {
      sourceNodeId: string;
      targetNodeId: string;
      kind: RelationKind;
    }) => {
      if (!canvasId) return;
      try {
        const payload = kindToEdgePayload(params.kind);
        const created = await literatureCanvasApi.createEdge(canvasId, {
          source_node_id: params.sourceNodeId,
          target_node_id: params.targetNodeId,
          edge_type: payload.edge_type,
          relation_type: payload.relation_type as any,
          label: payload.label ?? undefined,
          content_json: payload.content_json,
          style_json: payload.style_json,
        });
        const flowEdge: CanvasFlowEdge = {
          id: created.id,
          source: created.source_node_id,
          target: created.target_node_id,
          label: created.label || params.kind.label,
          data: {
            canvasEdge: created,
            actions: {
              onDelete: (id) => handleDeleteEdge(id),
              onUpdateKind: (id, next) => handleUpdateEdge(id, next),
            },
          },
        };
        setEdges((curr) => [...curr, flowEdge]);
        setLastSavedAt(Date.now());
      } catch (err) {
        console.warn('Create edge failed:', err);
      }
    },
    [canvasId, setEdges, handleDeleteEdge]
  );

  // ---- Update edge (style / label / relation) ----
  const handleUpdateEdge = useCallback(
    async (edgeId: string, kind: RelationKind) => {
      if (!canvasId) return;
      const payload = kindToEdgePayload(kind);
      // Optimistic local update
      setEdges((curr) =>
        curr.map((edge) => {
          if (edge.id !== edgeId) return edge;
          const prevEdge = edge.data?.canvasEdge;
          if (!prevEdge) return edge;
          const merged: LiteratureCanvasEdge = {
            ...prevEdge,
            edge_type: payload.edge_type,
            relation_type: payload.relation_type as LiteratureCanvasEdge['relation_type'],
            label: payload.label ?? kind.label,
            content_json: payload.content_json,
            style_json: payload.style_json,
          };
          return {
            ...edge,
            label: payload.label ?? kind.label,
            data: {
              canvasEdge: merged,
              actions: edge.data!.actions,
            },
          };
        })
      );
      try {
        const updated = await literatureCanvasApi.updateEdge(canvasId, edgeId, {
          label: payload.label ?? undefined,
          content_json: payload.content_json,
          style_json: payload.style_json,
        });
        setEdges((curr) =>
          curr.map((edge) => {
            if (edge.id !== edgeId) return edge;
            return {
              ...edge,
              data: {
                canvasEdge: updated,
                actions: edge.data!.actions,
              },
            };
          })
        );
        setLastSavedAt(Date.now());
      } catch (err) {
        console.warn('Update edge failed:', err);
      }
    },
    [canvasId, setEdges]
  );

  // ---- Ungroup: delete the group node, keep its children ----
  const handleUngroup = useCallback(
    async (groupId: string) => {
      if (!canvasId) return;
      const group = nodesRef.current.find((n) => n.id === groupId);
      const childIds = group ? getGroupChildIds(group) : [];
      setNodes((curr) => curr.filter((n) => n.id !== groupId));
      setEdges((curr) => curr.filter((e) => e.source !== groupId && e.target !== groupId));
      try {
        await literatureCanvasApi.deleteNode(canvasId, groupId);
        setLastSavedAt(Date.now());
      } catch (err) {
        console.warn('Ungroup failed:', err);
      }
      // Also clear child_node_ids from any children that were in another group
      // (none, by invariant, but be defensive).
      void childIds;
    },
    [canvasId, setEdges, setNodes]
  );

  // ---- Fit view ----
  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2, duration: 250 });
  }, [fitView]);

  const handleFocusNode = useCallback(
    (nodeId: string) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (!node) return;
      setCenter(
        node.position.x + (node.width || 260) / 2,
        node.position.y + (node.height || 160) / 2,
        { zoom: Math.max(getViewport().zoom, 0.8), duration: 260 }
      );
      setNodes((curr) =>
        curr.map((item) => ({
          ...item,
          selected: item.id === nodeId,
        }))
      );
    },
    [getViewport, setCenter, setNodes]
  );

  const handleFocusScene = useCallback(
    (scene: LiteratureCanvasScene) => {
      const vp = scene.viewport_json;
      if (
        typeof vp?.x !== 'number' ||
        typeof vp?.y !== 'number' ||
        typeof vp?.zoom !== 'number'
      ) {
        return;
      }
      setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom }, { duration: 260 });
    },
    [setViewport]
  );

  const handleCreateScene = useCallback(
    async (name: string) => {
      if (!canvasId) return null;
      try {
        const created = await literatureCanvasApi.createScene(canvasId, {
          name,
          viewport: getViewport(),
        });
        setScenes((curr) => [...curr, created].sort((a, b) => a.sort_order - b.sort_order));
        setLastSavedAt(Date.now());
        return created;
      } catch (err) {
        console.warn('Create scene failed:', err);
        return null;
      }
    },
    [canvasId, getViewport]
  );

  const handleUpdateScene = useCallback(
    async (sceneId: string, data: { name?: string; captureCurrentView?: boolean }) => {
      if (!canvasId) return null;
      try {
        const updated = await literatureCanvasApi.updateScene(canvasId, sceneId, {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.captureCurrentView ? { viewport: getViewport() } : {}),
        });
        setScenes((curr) =>
          curr
            .map((scene) => (scene.id === sceneId ? updated : scene))
            .sort((a, b) => a.sort_order - b.sort_order)
        );
        setLastSavedAt(Date.now());
        return updated;
      } catch (err) {
        console.warn('Update scene failed:', err);
        return null;
      }
    },
    [canvasId, getViewport]
  );

  const handleDeleteScene = useCallback(
    async (sceneId: string) => {
      if (!canvasId) return;
      setScenes((curr) => curr.filter((scene) => scene.id !== sceneId));
      try {
        await literatureCanvasApi.deleteScene(canvasId, sceneId);
        setLastSavedAt(Date.now());
      } catch (err) {
        console.warn('Delete scene failed:', err);
      }
    },
    [canvasId]
  );

  // ---- Run AI summary on a paper ----
  const handleRunSummary = useCallback(
    async (paperId: string) => {
      const paper = papersById[paperId];
      if (!paper) {
        console.warn('Paper not found for runSummary', paperId);
        return;
      }
      // Optimistic UI: mark processing
      setPapersById((prev) => ({
        ...prev,
        [paperId]: { ...prev[paperId], processing_status: 'processing' },
      }));
      try {
        // Lazy imports to avoid pulling these modules in for users who never use the canvas.
        const { createAIExtractionService } = await import('../../../lib/literature/ai-extraction');
        const { smartExtract } = await import('../../../lib/literature/multimodal-extraction');
        const { literaturePapersApi } = await import('../../../lib/literature-api');
        let extractedData: any = null;
        const useVision = !paper.full_text || paper.full_text.length < 200;
        if (useVision && paper.storage_key) {
          const pdfUrl = `/uploads/${paper.storage_key}`;
          extractedData = await smartExtract(pdfUrl, paper.full_text, undefined, undefined);
        } else if (paper.full_text) {
          const service = createAIExtractionService();
          const res = await service.extractWithFallback(paper.full_text, 'brief');
          extractedData = res.extractedData;
        }
        if (extractedData) {
          await literaturePapersApi.update(paperId, {
            extracted_data: extractedData,
            processing_status: 'completed',
          });
          setPapersById((prev) => ({
            ...prev,
            [paperId]: {
              ...prev[paperId],
              extracted_data: extractedData,
              processing_status: 'completed',
            },
          }));
        }
      } catch (err) {
        console.warn('runSummary failed', err);
        try {
          const { literaturePapersApi } = await import('../../../lib/literature-api');
          await literaturePapersApi.update(paperId, {
            error_message: err instanceof Error ? err.message : 'Extraction failed',
            processing_status: 'error',
          });
        } catch (_) {
          /* swallow */
        }
        setPapersById((prev) => ({
          ...prev,
          [paperId]: { ...prev[paperId], processing_status: 'error' },
        }));
      }
    },
    [papersById]
  );

  // ---- Create a note from a paper's summary, placed near the paper node ----
  const handleCreateSummaryNote = useCallback(
    async (paperId: string) => {
      if (!canvasId) return;
      const paper = papersById[paperId];
      const paperNode = nodesRef.current.find(
        (n) => n.data.canvasNode.ref_type === 'paper' && n.data.canvasNode.ref_id === paperId
      );
      const baseX = paperNode ? paperNode.position.x + 360 : 100;
      const baseY = paperNode ? paperNode.position.y : 100;
      const extracted = paper?.extracted_data;
      const lines: string[] = [];
      if (paper?.title) lines.push(`# ${paper.title}`);
      if (extracted) {
        for (const field of [
          'background',
          'theory',
          'methodology',
          'measures',
          'results',
          'implications',
          'limitations',
        ] as const) {
          const v = (extracted as any)[field];
          if (v) lines.push(`**${field[0].toUpperCase() + field.slice(1)}:** ${v}`);
        }
      }
      const text = lines.join('\n\n');
      try {
        const created = await literatureCanvasApi.createNode(canvasId, {
          node_type: 'note',
          x: baseX,
          y: baseY,
          width: 320,
          height: 200,
          content_json: { text, source_paper_id: paperId },
        });
        const flowNode: CanvasFlowNode = {
          id: created.id,
          type: 'note',
          position: { x: created.x, y: created.y },
          width: created.width,
          height: created.height,
          data: {
            canvasNode: created,
            paper: null,
            actions: {
              onContentChange: (nodeId, t) => handleContentChange(nodeId, t),
              onContentPatch: (nodeId, patch) => handleContentPatch(nodeId, patch),
              onStylePatch: (nodeId, patch) => handleStylePatch(nodeId, patch),
              onResize: (nodeId, width, height) => handleResizeNode(nodeId, width, height),
              onDelete: (nodeId) => handleDeleteNode(nodeId),
              onOpenPaper: (p) => setOpenPaper(p),
            },
          },
        };
        setNodes((curr) => [...curr, flowNode]);
        setLastSavedAt(Date.now());
      } catch (err) {
        console.warn('createSummaryNote failed', err);
      }
    },
    [canvasId, papersById, handleContentChange, handleContentPatch, handleDeleteNode, handleResizeNode, handleStylePatch, setNodes]
  );

  // ---- Create a question/AI node from a prompt + answer, placed at position ----
  const handleInsertAIAnswer = useCallback(
    async (params: {
      prompt: string;
      answer: string;
      sources?: string[];
      position?: { x: number; y: number };
    }) => {
      if (!canvasId) return;
      const position = params.position ?? { x: 200, y: 200 };
      try {
        const created = await literatureCanvasApi.createNode(canvasId, {
          node_type: 'question',
          x: position.x,
          y: position.y,
          width: 320,
          height: 220,
          content_json: {
            prompt: params.prompt,
            text: params.answer,
            sources: params.sources ?? [],
          },
        });
        const flowNode: CanvasFlowNode = {
          id: created.id,
          type: 'question',
          position: { x: created.x, y: created.y },
          width: created.width,
          height: created.height,
          data: {
            canvasNode: created,
            paper: null,
            actions: {
              onContentChange: (nodeId, t) => handleContentChange(nodeId, t),
              onContentPatch: (nodeId, patch) => handleContentPatch(nodeId, patch),
              onStylePatch: (nodeId, patch) => handleStylePatch(nodeId, patch),
              onResize: (nodeId, width, height) => handleResizeNode(nodeId, width, height),
              onDelete: (nodeId) => handleDeleteNode(nodeId),
              onOpenPaper: (p) => setOpenPaper(p),
            },
          },
        };
        setNodes((curr) => [...curr, flowNode]);
        setLastSavedAt(Date.now());
      } catch (err) {
        console.warn('Insert AI answer failed', err);
      }
    },
    [canvasId, handleContentChange, handleContentPatch, handleDeleteNode, handleResizeNode, handleStylePatch, setNodes]
  );

  return {
    canvasId,
    initialViewport,
    papersById,
    setPapersById,
    scenes,
    nodes,
    edges,
    onNodesChange: handleNodesChange,
    onEdgesChange: handleEdgesChange as (changes: EdgeChange[]) => void,
    onViewportChange,
    handleAddNode,
    handleAddGroup,
    handleImportPapers,
    handleDeleteNode,
    handleDeleteEdge,
    handleCreateEdge,
    handleUpdateEdge,
    handleUngroup,
    handleContentChange,
    handleFocusNode,
    handleFocusScene,
    handleFitView,
    handleCreateScene,
    handleUpdateScene,
    handleDeleteScene,
    handleRunSummary,
    handleCreateSummaryNote,
    handleInsertAIAnswer,
    openPaper,
    setOpenPaper,
    saving,
    lastSavedAt,
  };
}
