import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { literaturePapersApi } from '../../lib/literature-api';
import { useLiteratureFileUpload } from '../../hooks/useLiteratureFileUpload';
import PaperDetailView from './PaperDetailView';
import AIStatusIndicator from './AIStatusIndicator';
import type { LiteraturePaper, ExtractedData } from '../../types';

const FIELD_LABELS: Record<keyof ExtractedData, string> = {
  background: 'Background', theory: 'Theory', methodology: 'Methodology',
  measures: 'Measures', results: 'Results', implications: 'Implications', limitations: 'Limitations',
  customFields: 'Custom Fields',
};

const FIXED_COLUMNS = ['title', 'authors', 'year'] as const;
const EXTRACTED_COLUMNS: (keyof ExtractedData)[] = [
  'background', 'theory', 'methodology', 'measures', 'results', 'implications', 'limitations'
];

interface ColumnWidths {
  checkbox: number;
  title: number;
  authors: number;
  year: number;
  [key: string]: number;
}

const DEFAULT_WIDTHS: ColumnWidths = {
  checkbox: 36, title: 200, authors: 160, year: 60,
  background: 180, theory: 180, methodology: 180, measures: 180,
  results: 180, implications: 180, limitations: 180,
};

function formatAuthorsAPA(authors?: string): string {
  if (!authors) return '';
  return authors.split(';').map(a => {
    const parts = a.trim().split(/\s+/);
    if (parts.length >= 2) {
      const surname = parts.slice(1).join(' ');
      return `${surname}, ${parts[0][0]}.`;
    }
    return a.trim();
  }).join('; ');
}

export default function SummaryTable({ projectId }: { projectId: string }) {
  const { litPapers, setLitPapers, litCustomFields } = useStore();
  const { uploadFiles, isUploading } = useLiteratureFileUpload();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailPaperId, setDetailPaperId] = useState<string | null>(null);
  const [view, setView] = useState<'library' | 'trash'>('library');
  const [searchQuery, setSearchQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => {
    const saved = localStorage.getItem('lit-column-widths');
    return saved ? { ...DEFAULT_WIDTHS, ...JSON.parse(saved) } : DEFAULT_WIDTHS;
  });
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('lit-column-widths', JSON.stringify(columnWidths));
  }, [columnWidths]);

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

  const filteredPapers = litPapers.filter(p => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (p.title || '').toLowerCase().includes(q)
      || (p.authors || '').toLowerCase().includes(q)
      || (p.abstract || '').toLowerCase().includes(q);
  });

  const customFieldNames = litCustomFields.map(f => f.name);

  // Helpers for cell rendering
  const renderExtractedCell = (paper: LiteraturePaper, field: keyof ExtractedData | string) => {
    const extracted = paper.extracted_data as Record<string, unknown> | undefined;
    const raw = extracted?.[field];
    const text = typeof raw === 'string' ? raw : undefined;
    if (!text || text === 'Not mentioned') {
      return <span className="text-muted" style={{ fontSize: '0.75rem' }}>—</span>;
    }
    return (
      <div className="lit-cell-content">
        {text.split('\n').map((line, i) => <p key={i}>{line}</p>)}
      </div>
    );
  };

  const allColumns = [...EXTRACTED_COLUMNS, ...customFieldNames.map(n => n.toLowerCase().replace(/\s+/g, '_'))];

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
                </th>
                <th style={{ width: columnWidths.title }}>Title</th>
                <th style={{ width: columnWidths.authors }}>Authors</th>
                <th style={{ width: columnWidths.year }}>Year</th>
                {EXTRACTED_COLUMNS.map(field => (
                  <th key={field} style={{ width: columnWidths[field] }}>
                    {FIELD_LABELS[field]}
                  </th>
                ))}
                {customFieldNames.map(name => (
                  <th key={name} style={{ width: 160 }}>{name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isUploading && (
                <tr><td colSpan={99}><div className="lit-progress-bar"><div className="fill" style={{ width: '60%' }} /></div></td></tr>
              )}
              {filteredPapers.map(paper => (
                <tr key={paper.id}>
                  <td className="lit-row-checkbox">
                    <input type="checkbox" checked={selectedIds.has(paper.id)} onChange={() => toggleSelect(paper.id)} />
                  </td>
                  <td>
                    <span
                      style={{ cursor: 'pointer', color: 'var(--color-primary)', fontWeight: 500, fontSize: '0.82rem' }}
                      onClick={() => setDetailPaperId(paper.id)}
                    >
                      {paper.title || paper.file_name.replace('.pdf', '')}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
                    {formatAuthorsAPA(paper.authors)}
                  </td>
                  <td style={{ fontSize: '0.78rem' }}>{paper.year || '—'}</td>
                  {EXTRACTED_COLUMNS.map(field => (
                    <td key={field}>{renderExtractedCell(paper, field)}</td>
                  ))}
                  {customFieldNames.map(name => {
                    const key = name.toLowerCase().replace(/\s+/g, '_');
                    return <td key={name}>{renderExtractedCell(paper, key)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail modal */}
      {detailPaperId && (
        <PaperDetailView
          paper={litPapers.find(p => p.id === detailPaperId) || null}
          onClose={() => setDetailPaperId(null)}
          projectId={projectId}
          onUpdated={loadPapers}
        />
      )}
    </div>
  );
}
