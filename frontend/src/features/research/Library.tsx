/**
 * StudyKit v0.4 — `features/research/Library`
 *
 * Project-scoped Library view. The Works come from
 * the v0.4 Research repository (canonical `Work`
 * rows). All four entry paths land in the same
 * canonical list:
 *
 *   - Search Save (`saveWorkFromCandidate`)
 *   - Local PDF import (`importLocalPdf`)
 *   - Zotero import (`importFromZotero`)
 *   - Legacy `LiteraturePaper` rows (auto-lifted
 *     when the user opens the Library; the legacy
 *     paper id is the `linked-file` WorkAsset `ref`)
 *
 * The Reader uses `resolveWorkReaderSource` to open
 * any of the four. The Library does NOT silently
 * duplicate the v0.3 literature library; it is the
 * single library for the project. Zotero / PDF import
 * buttons are real (they reuse the v0.3 client + the
 * `pdfAssetStore`) and gate on the workspace's
 * capabilities.
 */

import React from 'react';
import { Button } from '../../shared/ui/Button';
import { Pill } from '../../shared/ui/Pill';
import { Surface } from '../../shared/ui/Surface';
import { useResearchDeps } from './researchContext';
import { useSupports, zoteroApi } from '../../application/dataApi';
import { importAcquiredPdf, importLocalPdf, LocalPdfImportError } from '../../application/research/importLocalPdf';
import { importFromZotero } from '../../application/research/importFromZotero';
import type { ResearchProject, Work, WorkAsset } from '../../domain/research';

export interface LibraryProps {
  readonly projectId: string;
  readonly onOpenReader: (input: { projectId: string; workId: string }) => void;
  readonly onBackToProject: (projectId: string) => void;
  readonly embedded?: boolean;
  readonly requestedAction?: 'pdf' | 'zotero' | null;
  readonly onRequestedActionHandled?: () => void;
}

