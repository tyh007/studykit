import React, { useEffect, useState } from 'react';
import type { LiteraturePaper, PaperNote, ExtractedData } from '../../../types';
import { paperNotesApi } from '../../../lib/literature-api';
import LiteraturePDFViewer from '../LiteraturePDFViewer';
import { CloseIcon, TrashIcon } from '../../ui/Icons';

const DRAWER_WIDTH_KEY = 'studykit-canvas-drawer-width';
const MIN_WIDTH = 320;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 480;

type Tab = 'pdf' | 'summary' | 'notes' | 'ask';

interface Props {
  paper: LiteraturePaper | null;
  onClose: () => void;
  onAddAnswerToCanvas?: (paper: LiteraturePaper, prompt: string, answer: string) => void;
}

function getInitialWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(DRAWER_WIDTH_KEY);
  if (!raw) return DEFAULT_WIDTH;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return DEFAULT_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n));
}

export default function PaperPreviewDrawer({ paper, onClose, onAddAnswerToCanvas }: Props) {
  const [width, setWidth] = useState<number>(getInitialWidth);
  const [activeTab, setActiveTab] = useState<Tab>('pdf');
  const [pdfPage, setPdfPage] = useState(0);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfZoom, setPdfZoom] = useState(100);

  const [notes, setNotes] = useState<PaperNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [askInput, setAskInput] = useState('');
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askLoading, setAskLoading] = useState(false);

  // Load notes when paper changes
  useEffect(() => {
    if (!paper) {
      setNotes([]);
      return;
    }
    let cancelled = false;
    setNotesLoading(true);
    paperNotesApi
      .list(paper.id)
      .then((rows) => {
        if (!cancelled) setNotes(rows as PaperNote[]);
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      })
      .finally(() => {
        if (!cancelled) setNotesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paper?.id]);

  // Persist width
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DRAWER_WIDTH_KEY, String(width));
  }, [width]);

  // Reset to PDF tab when opening a different paper
  useEffect(() => {
    if (paper) {
      setActiveTab('pdf');
      setAskAnswer(null);
      setAskInput('');
    }
  }, [paper?.id]);

  if (!paper) return null;

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: MouseEvent) => {
      const diff = startX - ev.clientX;
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + diff));
      setWidth(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleAddNote = async () => {
    const content = newNote.trim();
    if (!content) return;
    try {
      const created = (await paperNotesApi.create({
        paper_id: paper.id,
        content,
      })) as PaperNote;
      setNotes((prev) => [...prev, created]);
      setNewNote('');
    } catch (err) {
      console.warn('Failed to add note', err);
    }
  };

  const handleDeleteNote = async (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try {
      await paperNotesApi.delete(id);
    } catch (err) {
      console.warn('Failed to delete note', err);
    }
  };

  const handleAskSubmit = async () => {
    const prompt = askInput.trim();
    if (!prompt) return;
    setAskLoading(true);
    setAskAnswer(null);
    try {
      // Lazy import to avoid circular dep with literatureAiApi
      const { literatureAiApi } = await import('../../../lib/literature-api');
      const res = await literatureAiApi.chat({
        paperId: paper.id,
        messages: [{ role: 'user', content: prompt }],
      });
      setAskAnswer(res?.message?.content ?? 'No answer returned.');
    } catch (err) {
      setAskAnswer(
        `Failed to get an answer: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    } finally {
      setAskLoading(false);
    }
  };

  const extracted: ExtractedData | undefined = paper.extracted_data;

  return (
    <div className="paper-preview-drawer" style={{ width }} role="dialog" aria-label="Paper preview">
      <div className="paper-preview-drawer-resize" onMouseDown={startResize} aria-hidden="true" />
      <div className="paper-preview-drawer-header">
        <div className="paper-preview-drawer-title" title={paper.title || paper.file_name}>
          {paper.title || paper.file_name || 'Untitled paper'}
        </div>
        <button
          className="paper-preview-drawer-close"
          onClick={onClose}
          aria-label="Close drawer"
          title="Close"
        >
          <CloseIcon size="sm" />
        </button>
      </div>
      <div className="paper-preview-drawer-tabs" role="tablist">
        {(['pdf', 'summary', 'notes', 'ask'] as const).map((t) => (
          <button
            key={t}
            className={`paper-preview-drawer-tab ${activeTab === t ? 'is-active' : ''}`}
            onClick={() => setActiveTab(t)}
            role="tab"
            aria-selected={activeTab === t}
          >
            {t === 'pdf' ? 'PDF' : t === 'summary' ? 'Summary' : t === 'notes' ? 'Notes' : 'Ask'}
          </button>
        ))}
      </div>
      <div className="paper-preview-drawer-content">
        {activeTab === 'pdf' && (
          <div className="paper-preview-drawer-pdf">
            <LiteraturePDFViewer
              paperId={paper.id}
              currentPageIndex={pdfPage}
              totalPages={pdfTotalPages}
              onPageChange={setPdfPage}
              onTotalPagesChange={setPdfTotalPages}
              zoom={pdfZoom}
              onZoomChange={setPdfZoom}
            />
          </div>
        )}
        {activeTab === 'summary' && (
          <div className="paper-preview-drawer-summary">
            {!extracted || Object.keys(extracted).length === 0 ? (
              <p className="muted">No summary yet. Run "Summarize" on the paper card to generate one.</p>
            ) : (
              <div>
                {(['background', 'theory', 'methodology', 'measures', 'results', 'implications', 'limitations'] as const).map(
                  (field) =>
                    extracted[field] ? (
                      <section key={field} className="paper-summary-section">
                        <h4>{field[0].toUpperCase() + field.slice(1)}</h4>
                        <p>{extracted[field]}</p>
                      </section>
                    ) : null
                )}
                {extracted.paperType && (
                  <section className="paper-summary-section">
                    <h4>Type</h4>
                    <p>{extracted.paperType}</p>
                  </section>
                )}
                {extracted.customFields && Object.keys(extracted.customFields).length > 0 && (
                  <section className="paper-summary-section">
                    <h4>Custom</h4>
                    {Object.entries(extracted.customFields).map(([k, v]) => (
                      <p key={k}>
                        <strong>{k}:</strong> {v}
                      </p>
                    ))}
                  </section>
                )}
              </div>
            )}
          </div>
        )}
        {activeTab === 'notes' && (
          <div className="paper-preview-drawer-notes">
            <div className="paper-preview-drawer-note-input">
              <textarea
                placeholder="Add a note…"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                rows={3}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleAddNote}
                disabled={!newNote.trim()}
              >
                Add note
              </button>
            </div>
            {notesLoading ? (
              <p className="muted">Loading…</p>
            ) : notes.length === 0 ? (
              <p className="muted">No notes yet.</p>
            ) : (
              <ul className="paper-preview-drawer-note-list">
                {notes.map((n) => (
                  <li key={n.id} className="paper-preview-drawer-note">
                    <div className="paper-preview-drawer-note-body">{n.content}</div>
                    <button
                      className="paper-preview-drawer-note-delete"
                      onClick={() => handleDeleteNote(n.id)}
                      title="Delete"
                      aria-label="Delete note"
                    >
                      <TrashIcon size="sm" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {activeTab === 'ask' && (
          <div className="paper-preview-drawer-ask">
            <textarea
              placeholder="Ask a question about this paper…"
              value={askInput}
              onChange={(e) => setAskInput(e.target.value)}
              rows={3}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={handleAskSubmit}
              disabled={askLoading || !askInput.trim()}
            >
              {askLoading ? 'Thinking…' : 'Ask'}
            </button>
            {askAnswer && (
              <div className="paper-preview-drawer-ask-answer">
                {askAnswer}
                {onAddAnswerToCanvas && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <button
                      className="btn btn-sm"
                      onClick={() => onAddAnswerToCanvas(paper, askInput, askAnswer)}
                    >
                      Add to canvas
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
