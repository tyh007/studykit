import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import CanvasSearch from './CanvasSearch';
import CanvasSceneNavigator from './CanvasSceneNavigator';
import SelectionToolbar from './SelectionToolbar';
import TextNode from './TextNode';
import NoteNode from './NoteNode';
import PaperNode from './PaperNode';
import PaperPreviewDrawer from './PaperPreviewDrawer';
import RelationEdge from './RelationEdge';
import RelationTypeMenu, { type RelationType } from './RelationTypeMenu';
import QuestionNode from './QuestionNode';
import CanvasAIAssistant from './CanvasAIAssistant';
import GroupNode from './GroupNode';
import ShapeNode from './ShapeNode';
import { SparkIcon } from '../../ui/Icons';
import { literaturePapersApi } from '../../../lib/literature-api';
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
    scenes,
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
    handleDeleteNode,
    handleInsertAIAnswer,
    handleFocusNode,
    handleFocusScene,
    handleCreateScene,
    handleUpdateScene,
    handleDeleteScene,
    saving,
    lastSavedAt,
    openPaper,
    setOpenPaper,
  } = useLiteratureCanvas(projectId);

  const { screenToFlowPosition, zoomIn, zoomOut } = useReactFlow();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [connectorHint, setConnectorHint] = useState(false);
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

  const getCanvasCenterPosition = useCallback(() => {
    const wrapper = document.querySelector('.literature-canvas-flow');
    const rect = wrapper?.getBoundingClientRect();
    if (rect) {
      return screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    }
    return { x: 120, y: 120 };
  }, [screenToFlowPosition]);

  // Register node types here so we can pass per-canvas callbacks down.
  const nodeTypes = useMemo(
    () => ({
      text: TextNode,
      note: NoteNode,
      group: GroupNode,
      shape: ShapeNode,
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

  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const singleSelectedPaper = useMemo(() => {
    if (selectedNodes.length !== 1 || selectedNodes[0].type !== 'paper') return null;
    return selectedNodes[0].data.paper || null;
  }, [selectedNodes]);

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

  const uploadFilesToCanvas = useCallback(
    async (files: File[], origin: { x: number; y: number }) => {
      if (!canvasId) return;
      const { valid, invalid } = validatePDFFiles(files);
      if (invalid.length > 0) {
        setUploadStatus(`Skipped ${invalid.length} invalid file(s).`);
        setTimeout(() => setUploadStatus(null), 3000);
      }
      if (valid.length === 0) return;

      const newPapers: LiteraturePaper[] = [];
      for (let i = 0; i < valid.length; i++) {
        const file = valid[i];
        setUploadStatus(`Uploading ${file.name} (${i + 1}/${valid.length})...`);
        try {
          const paper = await uploadPDFFile(file, projectId);
          newPapers.push(paper);
        } catch (err) {
          console.warn('Upload failed for', file.name, err);
        }
      }
      if (newPapers.length > 0) {
        setPapersById((prev) => {
          const next = { ...prev };
          for (const p of newPapers) next[p.id] = p;
          return next;
        });
        await handleImportPapers(newPapers.map((p) => p.id), origin);
      }
      setUploadStatus(null);
    },
    [canvasId, projectId, setPapersById, handleImportPapers]
  );

  const handleImportProjectPapers = useCallback(async () => {
    if (!canvasId) return;
    try {
      setUploadStatus('Adding project papers...');
      const papers = (await literaturePapersApi.list(projectId, 'library')) as LiteraturePaper[];
      setPapersById((prev) => {
        const next = { ...prev };
        for (const p of papers) next[p.id] = p;
        return next;
      });
      await handleImportPapers(papers.map((paper) => paper.id), getCanvasCenterPosition());
    } catch (err) {
      console.warn('Import project papers failed:', err);
    } finally {
      setUploadStatus(null);
    }
  }, [canvasId, projectId, setPapersById, handleImportPapers, getCanvasCenterPosition]);

  const handleDeleteSelected = useCallback(() => {
    selectedNodes.forEach((node) => handleDeleteNode(node.id));
  }, [selectedNodes, handleDeleteNode]);

  const handleCreateNoteForSelection = useCallback(() => {
    const paperId =
      selectedNodes.length === 1 &&
      selectedNodes[0].data.canvasNode.ref_type === 'paper'
        ? selectedNodes[0].data.canvasNode.ref_id
        : null;
    if (paperId) {
      handleCreateSummaryNote(paperId);
      return;
    }
    handleAddNode('note', getCanvasCenterPosition());
  }, [selectedNodes, handleCreateSummaryNote, handleAddNode, getCanvasCenterPosition]);

  const handleGroupSelection = useCallback(() => {
    if (selectedNodes.length === 0) {
      handleAddGroup(getCanvasCenterPosition());
      return;
    }
    const minX = Math.min(...selectedNodes.map((node) => node.position.x));
    const minY = Math.min(...selectedNodes.map((node) => node.position.y));
    handleAddGroup({ x: minX - 28, y: minY - 44 });
  }, [selectedNodes, handleAddGroup, getCanvasCenterPosition]);

  const handleConnectorMode = useCallback(() => {
    setConnectorHint(true);
    setTimeout(() => setConnectorHint(false), 3600);
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
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      await uploadFilesToCanvas(files, flowPos);
    },
    [canvasId, screenToFlowPosition, uploadFilesToCanvas]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping =
        tagName === 'input' ||
        tagName === 'textarea' ||
        target?.isContentEditable;
      if (event.key === 'Escape') {
        setPendingConnection(null);
        setAiAssistantOpen(false);
        setConnectorHint(false);
      }
      if (isTyping) return;
      if ((event.metaKey || event.ctrlKey) && (event.key === '+' || event.key === '=')) {
        event.preventDefault();
        zoomIn({ duration: 160 });
      } else if ((event.metaKey || event.ctrlKey) && event.key === '-') {
        event.preventDefault();
        zoomOut({ duration: 160 });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomIn, zoomOut]);

  return (
    <div
      className={`literature-canvas ${isDraggingFiles ? 'is-dragging-files' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <CanvasToolbar
        onImportPapers={handleImportProjectPapers}
        onUploadPDF={() => fileInputRef.current?.click()}
        onAddText={() => handleAddNode('text')}
        onAddNote={() => handleAddNode('note')}
        onAddQuestion={() => handleAddNode('question')}
        onAddShape={() => handleAddNode('shape')}
        onAddGroup={handleAddGroup}
        onConnectorMode={handleConnectorMode}
        onFitView={handleFitView}
        disabled={!isReady}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="canvas-file-input"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = '';
          if (files.length > 0) uploadFilesToCanvas(files, getCanvasCenterPosition());
        }}
      />
      <CanvasSearch nodes={nodes} disabled={!isReady} onFocusNode={handleFocusNode} />
      <CanvasSceneNavigator
        scenes={scenes}
        disabled={!isReady}
        onAddScene={handleCreateScene}
        onGoToScene={handleFocusScene}
        onRenameScene={(sceneId, name) => handleUpdateScene(sceneId, { name })}
        onReplaceScene={(sceneId) => handleUpdateScene(sceneId, { captureCurrentView: true })}
        onDeleteScene={handleDeleteScene}
      />
      <SelectionToolbar
        selectedNodes={selectedNodes}
        onAskAI={() => {
          setFocusedPaperId(null);
          setAiAssistantOpen(true);
        }}
        onCreateNote={handleCreateNoteForSelection}
        onGroup={handleGroupSelection}
        onDelete={handleDeleteSelected}
        onOpenPaper={
          singleSelectedPaper ? () => setOpenPaper(singleSelectedPaper) : undefined
        }
        onConnectorMode={handleConnectorMode}
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
        {connectorHint && (
          <div className="canvas-connector-hint" role="status">
            Drag from a card handle to another card to connect them.
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
