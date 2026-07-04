import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
  LiteraturePaper,
} from '../../../types';
import type { CanvasFlowNode, CanvasFlowEdge } from './canvas-types';
import { debounce } from './canvas-utils';

const VIEWPORT_DEBOUNCE_MS = 1000;
const CONTENT_DEBOUNCE_MS = 600;

type AddableNodeType = 'text' | 'note' | 'group';

export function useLiteratureCanvas(projectId: string) {
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [papersById, setPapersById] = useState<Record<string, LiteraturePaper>>({});
  const [initialViewport, setInitialViewport] = useState<Viewport | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>();
  const [openPaper, setOpenPaper] = useState<LiteraturePaper | null>(null);
  const { fitView } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasFlowEdge>([]);

  // Per-node pending content buffers (so debounced PATCHes don't lose typing)
  const contentBuffers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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

        // Build fresh action closures that read the latest nodesRef / canvasId
        const buildNodeActions = () => ({
          onContentChange: (nodeId: string, text: string) => handleContentChange(nodeId, text),
          onContentPatch: (nodeId: string, patch: Record<string, any>) => handleContentPatch(nodeId, patch),
          onDelete: (nodeId: string) => handleDeleteNode(nodeId),
          onOpenPaper: (paper: LiteraturePaper) => setOpenPaper(paper),
        });
        const buildEdgeActions = () => ({
          onDelete: (edgeId: string) => handleDeleteEdge(edgeId),
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

  // ---- Drag stop: PATCH x/y (only on dragging === false change) ----
  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasFlowNode>[]) => {
      onNodesChange(changes);
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
    },
    [canvasId, onNodesChange, setEdges]
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

  // ---- Add node ----
  const handleAddNode = useCallback(
    async (nodeType: AddableNodeType) => {
      if (!canvasId) return;
      try {
        const created = await literatureCanvasApi.createNode(canvasId, {
          node_type: nodeType,
          x: 80,
          y: 80,
          width: 240,
          height: 140,
          content_json: { text: '' },
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
              onDelete: (nodeId) => handleDeleteNode(nodeId),
              onOpenPaper: (paper) => setOpenPaper(paper),
            },
          },
        };
        setNodes((curr) => [...curr, flowNode]);
        setLastSavedAt(Date.now());
      } catch (err) {
        console.warn('Add node failed:', err);
      }
    },
    // handleContentChange / handleDeleteNode captured via closure on next render; safe enough for toolbar action
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvasId]
  );

  // ---- Add a group (visual frame) ----
  const handleAddGroup = useCallback(async () => {
    if (!canvasId) return;
    try {
      const created = await literatureCanvasApi.createNode(canvasId, {
        node_type: 'group',
        x: 60,
        y: 60,
        width: 360,
        height: 240,
        content_json: { label: 'Group' },
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
            onDelete: (nodeId) => handleDeleteNode(nodeId),
            onOpenPaper: (paper) => setOpenPaper(paper),
          },
        },
      };
      setNodes((curr) => [...curr, flowNode]);
      setLastSavedAt(Date.now());
    } catch (err) {
      console.warn('Add group failed:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvasId]
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
      edgeType: 'canvas' | 'paper_relation';
      relationType?: 'cites' | 'extends' | 'contradicts' | 'supports' | 'related' | 'method' | 'dataset';
    }) => {
      if (!canvasId) return;
      try {
        const created = await literatureCanvasApi.createEdge(canvasId, {
          source_node_id: params.sourceNodeId,
          target_node_id: params.targetNodeId,
          edge_type: params.edgeType,
          relation_type: params.relationType,
        });
        const flowEdge: CanvasFlowEdge = {
          id: created.id,
          source: created.source_node_id,
          target: created.target_node_id,
          label: created.label || undefined,
          data: {
            canvasEdge: created,
            actions: { onDelete: (id) => handleDeleteEdge(id) },
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

  // ---- Fit view ----
  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2, duration: 250 });
  }, [fitView]);

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
    [canvasId, papersById, handleContentChange, handleContentPatch, handleDeleteNode]
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
    [canvasId, handleContentChange, handleContentPatch, handleDeleteNode]
  );

  return {
    canvasId,
    initialViewport,
    papersById,
    setPapersById,
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
    handleContentChange,
    handleFitView,
    handleRunSummary,
    handleCreateSummaryNote,
    handleInsertAIAnswer,
    openPaper,
    setOpenPaper,
    saving,
    lastSavedAt,
  };
}
