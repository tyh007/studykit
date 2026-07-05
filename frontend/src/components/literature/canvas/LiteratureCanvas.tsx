import React, { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  useReactFlow,
  type DefaultEdgeOptions,
  type Viewport,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './literature-canvas.css';
import { useLiteratureCanvas } from './useLiteratureCanvas';
import CanvasToolbar from './CanvasToolbar';
import CanvasStatusBar from './CanvasStatusBar';
import CanvasMinimapCluster from './CanvasMinimapCluster';
import TextNode from './TextNode';
import NoteNode from './NoteNode';
import PaperNode from './PaperNode';
import PaperPreviewDrawer from './PaperPreviewDrawer';
import RelationEdge from './RelationEdge';
import RelationTypeMenu, { type RelationType } from './RelationTypeMenu';
import QuestionNode from './QuestionNode';
import CanvasAIAssistant from './CanvasAIAssistant';
import GroupNode from './GroupNode';
import { SparkIcon } from '../../ui/Icons';
import { uploadPDFFile, validatePDFFiles } from '../../../lib/literature-pdf-upload';
import type { CanvasFlowNode, CanvasFlowEdge } from './canvas-types';
import type { LiteraturePaper } from '../../../types';

interface Props {
  projectId: string;
}

const defaultEdgeOptions: DefaultEdgeOptions = {
  type: 'relation',
  style: { stroke: '#9ca3af', strokeWidth: 1.5 },
};

function LiteratureCanvasInner({ projectId }: Props) {
  const {
    canvasId,
    initialViewport,
    nodes,
    edges,
    setPapersById,
    onNodesChange,
    onEdgesChange,
    onViewportChange,
    handleAddNode,
    handleAddGroup,
    handleImportPapers,
    handleFitView,
    handleRunSummary,
    handleCreateSummaryNote,
    handleCreateEdge,
    handleInsertAIAnswer,
    saving,
    lastSavedAt,
    openPaper,
    setOpenPaper,
  } = useLiteratureCanvas(projectId);

  const { screenToFlowPosition } = useReactFlow();
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [pendingConnection, setPendingConnection] = useState<{
    sourceNodeId: string;
    targetNodeId: string;
    pos: { x: number; y: number };
  } | null>(null);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [aiAssistantPrompt, setAiAssistantPrompt] = useState('');
  const [focusedPaperId, setFocusedPaperId] = useState<string | null>(null);

  const isReady = !!canvasId;
  const proOptions = useMemo(() => ({ hideAttribution: true }), []);
  const fitViewOnLoad = !initialViewport;

  // Register node types here so we can pass per-canvas callbacks down.
  const nodeTypes = useMemo(
    () => ({
      text: TextNode,
      note: NoteNode,
      group: GroupNode,
      paper: (props: any) => (
        <PaperNode
          {...props}
          onOpenPaper={(p) => setOpenPaper(p)}
          onRunSummary={(id) => handleRunSummary(id)}
          onCreateSummaryNote={(id) => handleCreateSummaryNote(id)}
          onAskPaper={(id) => {
            setFocusedPaperId(id);
            setAiAssistantOpen(true);
          }}
        />
      ),
      question: QuestionNode,
    }),
    [setOpenPaper, handleRunSummary, handleCreateSummaryNote]
  );

  // Compute selected paper IDs (for the AI assistant).
  const selectedPaperIds = useMemo(() => {
    const ids: string[] = [];
    for (const n of nodes) {
      if (
        n.selected &&
        n.type === 'paper' &&
        n.data?.canvasNode?.ref_type === 'paper' &&
        n.data.canvasNode.ref_id
      ) {
        ids.push(n.data.canvasNode.ref_id);
      }
    }
    return ids;
  }, [nodes]);

  const edgeTypes = useMemo(
    () => ({
      relation: RelationEdge,
      default: RelationEdge,
    }),
    []
  );

  const getAIInsertPosition = useCallback((paperId?: string | null) => {
    const anchorPaperId = paperId || focusedPaperId;
    const anchorNode = anchorPaperId
      ? nodes.find((n) => n.data?.canvasNode?.ref_type === 'paper' && n.data.canvasNode.ref_id === anchorPaperId)
      : nodes.find((n) => n.selected);
    if (anchorNode) {
      return {
        x: anchorNode.position.x + (anchorNode.width || 300) + 40,
        y: anchorNode.position.y,
      };
    }
    const wrapper = document.querySelector('.literature-canvas-flow');
    const rect = wrapper?.getBoundingClientRect();
    if (rect) {
      return screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    }
    return { x: 120, y: 120 };
  }, [focusedPaperId, nodes, screenToFlowPosition]);

  const handleConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      // Determine the actual node types involved
      const sourceNode = nodes.find((n) => n.id === conn.source);
      const targetNode = nodes.find((n) => n.id === conn.target);
      if (!sourceNode || !targetNode) return;
      // Position the menu near the midpoint of the connection line
      const midX =
        ((sourceNode.position.x + (sourceNode.width || 200) / 2) +
          (targetNode.position.x + (targetNode.width || 200) / 2)) /
        2;
      const midY =
        ((sourceNode.position.y + (sourceNode.height || 140) / 2) +
          (targetNode.position.y + (targetNode.height || 140) / 2)) /
        2;
      // Place the relation-type menu at the source node's screen position.
      // We read the bounding rect of the source node's DOM element.
      const wrapper = document.querySelector('.literature-canvas-flow');
      const sourceRect = wrapper?.querySelector(
        `[data-id="${conn.source}"]`
      ) as HTMLElement | null;
      const anchorRect = sourceRect?.getBoundingClientRect();
      const sx = anchorRect ? anchorRect.left + anchorRect.width / 2 : midX;
      const sy = anchorRect ? anchorRect.top + anchorRect.height / 2 : midY;

      const bothPaper =
        sourceNode.type === 'paper' && targetNode.type === 'paper';
      if (bothPaper) {
        setPendingConnection({
          sourceNodeId: conn.source,
          targetNodeId: conn.target,
          pos: { x: sx, y: sy },
        });
      } else {
        // Canvas-only edge: create immediately with no relation type
        handleCreateEdge({
          sourceNodeId: conn.source,
          targetNodeId: conn.target,
          edgeType: 'canvas',
        });
      }
    },
    [nodes, handleCreateEdge]
  );

  const handlePickRelation = useCallback(
    (type: RelationType) => {
      if (!pendingConnection) return;
      handleCreateEdge({
        sourceNodeId: pendingConnection.sourceNodeId,
        targetNodeId: pendingConnection.targetNodeId,
        edgeType: 'paper_relation',
        relationType: type,
      });
      setPendingConnection(null);
    },
    [pendingConnection, handleCreateEdge]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      setIsDraggingFiles(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target) {
      setIsDraggingFiles(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingFiles(false);
      if (!canvasId) return;
      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      );
      if (files.length === 0) {
        setUploadStatus('No PDF files in drop.');
        setTimeout(() => setUploadStatus(null), 3000);
        return;
      }
      const { valid, invalid } = validatePDFFiles(files);
      if (invalid.length > 0) {
        setUploadStatus(`Skipped ${invalid.length} invalid file(s).`);
        setTimeout(() => setUploadStatus(null), 3000);
      }
      if (valid.length === 0) return;

      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const newPapers: LiteraturePaper[] = [];
      for (let i = 0; i < valid.length; i++) {
        const file = valid[i];
        setUploadStatus(`Uploading ${file.name} (${i + 1}/${valid.length})…`);
        try {
          const paper = await uploadPDFFile(file, projectId);
          newPapers.push(paper);
        } catch (err) {
          console.warn('Upload failed for', file.name, err);
        }
      }
      if (newPapers.length > 0) {
        // Add the new papers to local cache so the hook can resolve them
        setPapersById((prev) => {
          const next = { ...prev };
          for (const p of newPapers) next[p.id] = p;
          return next;
        });
        // Then create paper nodes at the drop position
        const newPaperIds = newPapers.map((p) => p.id);
        const origin = { x: flowPos.x, y: flowPos.y };
        await handleImportPapers(newPaperIds, origin);
      }
      setUploadStatus(null);
    },
    [canvasId, projectId, screenToFlowPosition, setPapersById, handleImportPapers]
  );

  return (
    <div
      className={`literature-canvas ${isDraggingFiles ? 'is-dragging-files' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <CanvasToolbar
        onAddText={() => handleAddNode('text')}
        onAddNote={() => handleAddNode('note')}
        onAddGroup={handleAddGroup}
        onFitView={handleFitView}
        disabled={!isReady}
      />
      <div className="literature-canvas-flow">
        <ReactFlow<CanvasFlowNode, CanvasFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onMoveEnd={(_event, viewport: Viewport) => onViewportChange(viewport)}
          defaultViewport={initialViewport ?? undefined}
          proOptions={proOptions}
          defaultEdgeOptions={defaultEdgeOptions}
          minZoom={0.1}
          maxZoom={2}
          fitView={fitViewOnLoad}
          deleteKeyCode={['Backspace', 'Delete']}
          selectionOnDrag
          panOnDrag={[1, 2]}
          nodesDraggable
          nodesConnectable
          elementsSelectable
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        >
          <Background gap={20} size={1} />
        </ReactFlow>
        <CanvasMinimapCluster disabled={!isReady} />
        {isDraggingFiles && (
          <div className="literature-canvas-drop-overlay">
            Drop PDF to add as paper card
          </div>
        )}
      </div>
      <CanvasStatusBar
        nodeCount={nodes.length}
        saving={saving}
        lastSavedAt={lastSavedAt}
      />
      {uploadStatus && (
        <div className="literature-canvas-upload-status">{uploadStatus}</div>
      )}
      {pendingConnection && (
        <RelationTypeMenu
          position={pendingConnection.pos}
          onPick={handlePickRelation}
          onCancel={() => setPendingConnection(null)}
        />
      )}
      <button
        className="canvas-ai-assistant-toggle"
        onClick={() => {
          setFocusedPaperId(null);
          setAiAssistantOpen((v) => !v);
        }}
        title="AI assistant"
        aria-label="Open AI assistant"
      >
        <SparkIcon size="md" />
      </button>
      <CanvasAIAssistant
        open={aiAssistantOpen}
        onClose={() => setAiAssistantOpen(false)}
        paperId={focusedPaperId}
        paperIds={selectedPaperIds.length > 0 ? selectedPaperIds : focusedPaperId ? [focusedPaperId] : []}
        prompt={aiAssistantPrompt}
        onPromptChange={setAiAssistantPrompt}
        onSubmitted={(answer, sources) => {
          // Insert the answer as a question node near the center of the viewport
          handleInsertAIAnswer({
            prompt: aiAssistantPrompt,
            answer,
            sources,
            position: getAIInsertPosition(),
          });
          setAiAssistantOpen(false);
        }}
      />
      <PaperPreviewDrawer
        paper={openPaper}
        onClose={() => setOpenPaper(null)}
        onAddAnswerToCanvas={(paper, prompt, answer) => {
          handleInsertAIAnswer({
            prompt,
            answer,
            sources: [paper.title || paper.file_name || paper.id],
            position: getAIInsertPosition(paper.id),
          });
        }}
      />
    </div>
  );
}

export default function LiteratureCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <LiteratureCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
