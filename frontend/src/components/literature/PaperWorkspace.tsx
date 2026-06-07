import React, { useState, useEffect, useCallback } from 'react';
import { literaturePapersApi, paperNotesApi, paperRelationsApi } from '../../lib/literature-api';
import { createAIExtractionService } from '../../lib/literature/ai-extraction';
import { PromptBuilder } from '../../lib/literature/prompt-builder';
import { readAIProviderConfig } from '../../lib/literature/ai-provider-config';
import LiteraturePDFViewer from './LiteraturePDFViewer';
import PaperAnnotationLayer from './PaperAnnotationLayer';
import AIChatPanel from './AIChatPanel';
import PaperRelationsGraph from './PaperRelationsGraph';
import { useStore } from '../../store/useStore';
import type { LiteraturePaper, PaperNote, PaperRelation } from '../../types';

interface PaperWorkspaceProps {
  paper: LiteraturePaper;
  projectId: string;
  onBack: () => void;
  onUpdated: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  background: 'Background',
  theory: 'Theory & Hypotheses',
  methodology: 'Methodology',
  measures: 'Measures',
  results: 'Results',
  implications: 'Implications',
  limitations: 'Limitations',
};

const READING_STATUSES = ['unread', 'reading', 'read', 'reviewed'] as const;
const STATUS_LABELS: Record<string, string> = {
  unread: 'Unread',
  reading: 'Reading',
  read: 'Read',
  reviewed: 'Reviewed',
};

