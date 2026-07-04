import React, { useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { LiteraturePaper } from '../../../types';
import { CloseIcon, MoreIcon } from '../../ui/Icons';
import type { CanvasFlowNode } from './canvas-types';

interface PaperNodeProps extends NodeProps<CanvasFlowNode> {
  onOpenPaper?: (paper: LiteraturePaper) => void;
  onRunSummary?: (paperId: string) => void;
  onCreateSummaryNote?: (paperId: string) => void;
  onAskPaper?: (paperId: string) => void;
}

function getSummaryStatus(paper: LiteraturePaper | null | undefined): {
  label: string;
  tone: 'none' | 'pending' | 'success' | 'error';
} {
  if (!paper) return { label: 'No paper', tone: 'none' };
  const status = paper.processing_status;
  if (status === 'pending' || status === 'processing') {
    return { label: 'Summarizing…', tone: 'pending' };
  }
  if (status === 'error') return { label: 'Summary failed', tone: 'error' };
  if (paper.extracted_data && Object.keys(paper.extracted_data).length > 0) {
    return { label: 'Summarized', tone: 'success' };
  }
  return { label: 'No summary', tone: 'none' };
}

function getReadingStatusLabel(paper: LiteraturePaper | null | undefined): string {
  switch (paper?.reading_status) {
    case 'reading':
      return 'Reading';
    case 'read':
      return 'Read';
    case 'reviewed':
      return 'Reviewed';
    default:
      return 'Unread';
  }
}

function getImportanceStars(importance: number | undefined): string {
  const v = Math.max(0, Math.min(5, importance ?? 0));
  return '★'.repeat(v) + '☆'.repeat(5 - v);
}

export default function PaperNode({
  id,
  data,
  selected,
  onOpenPaper,
  onRunSummary,
  onCreateSummaryNote,
  onAskPaper,
}: PaperNodeProps) {
  const paper: LiteraturePaper | null | undefined = data.paper;
  const [menuOpen, setMenuOpen] = useState(false);

  const title = useMemo(() => {
    if (!paper) return 'Missing paper';
    return paper.title || paper.file_name || 'Untitled paper';
  }, [paper]);

  const meta = useMemo(() => {
    if (!paper) return '';
    const bits: string[] = [];
    if (paper.authors) {
      const firstAuthor = paper.authors.split(/[,;]/)[0]?.trim() ?? '';
      bits.push(firstAuthor + (paper.authors.includes(',') ? ' et al.' : ''));
    }
    if (paper.year) bits.push(String(paper.year));
    return bits.join(' · ');
  }, [paper]);

  const summary = getSummaryStatus(paper);
  const readingLabel = getReadingStatusLabel(paper);
  const importanceStars = getImportanceStars(paper?.importance);

  const handleOpen = () => {
    if (paper && onOpenPaper) onOpenPaper(paper);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    data.actions.onDelete(id);
  };

  return (
    <div
      className={`canvas-node canvas-node-paper ${selected ? 'is-selected' : ''}`}
      onDoubleClick={handleOpen}
    >
      <Handle type="target" position={Position.Top} />
      <div className="canvas-node-header">
        <span className="canvas-node-type">Paper</span>
        <div className="canvas-node-header-actions">
          <button
            className="canvas-node-icon-btn"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            aria-label="Paper actions"
            title="Actions"
          >
            <MoreIcon size="sm" />
          </button>
          <button
            className="canvas-node-icon-btn canvas-node-delete"
            onClick={handleDelete}
            title="Remove from canvas (does not delete paper)"
            aria-label="Remove from canvas"
          >
            <CloseIcon size="sm" />
          </button>
        </div>
      </div>
      {menuOpen && (
        <div
          className="canvas-node-menu"
          onClick={(e) => e.stopPropagation()}
          onMouseLeave={() => setMenuOpen(false)}
        >
          <button
            className="canvas-node-menu-item"
            onClick={() => {
              setMenuOpen(false);
              handleOpen();
            }}
          >
            Open PDF
          </button>
          {paper && onRunSummary && (
            <button
              className="canvas-node-menu-item"
              onClick={() => {
                setMenuOpen(false);
                onRunSummary(paper.id);
              }}
            >
              Run summary
            </button>
          )}
          {paper && onAskPaper && (
            <button
              className="canvas-node-menu-item"
              onClick={() => {
                setMenuOpen(false);
                onAskPaper(paper.id);
              }}
            >
              Ask AI
            </button>
          )}
          {paper && onCreateSummaryNote && paper.extracted_data && (
            <button
              className="canvas-node-menu-item"
              onClick={() => {
                setMenuOpen(false);
                onCreateSummaryNote(paper.id);
              }}
            >
              Create summary note
            </button>
          )}
          <button
            className="canvas-node-menu-item"
            onClick={() => {
              setMenuOpen(false);
              data.actions.onDelete(id);
            }}
          >
            Remove from canvas
          </button>
        </div>
      )}
      <div className="canvas-node-body canvas-node-paper-body">
        <div className="canvas-node-paper-title" title={title}>
          {title}
        </div>
        {meta && <div className="canvas-node-paper-meta">{meta}</div>}
        <div className="canvas-node-paper-row">
          <span className={`canvas-pill canvas-pill-summary canvas-pill-${summary.tone}`}>
            {summary.label}
          </span>
          <span className="canvas-pill canvas-pill-reading">{readingLabel}</span>
        </div>
        <div className="canvas-node-paper-row canvas-node-paper-stars" title="Importance">
          {importanceStars}
        </div>
        {!paper && (
          <div className="canvas-node-paper-warning">
            The referenced paper is missing or has been deleted.
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
