import React, { useState, useEffect, useCallback } from 'react';
import { readingListsApi } from '../../lib/literature-api';
import { useStore } from '../../store/useStore';
import { extractPapersBatch } from '../../lib/literature/extract-batch';

export default function ReadingListsView() {
  const { readingLists, setReadingLists, litPapers } = useStore();
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [listDetail, setListDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [extractingAll, setExtractingAll] = useState(false);

  const loadLists = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const lists = await readingListsApi.list();
      setReadingLists(lists || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load reading lists');
    } finally {
      setLoading(false);
    }
  }, [setReadingLists]);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  const handleExtractAll = async () => {
    if (!listDetail?.items || listDetail.items.length === 0) return;
    setExtractingAll(true);
    try {
      // Find which papers belong to this reading list by citation_item_id,
      // then keep only the ones we haven't extracted yet. litPapers comes
      // from the store and is already scoped to the current project.
      const citationIds = new Set<string>(
        (listDetail.items as any[])
          .map((item) => item.citation_item_id)
          .filter((id): id is string => Boolean(id))
      );
      const targetPapers = litPapers.filter(
        (p) => p.citation_item_id && citationIds.has(p.citation_item_id)
      );
      const unextracted = targetPapers.filter((p) => !p.extracted_data && p.full_text);
      if (unextracted.length === 0) return;
      await extractPapersBatch(unextracted, { mode: 'auto' });
    } catch (err: any) {
      console.error('Extract All failed:', err);
    } finally {
      setExtractingAll(false);
    }
  };

  useEffect(() => {
    if (!selectedListId) { setListDetail(null); return; }
    setLoadingDetail(true);
    readingListsApi.get(selectedListId)
      .then((data) => setListDetail(data))
      .catch((err) => setError(err.message || 'Failed to load list details'))
      .finally(() => setLoadingDetail(false));
  }, [selectedListId]);

  const handleRemoveItem = async (itemId: string, readingListId: string) => {
    setRemoving((prev) => new Set(prev).add(itemId));
    try {
      await readingListsApi.removeItem(readingListId, itemId);
      setListDetail((prev: any) => prev ? { ...prev, items: prev.items.filter((i: any) => i.item_id !== itemId) } : null);
    } catch (err: any) {
      setError(err.message || 'Failed to remove item');
    } finally {
      setRemoving((prev) => { const n = new Set(prev); n.delete(itemId); return n; });
    }
  };

  const formatAuthors = (creators: any) => {
    const arr = typeof creators === 'string' ? JSON.parse(creators) : creators || [];
    return arr.map((c: any) => c.lastName || c.name || '').filter(Boolean).join(', ');
  };

  return (
    <div style={{ padding: '1rem', display: 'flex', gap: '1rem', height: '100%', minHeight: 400 }}>
      {/* Left: reading list list */}
      <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--color-border)', paddingRight: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Reading Lists</h2>
          <button className="btn btn-sm" onClick={loadLists} disabled={loading}>
            {loading ? '...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div style={{ padding: '0.375rem', marginBottom: '0.5rem', fontSize: '0.8rem', color: 'var(--color-danger)', background: 'var(--color-danger-bg, #fef2f2)', borderRadius: 'var(--radius-sm)' }}>
            {error}
            <button style={{ marginLeft: '0.375rem', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {readingLists.length === 0 ? (
          <div style={{ padding: '1rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            No reading lists yet. Import Zotero collections to create them.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {readingLists.map((list: any) => (
              <button
                key={list.id}
                onClick={() => setSelectedListId(list.id)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: selectedListId === list.id ? 'var(--color-bg-secondary)' : 'transparent',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => { if (selectedListId !== list.id) e.currentTarget.style.background = 'var(--color-bg-secondary)'; }}
                onMouseLeave={(e) => { if (selectedListId !== list.id) e.currentTarget.style.background = ''; }}
              >
                <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{list.name}</span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', marginLeft: '0.375rem' }}>
                  {list.item_count ?? 0}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right: list detail */}
      <div style={{ flex: 1, overflowX: 'auto' }}>
        {!selectedListId ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            Select a reading list to view its contents.
          </div>
        ) : loadingDetail ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            Loading items...
          </div>
        ) : !listDetail ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            Could not load reading list.
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{listDetail.name}</h2>
                {listDetail.description && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: '0.125rem' }}>{listDetail.description}</div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  className="btn btn-sm"
                  onClick={handleExtractAll}
                  disabled={extractingAll || !listDetail.items?.length}
                  style={{ fontSize: '0.78rem' }}
                >
                  {extractingAll ? 'Extracting...' : 'AI Extract All'}
                </button>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                  {listDetail.items?.length || 0} item(s)
                </span>
              </div>
            </div>

            {!listDetail.items || listDetail.items.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                No items in this reading list.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600 }}>Title</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600 }}>Authors</th>
                    <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', fontWeight: 600, width: 60 }}>Year</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, width: 100 }}>Type</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, width: 120 }}>Publisher</th>
                    <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', fontWeight: 600, width: 60 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {listDetail.items.map((item: any) => (
                    <tr key={item.item_id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>{item.title}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--color-text-secondary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {formatAuthors(item.creators_json)}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>{item.issued_year || '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--color-text-secondary)' }}>{item.item_type || '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--color-text-secondary)' }}>{item.publisher || '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem', color: 'var(--color-danger)' }}
                          onClick={() => handleRemoveItem(item.item_id, listDetail.id)}
                          disabled={removing.has(item.item_id)}
                        >
                          {removing.has(item.item_id) ? '...' : 'Remove'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
