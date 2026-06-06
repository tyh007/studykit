import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { zoteroApi, readingListsApi, literatureProjectsApi, literaturePapersApi } from '../../lib/literature-api';
import { createAIExtractionService } from '../../lib/literature/ai-extraction';
import { readAIProviderConfig } from '../../lib/literature/ai-provider-config';

export default function ZoteroImportPanel() {
  const {
    zoteroConnectionStatus,
    readingLists, setReadingLists,
    setActiveLiteratureTab,
    selectedLitProjectId, setLitProjects, selectLitProject, setLitPapers,
  } = useStore();

  const [expanded, setExpanded] = useState(false);
  const [collections, setCollections] = useState<any[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importingItems, setImportingItems] = useState<Set<string>>(new Set());
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [extractingPapers, setExtractingPapers] = useState(false);

  useEffect(() => {
    if (zoteroConnectionStatus === 'connected') {
      readingListsApi.list().then(setReadingLists).catch(console.error);
    }
  }, [zoteroConnectionStatus]);

  if (zoteroConnectionStatus !== 'connected') return null;

  const handleFetchCollections = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await zoteroApi.listCollections();
      setCollections(result.collections || []);
      setExpanded(true);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch collections');
    } finally {
      setLoading(false);
    }
  };

  const handleImportCollections = async () => {
    if (selectedCollections.size === 0) return;
    setImporting(true);
    setError(null);
    try {
      const result = await zoteroApi.importCollections({
        collectionIds: Array.from(selectedCollections),
      });
      // Refresh reading lists
      const lists = await readingListsApi.list();
      setReadingLists(lists);
      setSelectedCollections(new Set());
      setCollections([]);
      setExpanded(false);
    } catch (err: any) {
      setError(err.message || 'Failed to import collections');
    } finally {
      setImporting(false);
    }
  };

  const handleImportItems = async (collectionId: string) => {
    setImportingItems((prev) => new Set(prev).add(collectionId));
    setError(null);
    setImportSuccess(null);
    try {
      const result = await zoteroApi.importCollectionItems({
        readingListId: collectionId,
        projectId: selectedLitProjectId || undefined,
      });
      // Refresh reading lists to update item counts
      const lists = await readingListsApi.list();
      setReadingLists(lists);
      // Refresh literature projects (new one may have been auto-created)
      const projects = await literatureProjectsApi.list();
      setLitProjects(projects);
      // If a projectId was returned and no project was selected, select it
      const usedProjectId = (result as any)?.projectId;
      if (usedProjectId && !selectedLitProjectId) {
        selectLitProject(usedProjectId);
      }
      // Refresh papers for the current project
      if (selectedLitProjectId || usedProjectId) {
        try {
          const papers = await literaturePapersApi.list(selectedLitProjectId || usedProjectId);
          setLitPapers(papers);
        } catch { /* ignore if no papers yet */ }
      }
      // Show success and navigate to papers tab
      const count = (result as any)?.importedCount || 0;
      setImportSuccess(`Imported ${count} item(s)`);
      if (!importSuccess) {
        setActiveLiteratureTab('papers');
        setTimeout(() => setImportSuccess(null), 4000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to import items');
    } finally {
      setImportingItems((prev) => {
        const next = new Set(prev);
        next.delete(collectionId);
        return next;
      });
    }
  };

  const handleImportAndExtract = async (collectionId: string) => {
    setImportingItems((prev) => new Set(prev).add(collectionId));
    setError(null);
    setImportSuccess(null);
    try {
      // Step 1: Import items from Zotero
      const result = await zoteroApi.importCollectionItems({
        readingListId: collectionId,
        projectId: selectedLitProjectId || undefined,
      });
      const lists = await readingListsApi.list();
      setReadingLists(lists);
      const projects = await literatureProjectsApi.list();
      setLitProjects(projects);
      const usedProjectId = (result as any)?.projectId;
      if (usedProjectId && !selectedLitProjectId) {
        selectLitProject(usedProjectId);
      }

      // Step 2: Get the papers that were imported and run extraction
      const targetProjectId = selectedLitProjectId || usedProjectId;
      if (targetProjectId) {
        const papers = await literaturePapersApi.list(targetProjectId);
        setLitPapers(papers);
        setActiveLiteratureTab('papers');

        // Extract unextracted papers
        const unextracted = papers.filter((p: any) => !p.extracted_data && p.full_text);
        if (unextracted.length > 0) {
          setExtractingPapers(true);
          const service = createAIExtractionService();
          for (const paper of unextracted) {
            try {
              const { extractedData } = await service.extractWithFallback(paper.full_text!, 'brief');
              await literaturePapersApi.update(paper.id, { extracted_data: extractedData, processing_status: 'completed' });
            } catch (err) {
              console.error('Extraction failed for', paper.title, err);
            }
          }
          // Reload papers after extraction
          const updatedPapers = await literaturePapersApi.list(targetProjectId);
          setLitPapers(updatedPapers);
        }
      }

      const count = (result as any)?.importedCount || 0;
      setImportSuccess(`Imported & extracted ${count} item(s)`);
      setTimeout(() => setImportSuccess(null), 5000);
    } catch (err: any) {
      setError(err.message || 'Failed to import items');
    } finally {
      setImportingItems((prev) => {
        const next = new Set(prev);
        next.delete(collectionId);
        return next;
      });
      setExtractingPapers(false);
    }
  };

  const toggleCollection = (key: string) => {
    setSelectedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="zotero-import-panel" style={{ padding: '0.25rem 0.5rem 0.5rem', borderBottom: '1px solid var(--color-border)' }}>
      {/* Import collections button */}
      {!expanded ? (
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleFetchCollections}
          disabled={loading}
          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', width: '100%', textAlign: 'left' }}
        >
          {loading ? 'Loading...' : '📂 Import Zotero Collections'}
        </button>
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Zotero Collections</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setExpanded(false); setCollections([]); setError(null); }}
              style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem' }}
            >
              ✕
            </button>
          </div>

          {error && (
            <div style={{ fontSize: '0.7rem', color: 'var(--color-danger)', marginBottom: '0.25rem' }}>
              {error}
            </div>
          )}

          {collections.length === 0 && loading ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', padding: '0.25rem 0' }}>
              Loading collections...
            </div>
          ) : collections.length === 0 ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', padding: '0.25rem 0' }}>
              No collections found
            </div>
          ) : (
            <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: '0.25rem' }}>
              {collections.map((col: any) => (
                <label
                  key={col.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    padding: '0.2rem 0.25rem',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedCollections.has(col.key)}
                    onChange={() => toggleCollection(col.key)}
                    style={{ margin: 0 }}
                  />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {col.data?.name || 'Untitled'}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleImportCollections}
              disabled={importing || selectedCollections.size === 0}
              style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem' }}
            >
              {importing ? 'Importing...' : `Import (${selectedCollections.size})`}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleFetchCollections}
              disabled={loading}
              style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem' }}
            >
              Refresh
            </button>
          </div>
        </div>
      )}

      {/* Reading lists section */}
      {readingLists.length > 0 && (
        <div style={{ marginTop: '0.375rem' }}>
          {/* Show import errors even when collections panel is collapsed */}
          {error && !expanded && (
            <div style={{ fontSize: '0.7rem', color: 'var(--color-danger)', marginBottom: '0.25rem', padding: '0.125rem 0' }}>
              {error}
            </div>
          )}
          {/* Show success message */}
          {extractingPapers && (
            <div style={{ fontSize: '0.7rem', color: 'var(--color-primary)', marginBottom: '0.25rem', padding: '0.125rem 0', fontStyle: 'italic' }}>
              Extracting AI summaries...
            </div>
          )}
          {importSuccess && (
            <div style={{ fontSize: '0.7rem', color: 'var(--color-success, #16a34a)', marginBottom: '0.25rem', padding: '0.125rem 0' }}>
              {importSuccess}
            </div>
          )}
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '0.125rem' }}>
            Reading Lists ({readingLists.length})
          </div>
          {readingLists.map((list: any) => (
            <div
              key={list.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.2rem 0.25rem',
                fontSize: '0.75rem',
              }}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <button
                  onClick={() => setActiveLiteratureTab('readingLists')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-text)',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: '0.75rem',
                    textAlign: 'left',
                  }}
                  title={`View "${list.name}" reading list`}
                >
                  {list.name}
                  <span style={{ color: 'var(--color-text-muted)', marginLeft: '0.25rem' }}>
                    ({list.item_count || 0})
                  </span>
                </button>
              </span>
              <div style={{ display: 'flex', gap: '0.125rem' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleImportItems(list.id)}
                  disabled={importingItems.has(list.id)}
                  style={{ fontSize: '0.65rem', padding: '0.125rem 0.25rem' }}
                  title="Import items"
                >
                  {importingItems.has(list.id) ? (list.item_count ? '...' : '...') : '↓'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleImportAndExtract(list.id)}
                  disabled={importingItems.has(list.id)}
                  style={{ fontSize: '0.65rem', padding: '0.125rem 0.25rem', color: 'var(--color-primary)' }}
                  title="Import items and run AI extraction"
                >
                  {importingItems.has(list.id) ? '...' : 'AI+'}
                </button>
              </div>
            </div>
          ))}

          {/* Quick nav to papers tab */}
          <div style={{ marginTop: '0.25rem' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setActiveLiteratureTab('papers')}
              style={{ fontSize: '0.65rem', padding: '0.125rem 0.25rem', width: '100%', textAlign: 'left' }}
            >
              View All Papers
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
