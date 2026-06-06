import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { literaturePapersApi, readingListsApi, literatureAiApi } from '../../lib/literature-api';
import { useLiteratureFileUpload } from '../../hooks/useLiteratureFileUpload';

import AIStatusIndicator from './AIStatusIndicator';
import AISettingsPanel from './AISettingsPanel';
import ColumnConfigDialog, { getVisibleColumnKeys, saveColumnConfig, type ColumnConfigItem } from './ColumnConfigDialog';
import { createAIExtractionService } from '../../lib/literature/ai-extraction';
import { smartExtract } from '../../lib/literature/multimodal-extraction';
import { readAIProviderConfig } from '../../lib/literature/ai-provider-config';
import type { LiteraturePaper, ExtractedData } from '../../types';

const FIELD_LABELS: Record<string, string> = {
  background: 'Background', theory: 'Theory & Hypotheses', methodology: 'Methodology',
  measures: 'Measures', results: 'Results', implications: 'Implications', limitations: 'Limitations',
};

interface ColumnWidths {
  checkbox: number;
  title: number;
  authors: number;
  year: number;
  [key: string]: number;
}

const DEFAULT_WIDTHS: ColumnWidths = {
  checkbox: 44, title: 200, authors: 160, year: 60, status: 80, importance: 70,
  background: 180, theory: 180, methodology: 180, measures: 180,
  results: 180, implications: 180, limitations: 180,
};

const ROW_HEIGHT_STORAGE_KEY = 'lit-row-heights';

function formatAuthorsAPA(authors?: string): string {
  if (!authors) return '';
  return authors.split(';').map(a => {
    const trimmed = a.trim();
    if (!trimmed) return '';
    // Detect "Last, First" format (contains comma)
    if (trimmed.includes(',')) {
      const parts = trimmed.split(',').map(s => s.trim());
      const surname = parts[0];
      const given = parts[1] || '';
      const initial = given.replace(/[^a-zA-Z]/g, '').charAt(0).toUpperCase();
      return initial ? `${surname}, ${initial}.` : surname;
    }
    // "First Last" format
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const surname = parts.slice(1).join(' ');
      return `${surname}, ${parts[0][0]}.`;
    }
    return trimmed;
  }).join('; ');
}

