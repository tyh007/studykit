import React from 'react';
import {
  AddIcon,
  BrainIcon,
  CornellIcon,
  LinkIcon,
  MindMapIcon,
  PDFIcon,
  SyncIcon,
  UploadFileIcon,
} from '../../ui/Icons';

interface Props {
  onImportPapers: () => void;
  onUploadPDF: () => void;
  onAddText: () => void;
  onAddNote: () => void;
  onAddQuestion: () => void;
  onAddShape: () => void;
  onAddGroup: () => void;
  onConnectorMode: () => void;
  onFitView: () => void;
  disabled?: boolean;
}

export default function CanvasToolbar({
  onImportPapers,
  onUploadPDF,
  onAddText,
  onAddNote,
  onAddQuestion,
  onAddShape,
  onAddGroup,
  onConnectorMode,
  onFitView,
  disabled,
}: Props) {
  const disabledTitle = disabled ? 'Pick a literature project before using canvas tools' : undefined;

  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas actions">
      <button
        className="canvas-toolbar-btn"
        onClick={onImportPapers}
        disabled={disabled}
        title={disabledTitle || 'Add project papers to canvas'}
        aria-label="Add project papers to canvas"
      >
        <PDFIcon size="sm" /> Paper
      </button>
      <button
        className="canvas-toolbar-btn"
        onClick={onUploadPDF}
        disabled={disabled}
        title={disabledTitle || 'Upload PDF to canvas'}
        aria-label="Upload PDF to canvas"
      >
        <UploadFileIcon size="sm" /> PDF
      </button>
      <button
        className="canvas-toolbar-btn"
        onClick={onAddText}
        disabled={disabled}
        title={disabledTitle || 'Add text card'}
        aria-label="Add text card"
      >
        <AddIcon size="sm" /> Text
      </button>
      <button
        className="canvas-toolbar-btn"
        onClick={onAddNote}
        disabled={disabled}
        title={disabledTitle || 'Add sticky note'}
        aria-label="Add sticky note"
      >
        <CornellIcon size="sm" /> Sticky
      </button>
      <button
        className="canvas-toolbar-btn"
        onClick={onAddQuestion}
        disabled={disabled}
        title={disabledTitle || 'Add question card'}
        aria-label="Add question card"
      >
        <BrainIcon size="sm" /> Question
      </button>
      <button
        className="canvas-toolbar-btn"
        onClick={onAddShape}
        disabled={disabled}
        title={disabledTitle || 'Add selectable shape'}
        aria-label="Add selectable shape"
      >
        <AddIcon size="sm" /> Shape
      </button>
      <button
        className="canvas-toolbar-btn"
        onClick={onAddGroup}
        disabled={disabled}
        title={disabledTitle || 'Add group frame'}
        aria-label="Add group frame"
      >
        <MindMapIcon size="sm" /> Group
      </button>
      <button
        className="canvas-toolbar-btn"
        onClick={onConnectorMode}
        disabled={disabled}
        title={disabledTitle || 'Drag from node handles to connect cards'}
        aria-label="Connector tool"
      >
        <LinkIcon size="sm" /> Connector
      </button>
      <button
        className="canvas-toolbar-btn"
        onClick={onFitView}
        disabled={disabled}
        title={disabledTitle || 'Fit to content'}
        aria-label="Fit to content"
      >
        <SyncIcon size="sm" /> Fit
      </button>
    </div>
  );
}