export function Library(props: LibraryProps): React.ReactElement {
  const deps = useResearchDeps();
  const zoteroImportCapable = useSupports('zotero.import');
  const zoteroConnectCapable = useSupports('zotero.connect');
  const canReadLegacy = useSupports('literaturePapers.list');
  const [project, setProject] = React.useState<ResearchProject | null>(null);
  const [works, setWorks] = React.useState<readonly Work[]>([]);
  const [search, setSearch] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [importError, setImportError] = React.useState<string | null>(null);
  const [zoteroOpen, setZoteroOpen] = React.useState(false);
  const [zoteroBusy, setZoteroBusy] = React.useState(false);
  const [zoteroCollections, setZoteroCollections] = React.useState<ReadonlyArray<{ id: string; name: string }>>([]);
  const [zoteroCollectionsError, setZoteroCollectionsError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Track an in-flight reload so unmount / project
  // switch doesn't call setState on a stale tree (the
  // "An update to Library inside a test was not
  // wrapped in act" warning).
  const inflightRef = React.useRef(0);
  const reload = React.useCallback(async (): Promise<void> => {
    const token = ++inflightRef.current;
    setLoading(true);
    setError(null);
    try {
      const p = await deps.repository.getProject(props.projectId);
      if (token !== inflightRef.current) return;
      setProject(p);
      const all = await deps.repository.listWorks({ projectId: props.projectId });
      if (token !== inflightRef.current) return;
      setWorks(all);
    } catch (err) {
      if (token !== inflightRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load library.');
    } finally {
      if (token === inflightRef.current) setLoading(false);
    }
  }, [deps, props.projectId]);

  React.useEffect(() => {
    void reload();
    return () => {
      inflightRef.current += 1;
    };
  }, [reload]);

  React.useEffect(() => {
    const off = deps.repository.subscribe(() => {
      void reload();
    });
    return off;
  }, [deps.repository, reload]);

  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return works;
    return works.filter(
      (w) =>
        w.title.toLowerCase().includes(needle) ||
        w.authors.some((a) => a.toLowerCase().includes(needle)) ||
        (w.identifiers.doi ?? '').toLowerCase().includes(needle),
    );
  }, [works, search]);

  const handleImportClick = (): void => {
    setImportError(null);
    if (!deps.sourceAssets) {
      fileInputRef.current?.click();
      return;
    }
    setImporting(true);
    void deps.sourceAssets.choosePdf().then(async (acquired) => {
      if (!acquired) return;
      try {
        await importAcquiredPdf(deps.repository, { projectId: props.projectId, acquired });
      } catch (error) {
        await deps.sourceAssets?.discard(acquired.assetId).catch(() => undefined);
        throw error;
      }
    }).catch((error: unknown) => {
      setImportError(error instanceof Error ? error.message : 'Failed to import PDF.');
    }).finally(() => setImporting(false));
  };

  const handleFileChosen = async (file: File): Promise<void> => {
    setImporting(true);
    setImportError(null);
    try {
      await importLocalPdf(deps.repository, {
        projectId: props.projectId,
        file,
      });
    } catch (err) {
      if (err instanceof LocalPdfImportError) {
        setImportError(`${err.code}: ${err.message}`);
      } else {
        setImportError(err instanceof Error ? err.message : 'Failed to import PDF.');
      }
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleOpenZotero = async (): Promise<void> => {
    setZoteroOpen(true);
    setZoteroCollectionsError(null);
    setZoteroBusy(true);
    try {
      // The Zotero list lives on the gateway so the
      // sync / local flavour dispatches correctly.
      // The capability is gated upstream by
      // `useSupports('zotero.import')`. In a local
      // workspace this method is wrapped to throw
      // `UnsupportedInLocalWorkspaceError`; we surface
      // the message instead of pretending success.
      const res = await zoteroApi.listCollections();
      const cols = (res as { collections?: Array<{ id: string; name: string }> }).collections ?? [];
      setZoteroCollections(
        cols.map((c) => ({ id: c.id, name: typeof c.name === 'string' ? c.name : c.id })),
      );
    } catch (err) {
      setZoteroCollectionsError(
        err instanceof Error ? err.message : 'Zotero collections unavailable.',
      );
    } finally {
      setZoteroBusy(false);
    }
  };

  const handleImportZoteroCollection = async (collectionId: string): Promise<void> => {
    setZoteroBusy(true);
    setImportError(null);
    try {
      await importFromZotero(deps.repository, {
        projectId: props.projectId,
        collectionId,
        zotero: zoteroApi as unknown as Parameters<typeof importFromZotero>[1]['zotero'],
      });
      setZoteroOpen(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Zotero import failed.');
    } finally {
      setZoteroBusy(false);
    }
  };

  React.useEffect(() => {
    if (!props.requestedAction) return;
    props.onRequestedActionHandled?.();
    if (props.requestedAction === 'pdf') handleImportClick();
    else void handleOpenZotero();
    // The request is an edge-trigger owned by Sources; handler identities are
    // deliberately excluded so a loading state cannot retrigger a file picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.requestedAction]);

  return (
    <div
      data-testid="research-library"
      data-project-id={props.projectId}
      className="research-surface research-library"
    >
      {!props.embedded ? <header className="research-header">
        <h1 className="research-h1">Library</h1>
        <Pill data-testid="research-library-project-name">{project?.name ?? '…'}</Pill>
        <span className="research-header-spacer" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => props.onBackToProject(props.projectId)}
          data-testid="research-library-back"
        >
          Back to project
        </Button>
      </header> : null}

      <div className="research-toolbar">
        <input
          data-testid="research-library-search"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          placeholder="Search title / author / DOI"
          className="research-input research-input-grow"
        />
        <Button
          variant="primary"
          size="sm"
          onClick={handleImportClick}
          disabled={importing}
          data-testid="research-library-import-pdf"
        >
          {importing ? 'Importing…' : 'Import PDF'}
        </Button>
        {zoteroImportCapable ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleOpenZotero()}
            data-testid="research-library-import-zotero"
          >
            Import from Zotero
          </Button>
        ) : !zoteroConnectCapable ? (
          <Pill data-testid="research-library-zotero-disabled">Zotero unavailable</Pill>
        ) : null}
        {!canReadLegacy ? (
          <Pill data-testid="research-library-legacy-disabled">Local only</Pill>
        ) : null}
      </div>

      {zoteroOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Zotero collections"
          data-testid="research-zotero-dialog"
          className="research-dialog-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setZoteroOpen(false);
          }}
        >
          <Surface className="research-dialog">
            <header className="research-header">
              <h2 className="research-h2">Import from Zotero</h2>
              <span className="research-header-spacer" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoteroOpen(false)}
                data-testid="research-zotero-close"
              >
                Close
              </Button>
            </header>
            {zoteroBusy ? (
              <p data-testid="research-zotero-loading">Loading collections…</p>
            ) : null}
            {zoteroCollectionsError ? (
              <p
                role="alert"
                data-testid="research-zotero-error"
                className="research-error"
              >
                {zoteroCollectionsError}
              </p>
            ) : null}
            {!zoteroBusy && zoteroCollections.length === 0 && !zoteroCollectionsError ? (
              <p data-testid="research-zotero-empty">No Zotero collections found.</p>
            ) : null}
            <ul className="research-list">
              {zoteroCollections.map((c) => (
                <li key={c.id} className="research-list-item">
                  <span>{c.name}</span>
                  <span className="research-header-spacer" />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void handleImportZoteroCollection(c.id)}
                    disabled={zoteroBusy}
                    data-testid="research-zotero-collection-import"
                    data-collection-id={c.id}
                  >
                    Import
                  </Button>
                </li>
              ))}
            </ul>
          </Surface>
        </div>
      ) : null}

      {importError ? (
        <p role="alert" data-testid="research-library-import-error" className="research-error">
          {importError}
        </p>
      ) : null}

      {loading ? (
        <p data-testid="research-library-loading" className="research-muted">
          Loading library…
        </p>
      ) : null}
      {error ? (
        <p role="alert" data-testid="research-library-error" className="research-error">
          {error}
        </p>
      ) : null}
      {!loading && filtered.length === 0 ? (
        <p data-testid="research-library-empty" className="research-muted">
          No saved sources yet. Use Add sources to search, import a PDF or Zotero collection,
          or add a DOI/URL.
        </p>
      ) : null}
      <ul className="research-list">
        {filtered.map((w) => (
          <li key={w.id}>
            <LibraryRow
              work={w}
              onOpen={() => props.onOpenReader({ projectId: props.projectId, workId: w.id })}
            />
          </li>
        ))}
      </ul>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        data-testid="research-library-file-input"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) void handleFileChosen(file);
        }}
      />
    </div>
  );
}

