import React, { useState, useEffect, useCallback } from 'react';
import { citationsApi } from '../../lib/literature-api';
import { useStore } from '../../store/useStore';

export default function CitationListView() {
  const { setActiveLiteratureTab } = useStore();
  const [citations, setCitations] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const loadCitations = useCallback(async (query?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await citationsApi.list(query ? { search: query } : undefined);
      setCitations(result || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load citations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCitations();
  }, [loadCitations]);

  useEffect(() => {
    if (search.length === 0) {
      loadCitations();
      return;
    }
    const timer = setTimeout(() => loadCitations(search), 300);
    return () => clearTimeout(timer);
  }, [search, loadCitations]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this citation?')) return;
    setDeleting((prev) => new Set(prev).add(id));
    try {
      await citationsApi.delete(id);
      setCitations((prev) => prev.filter((c) => c.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (err: any) {
      setError(err.message || 'Failed to delete citation');
    } finally {
      setDeleting((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const formatAuthors = (creators: any) => {
    const arr = typeof creators === 'string' ? JSON.parse(creators) : creators || [];
    return arr.map((c: any) => c.lastName || c.name || '').filter(Boolean).join(', ');
  };

  const parseTags = (tags: any) => {
    if (!tags) return [];
    if (typeof tags === 'string') return JSON.parse(tags);
    return Array.isArray(tags) ? tags : [];
  };

  const selected = citations.find((c) => c.id === selectedId);

  return (
    <div style={{ padding: '1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Citations</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn btn-sm"
            onClick={() => loadCitations(search)}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: '0.75rem' }}>
        <input
          placeholder="Search citations by title, author, or abstract..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            fontSize: '0.85rem',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {error && (
        <div style={{ padding: '0.5rem', marginBottom: '0.75rem', background: 'var(--color-danger-bg, #fef2f2)', color: 'var(--color-danger)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}>
          {error}
          <button
            style={{ marginLeft: '0.5rem', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {loading && citations.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Loading citations...</div>
      ) : citations.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          {search ? 'No citations match your search.' : 'No citations yet. Import from Zotero or create one manually.'}
          {!search && (
            <div style={{ marginTop: '0.5rem' }}>
              <button className="btn btn-sm" onClick={() => setActiveLiteratureTab('readingLists')}>
                Go to Reading Lists
              </button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '1rem' }}>
          {/* Citation table */}
          <div style={{ flex: selectedId ? 1 : 1, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Title</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Authors</th>
                  <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', fontWeight: 600, whiteSpace: 'nowrap', width: 60 }}>Year</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, whiteSpace: 'nowrap', width: 120 }}>Type</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, whiteSpace: 'nowrap', width: 80 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {citations.map((cit) => (
                  <tr
                    key={cit.id}
                    onClick={() => setSelectedId(selectedId === cit.id ? null : cit.id)}
                    style={{
                      borderBottom: '1px solid var(--color-border-light)',
                      cursor: 'pointer',
                      background: selectedId === cit.id ? 'var(--color-bg-secondary)' : undefined,
                    }}
                    onMouseEnter={(e) => { if (selectedId !== cit.id) e.currentTarget.style.background = 'var(--color-bg-secondary)'; }}
                    onMouseLeave={(e) => { if (selectedId !== cit.id) e.currentTarget.style.background = ''; }}
                  >
                    <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>{cit.title}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--color-text-secondary)', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatAuthors(cit.creators_json)}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>{cit.issued_year || '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--color-text-secondary)' }}>{cit.item_type || '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem', color: 'var(--color-danger)' }}
                        onClick={(e) => { e.stopPropagation(); handleDelete(cit.id); }}
                        disabled={deleting.has(cit.id)}
                      >
                        {deleting.has(cit.id) ? '...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Detail panel */}
          {selected && (
            <div style={{
              width: 320,
              flexShrink: 0,
              padding: '1rem',
              background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              border: '1px solid var(--color-border)',
              alignSelf: 'flex-start',
              position: 'sticky',
              top: '1rem',
            }}>
              <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.95rem' }}>{selected.title}</div>

              {formatAuthors(selected.creators_json) && (
                <div style={{ marginBottom: '0.375rem' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>Authors</span>
                  <div>{formatAuthors(selected.creators_json)}</div>
                </div>
              )}

              {selected.issued_year && (
                <div style={{ marginBottom: '0.375rem' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>Year</span>
                  <div>{selected.issued_year}</div>
                </div>
              )}

              {selected.item_type && (
                <div style={{ marginBottom: '0.375rem' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>Type</span>
                  <div>{selected.item_type}</div>
                </div>
              )}

              {selected.publisher && (
                <div style={{ marginBottom: '0.375rem' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>Publisher</span>
                  <div>{selected.publisher}</div>
                </div>
              )}

              {selected.doi && (
                <div style={{ marginBottom: '0.375rem' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>DOI</span>
                  <div>
                    <a href={`https://doi.org/${selected.doi}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)' }}>
                      {selected.doi}
                    </a>
                  </div>
                </div>
              )}

              {selected.url && (
                <div style={{ marginBottom: '0.375rem' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>URL</span>
                  <div><a href={selected.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', wordBreak: 'break-all' }}>{selected.url}</a></div>
                </div>
              )}

              {selected.citekey && (
                <div style={{ marginBottom: '0.375rem' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>Citekey</span>
                  <div style={{ fontFamily: 'monospace' }}>{selected.citekey}</div>
                </div>
              )}

              {selected.abstract && (
                <div style={{ marginBottom: '0.375rem' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>Abstract</span>
                  <div style={{ fontSize: '0.8rem', lineHeight: 1.4, maxHeight: 150, overflowY: 'auto' }}>{selected.abstract}</div>
                </div>
              )}

              {parseTags(selected.tags_json).length > 0 && (
                <div style={{ marginBottom: '0.375rem' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>Tags</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.125rem' }}>
                    {parseTags(selected.tags_json).map((tag: string, i: number) => (
                      <span key={i} style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>{tag}</span>
                    ))}
                  </div>
                </div>
              )}

              {selected.provider && (
                <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--color-border)', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  Source: {selected.provider}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