export default function SummaryTable({ projectId }: { projectId: string }) {
  const { litPapers, setLitPapers, litCustomFields, readingLists, selectLitPaper } = useStore();
  const { uploadFiles, isUploading } = useLiteratureFileUpload();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const [view, setView] = useState<'library' | 'trash'>('library');
  const [searchQuery, setSearchQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set());
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => {
    const saved = localStorage.getItem('lit-column-widths');
    return saved ? { ...DEFAULT_WIDTHS, ...JSON.parse(saved) } : DEFAULT_WIDTHS;
  });
  const [rowHeights, setRowHeights] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem(ROW_HEIGHT_STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showColumnConfig, setShowColumnConfig] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => getVisibleColumnKeys());
  const [extractMode, setExtractMode] = useState<'text' | 'vision' | 'auto'>('auto');
  const [showExtractMenu, setShowExtractMenu] = useState(false);
  const [extractingBatch, setExtractingBatch] = useState(false);
  const [extractingSingle, setExtractingSingle] = useState<Set<string>>(new Set());
  const [filterReadingListId, setFilterReadingListId] = useState<string | null>(null);
  const [filterCitationIds, setFilterCitationIds] = useState<Set<string>>(new Set());
  const tableRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ col: string; startX: number; startW: number } | null>(null);
  const rowDragRef = useRef<{ paperId: string; startY: number; startH: number } | null>(null);

  useEffect(() => {
    localStorage.setItem('lit-column-widths', JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    localStorage.setItem(ROW_HEIGHT_STORAGE_KEY, JSON.stringify(rowHeights));
  }, [rowHeights]);

  // When reading list filter changes, load its citation IDs
  useEffect(() => {
    if (!filterReadingListId) {
      setFilterCitationIds(new Set());
      return;
    }
    readingListsApi.get(filterReadingListId).then(list => {
      const ids = new Set<string>((list.items || []).map((i: any) => i.citation_item_id || i.id));
      setFilterCitationIds(ids);
    }).catch(console.error);
  }, [filterReadingListId]);

  const loadPapers = useCallback(() => {
    literaturePapersApi.list(projectId, view).then(setLitPapers).catch(console.error);
  }, [projectId, view]);

  useEffect(() => { loadPapers(); }, [loadPapers]);

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    if (files.length > 0) {
      await uploadFiles(files, projectId);
      loadPapers();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type === 'application/pdf');
    if (files.length > 0) {
      await uploadFiles(files, projectId);
      loadPapers();
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === litPapers.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(litPapers.map(p => p.id)));
  };

  const handleBatchTrash = async () => {
    for (const id of selectedIds) {
      await literaturePapersApi.moveToTrash(id).catch(console.error);
    }
    setSelectedIds(new Set());
    loadPapers();
  };

  const handleBatchRestore = async () => {
    for (const id of selectedIds) {
      await literaturePapersApi.restoreFromTrash(id).catch(console.error);
    }
    setSelectedIds(new Set());
    loadPapers();
  };

  const handleBatchExtract = async () => {
    const targetPapers = selectedIds.size > 0
      ? filteredPapers.filter(p => selectedIds.has(p.id))
      : filteredPapers.filter(p => !p.extracted_data && p.processing_status !== 'processing');

    if (targetPapers.length === 0) return;

    setExtractingBatch(true);
    const service = createAIExtractionService();
    const aiConfig = readAIProviderConfig();

    for (const paper of targetPapers) {
      try {
        // Try text extraction first if text exists and mode allows it
        const useVision = extractMode === 'vision' || (extractMode === 'auto' && (!paper.full_text || paper.full_text.length < 200));

        if (useVision && paper.storage_key) {
          // Vision mode: render pages as images
          const pdfUrl = `/uploads/${paper.storage_key}`;
          const extractedData = await smartExtract(pdfUrl, paper.full_text, undefined, aiConfig);
          if (extractedData) {
            await literaturePapersApi.update(paper.id, { extracted_data: extractedData, processing_status: 'completed' });
            continue;
          }
        }

        // Fall back to text extraction
        if (paper.full_text) {
          const { extractedData } = await service.extractWithFallback(
            paper.full_text,
            'brief',
          );
          await literaturePapersApi.update(paper.id, { extracted_data: extractedData, processing_status: 'completed' });
        }
      } catch (err) {
        console.error(`AI extraction failed for ${paper.title}:`, err);
        await literaturePapersApi.update(paper.id, { error_message: err instanceof Error ? err.message : 'Extraction failed' });
      }
    }

    setExtractingBatch(false);
    loadPapers();
  };

  const handleSingleExtract = async (paperId: string) => {
    setExtractingSingle(prev => new Set(prev).add(paperId));
    const paper = litPapers.find(p => p.id === paperId);
    if (!paper) return;

    try {
      const aiConfig = readAIProviderConfig();
      const useVision = extractMode === 'vision' || (extractMode === 'auto' && (!paper.full_text || paper.full_text.length < 200));

      if (useVision && paper.storage_key) {
        const pdfUrl = `/uploads/${paper.storage_key}`;
        const extractedData = await smartExtract(pdfUrl, paper.full_text, undefined, aiConfig);
        if (extractedData) {
          await literaturePapersApi.update(paper.id, { extracted_data: extractedData, processing_status: 'completed' });
        }
      } else if (paper.full_text) {
        const service = createAIExtractionService();
        const { extractedData } = await service.extractWithFallback(
          paper.full_text,
          'brief',
        );
        await literaturePapersApi.update(paper.id, { extracted_data: extractedData, processing_status: 'completed' });
      }
      loadPapers();
    } catch (err) {
      console.error(`AI extraction failed for ${paperId}:`, err);
      await literaturePapersApi.update(paper.id, { error_message: err instanceof Error ? err.message : 'Extraction failed' }).catch(() => {});
    } finally {
      setExtractingSingle(prev => { const n = new Set(prev); n.delete(paperId); return n; });
    }
  };

  const filteredPapers = litPapers.filter(p => {
    if (filterCitationIds.size > 0 && (!p.citation_item_id || !filterCitationIds.has(p.citation_item_id))) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (p.title || '').toLowerCase().includes(q)
      || (p.authors || '').toLowerCase().includes(q)
      || (p.abstract || '').toLowerCase().includes(q);
  });

  const customFieldColumns = litCustomFields.map(f => ({ id: f.id, name: f.name }));

  // Column resize handlers
  const startColResize = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { col, startX: e.clientX, startW: columnWidths[col] || 160 };
    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const newW = Math.max(40, dragRef.current.startW + dx);
      setColumnWidths(prev => ({ ...prev, [dragRef.current!.col]: newW }));
    };
    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [columnWidths]);

  // Row resize handlers
  const startRowResize = useCallback((paperId: string, e: React.MouseEvent) => {
    e.preventDefault();
    const currentH = rowHeights[paperId] || 0;
    rowDragRef.current = { paperId, startY: e.clientY, startH: currentH };
    const handleMouseMove = (ev: MouseEvent) => {
      if (!rowDragRef.current) return;
      const dy = ev.clientY - rowDragRef.current.startY;
      const newH = Math.max(80, rowDragRef.current.startH + dy);
      setRowHeights(prev => ({ ...prev, [rowDragRef.current!.paperId]: newH }));
    };
    const handleMouseUp = () => {
      rowDragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [rowHeights]);

  const toggleExpandCell = (cellKey: string) => {
    setExpandedCells(prev => {
      const next = new Set(prev);
      if (next.has(cellKey)) next.delete(cellKey); else next.add(cellKey);
      return next;
    });
  };

  // Helpers for cell rendering
  const renderExtractedCell = (paper: LiteraturePaper, field: keyof ExtractedData | string) => {
    const extracted = paper.extracted_data as Record<string, unknown> | undefined;
    const raw = extracted?.[field];
    const text = typeof raw === 'string' ? raw : undefined;
    if (!text || text === 'Not mentioned') {
      return <span className="text-muted" style={{ fontSize: '0.75rem' }}>—</span>;
    }
    const cellKey = `${paper.id}:${field}`;
    const isExpanded = expandedCells.has(cellKey);
    const lineCount = text.split('\n').length;
    const hasMore = lineCount > 3 || text.length > 200;
    return (
      <div>
        <div className={`lit-cell-content ${isExpanded ? 'expanded' : ''}`}>
          {text.split('\n').map((line, i) => <p key={i}>{line}</p>)}
        </div>
        {hasMore && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: '0.7rem', padding: '2px 4px', marginTop: 2 }}
            onClick={(e) => { e.stopPropagation(); toggleExpandCell(cellKey); }}
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Filter bar */}
      <div className="lit-filter-bar">
        <input
          type="text"
          placeholder="Search papers..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ flex: 1, minWidth: 150 }}
        />
        <AIStatusIndicator />
        <button
          className={`btn btn-sm ${view === 'library' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => { setView('library'); setSelectedIds(new Set()); }}
        >Library</button>
        <button
          className={`btn btn-sm ${view === 'trash' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => { setView('trash'); setSelectedIds(new Set()); }}
        >Trash</button>
        {view === 'trash' && selectedIds.size > 0 && (
          <button className="btn btn-sm" onClick={handleBatchRestore}>Restore Selected</button>
        )}
        {view === 'library' && selectedIds.size > 0 && (
          <button className="btn btn-sm btn-danger" onClick={handleBatchTrash}>Move to Trash</button>
        )}
        {view === 'library' && (
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-sm"
              onClick={() => setShowExtractMenu(!showExtractMenu)}
              disabled={extractingBatch}
              title="Run AI extraction on selected papers, or all unextracted papers if none selected"
              style={{ fontSize: '0.78rem' }}
            >
              {extractingBatch ? 'Extracting...' : `AI ${extractMode === 'vision' ? '👁' : extractMode === 'auto' ? '⚡' : '📝'}`}
            </button>
            {showExtractMenu && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, zIndex: 100,
                background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                minWidth: 160, padding: '0.25rem',
              }}>
                <button className="btn btn-ghost btn-sm" style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: '0.78rem' }}
                  onClick={() => { setExtractMode('auto'); setShowExtractMenu(false); handleBatchExtract(); }}>
                  ⚡ Auto (text or vision)
                </button>
                <button className="btn btn-ghost btn-sm" style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: '0.78rem' }}
                  onClick={() => { setExtractMode('text'); setShowExtractMenu(false); handleBatchExtract(); }}>
                  📝 Text only
                </button>
                <button className="btn btn-ghost btn-sm" style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: '0.78rem' }}
                  onClick={() => { setExtractMode('vision'); setShowExtractMenu(false); handleBatchExtract(); }}>
                  👁 Vision (page images)
                </button>
              </div>
            )}
          </div>
        )}
        {view === 'library' && readingLists.length > 0 && (
          <select
            value={filterReadingListId || ''}
            onChange={e => setFilterReadingListId(e.target.value || null)}
            style={{ maxWidth: 180, fontSize: '0.78rem', padding: '0.2rem 0.375rem' }}
          >
            <option value="">All Papers</option>
            {readingLists.map((rl: any) => (
              <option key={rl.id} value={rl.id}>{rl.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="lit-table-container" ref={tableRef}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleFileDrop}
      >
        {filteredPapers.length === 0 && !isUploading ? (
          <div className="lit-upload-zone" style={{ margin: '1rem' }}
            onDragOver={e => e.preventDefault()}
          >
            <h3>{view === 'trash' ? 'Trash is empty' : 'No papers yet'}</h3>
            {view === 'library' && (
              <>
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', margin: '0.5rem 0' }}>
                  Drop PDF files here or click to browse
                </p>
                <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
                  Upload PDFs
                  <input type="file" accept=".pdf" multiple onChange={handleFileSelect} style={{ display: 'none' }} />
                </label>
              </>
            )}
          </div>
        ) : (
          <table className="lit-table">
            <thead>
              <tr>
                <th style={{ width: columnWidths.checkbox, cursor: 'pointer' }}>
                  <input type="checkbox" checked={selectedIds.size === filteredPapers.length && filteredPapers.length > 0}
                    onChange={selectAll} />
                  <div className="resize-handle" onMouseDown={(e) => startColResize('checkbox', e)} />
                </th>
                <th style={{ width: columnWidths.title }}>
                  Title
                  <div className="resize-handle" onMouseDown={(e) => startColResize('title', e)} />
                </th>
                <th style={{ width: columnWidths.authors }}>
                  Authors
                  <div className="resize-handle" onMouseDown={(e) => startColResize('authors', e)} />
                </th>
                <th style={{ width: columnWidths.year }}>
                  Year
                  <div className="resize-handle" onMouseDown={(e) => startColResize('year', e)} />
                </th>
                <th style={{ width: columnWidths.status }}>
                  Status
                  <div className="resize-handle" onMouseDown={(e) => startColResize('status', e)} />
                </th>
                <th style={{ width: columnWidths.importance }}>
                  Importance
                  <div className="resize-handle" onMouseDown={(e) => startColResize('importance', e)} />
                </th>
                {visibleColumns.filter(f => !f.startsWith('custom_')).map(field => (
                  <th key={field} style={{ width: columnWidths[field] || 160 }}>
                    {FIELD_LABELS[field] || field}
                    <div className="resize-handle" onMouseDown={(e) => startColResize(field, e)} />
                  </th>
                ))}
                {customFieldColumns.filter(col => visibleColumns.includes(col.id)).map(col => (
                  <th key={col.id} style={{ width: 160 }}>
                    {col.name}
                    <div className="resize-handle" onMouseDown={(e) => startColResize(col.id, e)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isUploading && (
                <tr><td colSpan={99}><div className="lit-progress-bar"><div className="fill" style={{ width: '60%' }} /></div></td></tr>
              )}
              {filteredPapers.map(paper => {
                const rowH = rowHeights[paper.id];
                return (
                  <tr key={paper.id} className="lit-row-resizable" style={rowH ? { height: rowH } : undefined}
                    onMouseDown={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const bottomDist = rect.bottom - e.clientY;
                      if (bottomDist <= 6) startRowResize(paper.id, e);
                    }}>
                    <td className="lit-row-checkbox">
                      <input type="checkbox" checked={selectedIds.has(paper.id)} onChange={() => toggleSelect(paper.id)} />
                    </td>
                    <td>
                      <span
                        style={{ cursor: 'pointer', color: 'var(--color-primary)', fontWeight: 500, fontSize: '0.82rem' }}
                        onClick={() => selectLitPaper(paper.id)}
                      >
                        {paper.title || paper.file_name.replace('.pdf', '')}
                      </span>
                      {paper.citation_item_id && (
                        <span style={{
                          fontSize: '0.6rem', marginLeft: '0.375rem', padding: '0.1rem 0.3rem',
                          borderRadius: '3px', background: '#e8f4fd', color: '#0369a1',
                          fontWeight: 500, verticalAlign: 'middle',
                        }}>
                          Zotero
                        </span>
                      )}
                      {paper.error_message && !paper.extracted_data && (
                        <span className="lit-extraction-error" title={paper.error_message}>
                          <span className="text-muted" style={{ fontSize: '0.7rem', marginLeft: '0.5rem', color: '#e74c3c' }}>
                            Extraction failed
                          </span>
                        </span>
                      )}
                      {!paper.extracted_data && paper.full_text && (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '0.65rem', marginLeft: '0.25rem', padding: '0 0.25rem' }}
                          onClick={(e) => { e.stopPropagation(); handleSingleExtract(paper.id); }}
                          disabled={extractingSingle.has(paper.id)}
                          title="Extract AI summary"
                        >
                          {extractingSingle.has(paper.id) ? '...' : 'Extract'}
                        </button>
                      )}
                    </td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
                      {formatAuthorsAPA(paper.authors)}
                    </td>
                    <td style={{ fontSize: '0.78rem' }}>{paper.year || '—'}</td>
                    <td>
                      <span
                        onClick={(e) => {{
                          e.stopPropagation();
                          const cycle = ['unread','reading','read','reviewed'];
                          const current = paper.reading_status || 'unread';
                          const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
                          literaturePapersApi.update(paper.id, {{ reading_status: next }}).then(() => loadPapers());
                        }}}
                        style={{
                          display: 'inline-block', padding: '0.1rem 0.4rem', borderRadius: '10px',
                          fontSize: '0.7rem', fontWeight: 500, cursor: 'pointer',
                          background: (() => {{
                            const colors = {{ unread: '#f1f5f9', reading: '#eff6ff', read: '#f0fdf4', reviewed: '#f5f3ff' }};
                            return colors[paper.reading_status as keyof typeof colors] || colors.unread;
                          }})(),
                          color: (() => {{
                            const colors = {{ unread: '#64748b', reading: '#2563eb', read: '#16a34a', reviewed: '#7c3aed' }};
                            return colors[paper.reading_status as keyof typeof colors] || colors.unread;
                          }})(),
                        }}
                        title="Click to cycle: Unread → Reading → Read → Reviewed"
                      >
                        {({ unread: 'Unread', reading: 'Reading', read: 'Read', reviewed: 'Reviewed' })[paper.reading_status || 'unread'] || 'Unread'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                      {[1,2,3,4,5].map(n => (
                        <span
                          key={n}
                          onClick={(e) => {{
                            e.stopPropagation();
                            const val = n === (paper.importance || 0) ? 0 : n;
                            literaturePapersApi.update(paper.id, {{ importance: val }}).then(() => loadPapers());
                          }}}
                          style={{{
                            cursor: 'pointer',
                            color: n <= (paper.importance || 0) ? '#f59e0b' : 'var(--color-border)',
                            transition: 'color 0.1s',
                          }}}
                        >
                          ★
                        </span>
                      ))}
                    </td>
                    {visibleColumns.filter(f => !f.startsWith('custom_')).map(field => (
                      <td key={field}>{renderExtractedCell(paper, field)}</td>
                    ))}
                    {customFieldColumns.filter(col => visibleColumns.includes(col.id)).map(col => (
                      <td key={col.id}>{renderExtractedCell(paper, col.id)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>



      {/* AI Settings dialog */}
      {showSettings && (
        <AISettingsPanel
          onClose={() => setShowSettings(false)}
          onSave={() => {}}
        />
      )}

      {/* Column Config dialog */}
      {showColumnConfig && (
        <ColumnConfigDialog
          onClose={() => setShowColumnConfig(false)}
          onSave={() => setVisibleColumns(getVisibleColumnKeys())}
        />
      )}
    </div>
  );
}