function LibraryRow(props: {
  readonly work: Work;
  readonly onOpen: () => void;
}): React.ReactElement {
  const deps = useResearchDeps();
  const [assets, setAssets] = React.useState<readonly WorkAsset[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    void deps.repository.listWorkAssetsForWork(props.work.id).then((list) => {
      if (!cancelled) setAssets(list);
    });
    return () => {
      cancelled = true;
    };
  }, [deps, props.work.id]);
  const sourceLabel = assets.length === 0 ? 'no PDF yet' : assets[0]?.kind ?? 'asset';
  return (
    <Surface
      data-testid="research-library-row"
      data-work-id={props.work.id}
      data-asset-kind={assets[0]?.kind ?? 'none'}
      className="research-library-row"
    >
      <div className="research-library-row-main">
        <div className="research-library-row-meta">
          <div className="research-library-row-title">{props.work.title}</div>
          <div className="research-library-row-sub">
            {props.work.authors.join(', ')}
            {props.work.year ? ` · ${props.work.year}` : ''}
            {props.work.venue ? ` · ${props.work.venue}` : ''}
          </div>
          <div className="research-library-row-sub">
            {props.work.identifiers.doi ? `DOI: ${props.work.identifiers.doi}` : props.work.id}
          </div>
        </div>
        <div className="research-library-row-actions">
          <Pill data-testid="research-library-status">{props.work.readingStatus}</Pill>
          <Pill data-testid="research-library-asset-kind">{sourceLabel}</Pill>
          <Button
            variant="ghost"
            size="sm"
            onClick={props.onOpen}
            data-testid="research-library-open-reader"
          >
            Open
          </Button>
        </div>
      </div>
    </Surface>
  );
}