export default function PaperWorkspace({ paper, projectId, onBack, onUpdated }: PaperWorkspaceProps) {
  const [tab, setTab] = useState<'summary' | 'notes' | 'metadata' | 'relations'>('summary');
  const [pdfPageIndex, setPdfPageIndex] = useState(0);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfZoom, setPdfZoom] = useState(100);

  // Editable extracted data
  const [editableData, setEditableData] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);

  // Relations
  const [relations, setRelations] = useState<PaperRelation[]>([]);
  const [showAddRelation, setShowAddRelation] = useState(false);
  const [relationTargetId, setRelationTargetId] = useState('');
  const [relationType, setRelationType] = useState('related');
  const [relationDesc, setRelationDesc] = useState('');
  const [projectPapers, setProjectPapers] = useState<Array<{id: string; title: string}>>([]);
  const [relationLoading, setRelationLoading] = useState(false);
  const [graphData, setGraphData] = useState<{nodes: any[]; edges: any[]}>({nodes: [], edges: []});
  const [graphExpanded, setGraphExpanded] = useState(false);
  const [splitPercent, setSplitPercent] = useState(55);
  const { selectLitPaper } = useStore();
  const dragSplitRef = useRef<{ startX: number; startPercent: number } | null>(null);

  const handleSplitDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = (e.target as HTMLElement).parentElement;
    if (!container) return;
    const containerWidth = container.getBoundingClientRect().width;
    if (containerWidth === 0) return;
    dragSplitRef.current = { startX: e.clientX, startPercent: splitPercent };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragSplitRef.current) return;
      const dx = ev.clientX - dragSplitRef.current.startX;
      const cw = container.getBoundingClientRect().width;
      const pct = dragSplitRef.current.startPercent + (dx / cw) * 100;
      setSplitPercent(Math.max(25, Math.min(75, pct)));
    };
    const handleMouseUp = () => {
      dragSplitRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [splitPercent]);

  // Notes
  const [notes, setNotes] = useState<PaperNote[]>([]);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteContent, setEditNoteContent] = useState('');

  // Reading status & importance
  const [status, setStatus] = useState<'unread' | 'reading' | 'read' | 'reviewed'>(
    (paper.reading_status as any) || 'unread'
  );
  const [importance, setImportance] = useState(paper.importance || 0);

  // Initialize editable data from paper
  useEffect(() => {
    if (paper.extracted_data) {
      const data: Record<string, string> = {};
      const fields = ['background', 'theory', 'methodology', 'measures', 'results', 'implications', 'limitations'];
      for (const field of fields) {
        data[field] = (paper.extracted_data as any)[field] || '';
      }
      setEditableData(data);
    } else {
      setEditableData({});
    }
    setDirty(false);
    setStatus((paper.reading_status as any) || 'unread');
    setImportance(paper.importance || 0);
  }, [paper.id, paper.extracted_data, paper.reading_status, paper.importance]);

  // Load relations
  const loadRelations = useCallback(async () => {
    try {
      const result = await paperRelationsApi.list(paper.id);
      setRelations(result);
    } catch (err) {
      console.error('Failed to load relations:', err);
    }
  }, [paper.id]);

  useEffect(() => {
    loadRelations();
  }, [loadRelations]);

  // Load project papers for relation form
  useEffect(() => {
    literaturePapersApi.list(projectId).then(papers => {
      setProjectPapers(papers.filter((p: any) => p.id !== paper.id).map((p: any) => ({ id: p.id, title: p.title || p.file_name })));
    }).catch(() => {});
  }, [projectId, paper.id]);

  // Load notes
  const loadNotes = useCallback(async () => {
    try {
      const result = await paperNotesApi.list(paper.id);
      setNotes(result);
    } catch (err) {
      console.error('Failed to load notes:', err);
    }
  }, [paper.id]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // Update field value
  const handleFieldChange = (field: string, value: string) => {
    setEditableData(prev => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  // Save all changes (extracted_data + status + importance)
  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, any> = {};

      // Only save extracted_data if it was modified
      if (dirty && Object.keys(editableData).length > 0) {
        updates.extracted_data = {
          ...paper.extracted_data,
          ...editableData,
        };
      }

      // Always sync status and importance (they might have changed)
      if (status !== paper.reading_status) updates.reading_status = status;
      if (importance !== (paper.importance || 0)) updates.importance = importance;

      if (Object.keys(updates).length > 0) {
        await literaturePapersApi.update(paper.id, updates);
        setDirty(false);
        onUpdated();
      }
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  };

  // Auto-save status and importance changes immediately
  const handleStatusChange = async (newStatus: 'unread' | 'reading' | 'read' | 'reviewed') => {
    setStatus(newStatus);
    try {
      await literaturePapersApi.update(paper.id, { reading_status: newStatus });
      onUpdated();
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const handleImportanceChange = async (newImportance: number) => {
    setImportance(newImportance);
    try {
      await literaturePapersApi.update(paper.id, { importance: newImportance });
      onUpdated();
    } catch (err) {
      console.error('Failed to update importance:', err);
    }
  };

  // Re-extract a single field
  const handleReExtractField = async (field: string) => {
    if (!paper.full_text) return;

    setExtracting(true);
    try {
      const service = createAIExtractionService();
      const result = await service.extractWithFallback(paper.full_text, 'brief');
      const newValue = (result.extractedData as any)[field];
      if (newValue && newValue !== 'Not mentioned') {
        handleFieldChange(field, newValue);
      }
    } catch (err) {
      console.error(`Re-extraction failed for ${field}:`, err);
    } finally {
      setExtracting(false);
    }
  };

  // Full extraction (when no extracted_data exists)
  const handleExtractAll = async () => {
    if (!paper.full_text) return;
    setExtracting(true);
    try {
      const service = createAIExtractionService();
      const result = await service.extractWithFallback(paper.full_text, 'brief');
      const data: Record<string, string> = {};
      const fields = ['background', 'theory', 'methodology', 'measures', 'results', 'implications', 'limitations'];
      for (const field of fields) {
        data[field] = (result.extractedData as any)[field] || 'Not mentioned';
      }
      setEditableData(data);

      await literaturePapersApi.update(paper.id, {
        extracted_data: result.extractedData,
        processing_status: 'completed',
      });

      setDirty(false);
      onUpdated();
    } catch (err) {
      console.error('Extraction failed:', err);
    } finally {
      setExtracting(false);
    }
  };

  // Notes: add
  const handleAddNote = async () => {
    if (!newNoteContent.trim()) return;
    setSavingNote(true);
    try {
      await paperNotesApi.create({ paper_id: paper.id, content: newNoteContent.trim() });
      setNewNoteContent('');
      await loadNotes();
    } catch (err) {
      console.error('Failed to add note:', err);
    } finally {
      setSavingNote(false);
    }
  };

  // Notes: update
  const handleUpdateNote = async (noteId: string) => {
    if (!editNoteContent.trim()) return;
    try {
      await paperNotesApi.update(noteId, { content: editNoteContent.trim() });
      setEditingNoteId(null);
      setEditNoteContent('');
      await loadNotes();
    } catch (err) {
      console.error('Failed to update note:', err);
    }
  };

  // Notes: delete
  const handleDeleteNote = async (noteId: string) => {
    try {
      await paperNotesApi.delete(noteId);
      await loadNotes();
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  };

  const extractedFields = ['background', 'theory', 'methodology', 'measures', 'results', 'implications', 'limitations'];
  const hasExtraction = Object.values(editableData).some(v => v && v !== 'Not mentioned');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem',
        borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)',
        flexShrink: 0,
      }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}
          style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
          ← Library
        </button>

        <h3 style={{ margin: 0, flex: 1, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {paper.title || paper.file_name}
        </h3>

        {/* Reading status */}
        <select
          value={status}
          onChange={e => handleStatusChange(e.target.value as any)}
          style={{ fontSize: '0.72rem', padding: '0.2rem 0.375rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
        >
          {READING_STATUSES.map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>

        {/* Importance stars */}
        <div style={{ display: 'flex', gap: '1px', fontSize: '0.85rem' }}>
          {[1, 2, 3, 4, 5].map(n => (
            <span
              key={n}
              onClick={() => handleImportanceChange(n === importance ? 0 : n)}
              style={{ cursor: 'pointer', color: n <= importance ? '#f59e0b' : 'var(--color-border)', transition: 'color 0.1s' }}
              title={`${n} star${n > 1 ? 's' : ''}`}
            >
              ★
            </span>
          ))}
        </div>
      </div>

      {/* Main content: split pane */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left: PDF Viewer */}
        <div style={{ width: splitPercent + '%', minWidth: 0, overflow: 'auto' }}>
          {paper.storage_key ? (
            <LiteraturePDFViewer
              paperId={paper.id}
              currentPageIndex={pdfPageIndex}
              totalPages={pdfTotalPages}
              onPageChange={setPdfPageIndex}
              onTotalPagesChange={setPdfTotalPages}
              zoom={pdfZoom}
              onZoomChange={setPdfZoom}
              annotationOverlay={
                <PaperAnnotationLayer
                  paperId={paper.id}
                  pageNumber={pdfPageIndex + 1}
                />
              }
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
              No PDF available
            </div>
          )}
        </div>

        {/* Right: Tabs */}
              <div onMouseDown={handleSplitDragStart} style={{ width: 6, cursor: 'col-resize', background: 'var(--color-bg-secondary)', flexShrink: 0, position: 'relative', zIndex: 5 }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
            {(['summary', 'notes', 'metadata', 'relations'] as const).map(t => (
              <button
                key={t}
                className={`btn btn-ghost btn-sm ${tab === t ? 'active' : ''}`}
                onClick={() => setTab(t)}
                style={{
                  flex: 1, borderRadius: 0, fontSize: '0.78rem', padding: '0.5rem',
                  borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
                  fontWeight: tab === t ? 600 : 400,
                  color: tab === t ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                }}
              >
                {t === 'summary' ? 'Summary' : t === 'notes' ? 'Notes' : 'Metadata'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'auto', padding: '0.75rem' }}>

            {/* === SUMMARY TAB === */}
            {tab === 'summary' && (
              <div>
                {!hasExtraction && (
                  <div style={{ marginBottom: '0.75rem', padding: '0.75rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                    <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--color-text-secondary)' }}>
                      No AI extraction yet. Extract key information from this paper?
                    </p>
                    <button className="btn btn-primary btn-sm" onClick={handleExtractAll} disabled={extracting || !paper.full_text}>
                      {extracting ? 'Extracting...' : 'Extract Summary'}
                    </button>
                    {!paper.full_text && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.375rem' }}>
                        Full text not available for this paper.
                      </p>
                    )}
                  </div>
                )}

                {hasExtraction && (
                  <>
                    {extractedFields.map(field => {
                      const value = editableData[field] || '';
                      const isPlaceholder = value === 'Not mentioned';
                      return (
                        <div key={field} style={{ marginBottom: '0.75rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                            <label style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
                              {FIELD_LABELS[field]}
                            </label>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => handleReExtractField(field)}
                              disabled={extracting || !paper.full_text}
                              style={{ fontSize: '0.65rem', padding: '0.125rem 0.375rem' }}
                              title="Re-extract this field from AI"
                            >
                              {extracting ? '...' : '🔄'}
                            </button>
                          </div>
                          <textarea
                            value={value}
                            onChange={e => handleFieldChange(field, e.target.value)}
                            style={{
                              width: '100%', minHeight: 60, padding: '0.375rem 0.5rem',
                              fontSize: '0.8rem', lineHeight: 1.5,
                              border: `1px solid ${isPlaceholder ? 'var(--color-border-light)' : 'var(--color-border)'}`,
                              borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)',
                              color: isPlaceholder ? 'var(--color-text-muted)' : 'var(--color-text)',
                              resize: 'vertical', fontFamily: 'inherit',
                            }}
                            placeholder={isPlaceholder ? 'Not mentioned in this paper' : ''}
                          />
                        </div>
                      );
                    })}

                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                      <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !dirty}>
                        {saving ? 'Saving...' : 'Save Changes'}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={handleExtractAll} disabled={extracting || !paper.full_text}>
                        {extracting ? 'Extracting...' : 'Re-extract All'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* === NOTES TAB === */}
            {tab === 'notes' && (
              <div>
                {/* New note */}
                <div style={{ marginBottom: '1rem' }}>
                  <textarea
                    value={newNoteContent}
                    onChange={e => setNewNoteContent(e.target.value)}
                    placeholder="Write a note about this paper..."
                    style={{
                      width: '100%', minHeight: 80, padding: '0.5rem',
                      fontSize: '0.8rem', lineHeight: 1.5,
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)',
                      color: 'var(--color-text)', resize: 'vertical',
                      fontFamily: 'inherit', marginBottom: '0.375rem',
                    }}
                  />
                  <button className="btn btn-primary btn-sm" onClick={handleAddNote} disabled={savingNote || !newNoteContent.trim()}>
                    {savingNote ? 'Adding...' : 'Add Note'}
                  </button>
                </div>

                {/* Note list */}
                {notes.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>No notes yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {notes.map(note => (
                      <div key={note.id} style={{
                        padding: '0.5rem', borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border-light)',
                        background: 'var(--color-bg)',
                      }}>
                        {editingNoteId === note.id ? (
                          <div>
                            <textarea
                              autoFocus
                              value={editNoteContent}
                              onChange={e => setEditNoteContent(e.target.value)}
                              style={{
                                width: '100%', minHeight: 60, padding: '0.375rem',
                                fontSize: '0.8rem', lineHeight: 1.5,
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-sm)', resize: 'vertical',
                                fontFamily: 'inherit', marginBottom: '0.25rem',
                              }}
                            />
                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                              <button className="btn btn-primary btn-sm" onClick={() => handleUpdateNote(note.id)}
                                style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem' }}>
                                Save
                              </button>
                              <button className="btn btn-ghost btn-sm" onClick={() => { setEditingNoteId(null); }}
                                style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem' }}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <p style={{ fontSize: '0.8rem', lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap' }}>
                              {note.content}
                            </p>
                            <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
                              <button className="btn btn-ghost btn-sm"
                                onClick={() => { setEditingNoteId(note.id); setEditNoteContent(note.content); }}
                                style={{ fontSize: '0.65rem', padding: '0.125rem 0.375rem' }}>
                                Edit
                              </button>
                              <button className="btn btn-ghost btn-sm"
                                onClick={() => handleDeleteNote(note.id)}
                                style={{ fontSize: '0.65rem', padding: '0.125rem 0.375rem', color: 'var(--color-danger)' }}>
                                Delete
                              </button>
                            </div>
                            <p style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', margin: '0.25rem 0 0' }}>
                              {new Date(note.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* === RELATIONS TAB === */}
            {tab === 'relations' && (
              <div>
                <div style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Paper Relations ({relations.length})</span>
                  <button className="btn btn-sm btn-primary" onClick={() => setShowAddRelation(!showAddRelation)}>
                    {showAddRelation ? 'Cancel' : '+ Add Relation'}
                  </button>
                </div>

                {showAddRelation && (
                  <div style={{ marginBottom: '0.75rem', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ marginBottom: '0.375rem' }}>
                      <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: '0.125rem' }}>Target Paper</label>
                      <select
                        value={relationTargetId}
                        onChange={e => setRelationTargetId(e.target.value)}
                        style={{ width: '100%', fontSize: '0.78rem', padding: '0.25rem 0.375rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                      >
                        <option value="">Select a paper...</option>
                        {projectPapers.map(p => (
                          <option key={p.id} value={p.id}>{p.title}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ marginBottom: '0.375rem' }}>
                      <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: '0.125rem' }}>Relation Type</label>
                      <select
                        value={relationType}
                        onChange={e => setRelationType(e.target.value)}
                        style={{ width: '100%', fontSize: '0.78rem', padding: '0.25rem 0.375rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                      >
                        <option value="cites">Cites</option>
                        <option value="extends">Extends / Builds on</option>
                        <option value="contradicts">Contradicts</option>
                        <option value="supports">Supports / Confirms</option>
                        <option value="related">Generally Related</option>
                        <option value="method">Same Methodology</option>
                        <option value="dataset">Same Dataset</option>
                      </select>
                    </div>
                    <div style={{ marginBottom: '0.375rem' }}>
                      <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: '0.125rem' }}>Description (optional)</label>
                      <input
                        type="text"
                        value={relationDesc}
                        onChange={e => setRelationDesc(e.target.value)}
                        placeholder="e.g., Extends the RNN model from Smith et al."
                        style={{ width: '100%', fontSize: '0.78rem', padding: '0.25rem 0.375rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                      />
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={async () => {
                      if (!relationTargetId) return;
                      setRelationLoading(true);
                      try {
                        await paperRelationsApi.create({
                          source_paper_id: paper.id,
                          target_paper_id: relationTargetId,
                          relation_type: relationType,
                          description: relationDesc || undefined,
                        });
                        setShowAddRelation(false);
                        setRelationTargetId('');
                        setRelationType('related');
                        setRelationDesc('');
                        await loadRelations();
                      } catch (err) {
                        console.error('Failed to create relation:', err);
                      } finally {
                        setRelationLoading(false);
                      }
                    }} disabled={relationLoading || !relationTargetId}>
                      {relationLoading ? 'Adding...' : 'Add Relation'}
                    </button>
                  </div>
                )}

                {relations.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>No relations defined yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    {relations.map(rel => (
                      <div key={rel.id} style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        padding: '0.375rem 0.5rem', borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border-light)',
                        fontSize: '0.78rem',
                      }}>
                        <span style={{
                          display: 'inline-block', padding: '0.1rem 0.35rem', borderRadius: '8px',
                          fontSize: '0.65rem', fontWeight: 600, whiteSpace: 'nowrap',
                          background: '#f0fdf4', color: '#16a34a',
                        }}>
                          {({ cites: 'Cites', extends: 'Extends', contradicts: 'Contradicts', supports: 'Supports', related: 'Related', method: 'Method', dataset: 'Dataset' })[rel.relation_type] || rel.relation_type}
                        </span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {rel.direction === 'outgoing' ? '→' : '←'} {rel.related_title || 'Unknown paper'}
                        </span>
                        {rel.description && (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {rel.description}
                          </span>
                        )}
                        <button className="btn btn-ghost btn-sm"
                          onClick={async () => { try { await paperRelationsApi.delete(rel.id); await loadRelations(); } catch {} }}
                          style={{ fontSize: '0.65rem', padding: '0.125rem 0.25rem', color: 'var(--color-danger)', flexShrink: 0 }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Graph visualization */}
                <div style={{ marginTop: '1rem' }}>
                  <div
                    onClick={() => setGraphExpanded(!graphExpanded)}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.375rem 0', fontSize: '0.82rem', color: 'var(--color-primary)' }}
                  >
                    <span>{graphExpanded ? '▼' : '▶'}</span>
                    <span>Graph View ({graphData.nodes.length} papers, {graphData.edges.length} relations)</span>
                  </div>
                  {graphExpanded && (
                    <PaperRelationsGraph
                      nodes={graphData.nodes}
                      edges={graphData.edges}
                      highlightPaperId={paper.id}
                      onNodeClick={(id) => { if (id !== paper.id) selectLitPaper(id); }}
                      width={620}
                      height={400}
                    />
                  )}
                </div>
              </div>
            )}

            {/* === METADATA TAB === */}
            {tab === 'metadata' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.375rem 0.75rem', fontSize: '0.8rem' }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>Title</span>
                  <span>{paper.title || '—'}</span>

                  <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>Authors</span>
                  <span>{paper.authors || '—'}</span>

                  <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>Year</span>
                  <span>{paper.year || '—'}</span>

                  <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>Journal</span>
                  <span>{paper.journal || '—'}</span>

                  <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>DOI</span>
                  <span>
                    {paper.doi ? (
                      <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer"
                        style={{ color: 'var(--color-primary)' }}>
                        {paper.doi}
                      </a>
                    ) : '—'}
                  </span>

                  <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>File</span>
                  <span>{paper.file_name}</span>

                  <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>Size</span>
                  <span>{(paper.file_size / 1024).toFixed(1)} KB</span>

                  <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>Uploaded</span>
                  <span>{paper.uploaded_at ? new Date(paper.uploaded_at).toLocaleDateString() : '—'}</span>

                  <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>Status</span>
                  <span>{STATUS_LABELS[status] || status}</span>
                </div>

                {paper.abstract && (
                  <div style={{ marginTop: '1rem' }}>
                    <h4 style={{ fontSize: '0.82rem', marginBottom: '0.375rem' }}>Abstract</h4>
                    <p style={{ fontSize: '0.8rem', lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
                      {paper.abstract}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <AIChatPanel paper={paper} />
    </div>
  );
}
