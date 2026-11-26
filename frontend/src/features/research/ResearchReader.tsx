/**
 * StudyKit v0.4 — `features/research/ResearchReader`
 *
 * Reader surface for a single `Work` inside a
 * Research project. Real behaviour:
 *
 *   1. Resolve the Work to a renderable PDF source
 *      via `resolveWorkReaderSource`. The source is
 *      one of:
 *      - `local-url` (a `local-pdf` WorkAsset whose
 *        bytes live in the IndexedDB blob store),
 *      - `remote` (a v0.3 `LiteraturePaper` reachable
 *        through the legacy `/api/.../download` path),
 *      - `no-asset` (the Work has no PDF yet — the
 *        UI shows an "Import PDF" prompt).
 *   2. Render the PDF via the existing
 *      `LiteraturePDFViewer` (extended with a
 *      `source` prop; the v0.3 `paperId` path is
 *      preserved). The paper-page locator uses the
 *      real `WorkAsset.id` so `Verify Evidence`
 *      succeeds.
 *   3. Listen for text selection on the canvas. A
 *      1-button `SelectionActionBar` offers "Save as
 *      Evidence" only. (Note / Question / Cite / Ask
 *      were placeholders in WP-05 round 1; they have
 *      been removed per the Gate review. The Intent
 *      Capsule `⌘K` already covers the Ask path on
 *      the whole v04 body.)
 *   4. The `EvidenceDraftDrawer` pre-fills the
 *      excerpt, page, `paper-page` locator with
 *      `assetId` from the active WorkAsset, and a
 *      `quoteHash`. Verify refuses when the locator
 *      is incomplete (no asset, no page).
 *   5. The "Import PDF" button opens a `<input
 *      type="file">` picker. The picked file is
 *      imported via `importLocalPdf`; the new asset
 *      replaces the empty state.
 *
 * Hooks: every `useEffect` cleans up its
 * `selectionchange` / `mouseup` listener and the
 * PDF.js object URL when the source changes. The
 * component is fully a *consumer* of the Research
 * `useResearchDeps()` — no direct fetch, no
 * IndexedDB calls outside the `pdfAssetStore`.
 */

import React from 'react';
import LiteraturePDFViewer from '../../components/literature/LiteraturePDFViewer';
import { Button } from '../../shared/ui/Button';
import { Pill } from '../../shared/ui/Pill';
import { Surface } from '../../shared/ui/Surface';
import { useResearchDeps } from './researchContext';
import {
  captureExcerpt,
  createEvidenceDraft,
  verifyEvidence,
  type CapturePointTarget,
} from '../../application/research/researchUseCases';
import {
  importLocalPdf,
  importAcquiredPdf,
  LocalPdfImportError,
} from '../../application/research/importLocalPdf';
import {
  resolveWorkReaderSource,
  type WorkReaderSourceError,
  type WorkReaderSourceResult,
} from '../../application/research/workReaderSource';
import {
  hashQuote,
  isEvidenceReadyForVerification,
  type Claim,
  type ClaimEvidenceRelation,
  type Evidence,
  type EvidenceType,
  type ResearchSourceLocator,
  type Work,
} from '../../domain/research';

/** Longest excerpt kept from a selection. Longer selections are cut, and the user is told. */
const MAX_EXCERPT_CHARS = 2000;

export function buildPageLocator(
  workId: string,
  assetId: string | undefined,
  pageNumber: number,
  excerpt: string,
): ResearchSourceLocator {
  return {
    kind: 'paper-page',
    workId,
    ...(assetId ? { assetId } : {}),
    pageNumber,
    quoteHash: hashQuote(excerpt),
    capturedAt: new Date().toISOString(),
  };
}

/** The project's points (Claims), kept live. */
function useProjectPoints(projectId: string): readonly Claim[] {
  const deps = useResearchDeps();
  const [points, setPoints] = React.useState<readonly Claim[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void deps.repository.listClaims({ projectId }).then((rows) => {
        if (!cancelled) setPoints([...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      });
    };
    load();
    const off = deps.repository.subscribe(load);
    return () => {
      cancelled = true;
      off();
    };
  }, [deps.repository, projectId]);
  return points;
}

export interface ResearchReaderProps {
  readonly projectId: string;
  readonly workId: string;
  readonly onBackToLibrary: (projectId: string) => void;
  readonly onOpenEvidence: (projectId: string) => void;
  /** 1-based page to open on (e.g. from the ledger). */
  readonly initialPageNumber?: number;
}

export function ResearchReader(props: ResearchReaderProps): React.ReactElement {
  const deps = useResearchDeps();
  const [work, setWork] = React.useState<Work | null>(null);
  const [page, setPage] = React.useState(() =>
    props.initialPageNumber && props.initialPageNumber > 0 ? props.initialPageNumber - 1 : 0,
  );
  const [totalPages, setTotalPages] = React.useState(0);
  const [zoom, setZoom] = React.useState(100);
  const [error, setError] = React.useState<string | null>(null);
  const [sourceResult, setSourceResult] = React.useState<WorkReaderSourceResult | null>(null);
  const [selection, setSelection] = React.useState<{ text: string; rect: DOMRect | null } | null>(
    null,
  );
  const [draftOpen, setDraftOpen] = React.useState(false);
  // A frozen copy of the selection: clicking into the point picker
  // collapses the live selection, so the picker works from this.
  const [captured, setCaptured] = React.useState<{ text: string; rect: DOMRect | null; page: number; truncated: boolean } | null>(null);
  const [captureBusy, setCaptureBusy] = React.useState(false);
  const [captureError, setCaptureError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const pdfAreaRef = React.useRef<HTMLDivElement | null>(null);
  const points = useProjectPoints(props.projectId);
  const [importing, setImporting] = React.useState(false);
  const [importError, setImportError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Load the Work on mount / workId change. Uses
  // a cancellation flag so a re-mount or
  // workId change before the async resolve
  // doesn't commit a stale result.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const w = await deps.repository.getWork(props.workId);
      if (!cancelled) setWork(w);
    })();
    return () => {
      cancelled = true;
    };
  }, [deps, props.workId]);

  // Subscribe to repository changes so a notify
  // (e.g. from another tab) re-loads the Work.
  // Re-subscribes when `work` changes; the
  // cleanup removes the previous listener.
  React.useEffect(() => {
    if (!work) return;
    const off = deps.repository.subscribe(() => {
      void deps.repository.getWork(props.workId).then((w) => {
        if (w) setWork(w);
      });
    });
    return off;
  }, [deps, props.workId, work]);

  // Resolve the Work to a PDF source. Re-runs
  // when the Work (or its assetIds) changes.
  React.useEffect(() => {
    let cancelled = false;
    if (!work) {
      setSourceResult(null);
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      const r = await resolveWorkReaderSource(deps.repository, work, deps.sourceAssets);
      if (cancelled) return;
      setSourceResult(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [deps.repository, deps.sourceAssets, work]);

  // Track text selection on `mouseup` and the
  // `selectionchange` event. We clear the selection
  // when the user changes page or imports a PDF.
  React.useEffect(() => {
    const onUp = (): void => {
      const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSelection(null);
        return;
      }
      const text = sel.toString().trim();
      if (text.length === 0) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      // Only selections inside the PDF become excerpts.
      const area = pdfAreaRef.current;
      if (area && !area.contains(range.commonAncestorContainer)) return;
      const rect = range.getBoundingClientRect();
      setSelection({ text, rect });
    };
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Clear selection on page change so the user
  // doesn't get a stale "Save as Evidence" popover
  // pointing at a different page.
  React.useEffect(() => {
    setSelection(null);
    setCaptured(null);
  }, [page]);

  // A later request for a specific page (e.g. from "What's missing")
  // moves an already-open reader there.
  React.useEffect(() => {
    if (props.initialPageNumber && props.initialPageNumber > 0) setPage(props.initialPageNumber - 1);
  }, [props.initialPageNumber]);

  React.useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const clearSelection = (): void => {
    setSelection(null);
    setCaptured(null);
    setCaptureError(null);
    if (typeof window !== 'undefined') window.getSelection?.()?.removeAllRanges();
  };

  const freezeSelection = (): { text: string; rect: DOMRect | null; page: number; truncated: boolean } | null => {
    if (!selection) return null;
    const truncated = selection.text.length > MAX_EXCERPT_CHARS;
    return { text: selection.text.slice(0, MAX_EXCERPT_CHARS), rect: selection.rect, page, truncated };
  };

  const assetIdForCapture = sourceResult?.kind === 'ok' ? sourceResult.source.assetId : undefined;

  const handleCapture = async (
    snapshot: { text: string; page: number },
    point?: CapturePointTarget,
    relation?: ClaimEvidenceRelation,
    note?: string,
  ): Promise<void> => {
    if (!work) return;
    setCaptureBusy(true);
    setCaptureError(null);
    try {
      const result = await captureExcerpt(deps.repository, {
        projectId: props.projectId,
        workId: work.id,
        locator: buildPageLocator(work.id, assetIdForCapture, snapshot.page + 1, snapshot.text),
        exactQuote: snapshot.text,
        ...(point ? { point } : {}),
        ...(relation ? { relation } : {}),
        ...(note ? { note } : {}),
      });
      const verb = relation === 'contradicts' ? 'against' : relation === 'qualifies' ? 'as a limit on' : 'to';
      setNotice(
        result.claim
          ? `Excerpt from page ${snapshot.page + 1} added ${verb} “${result.claim.title}”.`
          : `Excerpt from page ${snapshot.page + 1} saved. Connect it to a point when you’re ready.`,
      );
      clearSelection();
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : 'Couldn’t save this excerpt.');
    } finally {
      setCaptureBusy(false);
    }
  };

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
        await importAcquiredPdf(deps.repository, {
          projectId: props.projectId,
          acquired,
          existingWorkId: work?.id,
        });
        const next = await deps.repository.getWork(props.workId);
        if (next) setWork(next);
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
        existingWorkId: work?.id,
      });
      // Re-load the Work so the new asset is
      // visible. The work-load useEffect's
      // subscribe callback also re-loads on
      // notify; this explicit re-load makes the
      // happy-dom path deterministic regardless
      // of the subscribe callback's microtask
      // scheduling.
      const w = await deps.repository.getWork(props.workId);
      if (w) setWork(w);
    } catch (err) {
      if (err instanceof LocalPdfImportError) {
        setImportError(`${err.code}: ${err.message}`);
      } else {
        setImportError(err instanceof Error ? err.message : 'Failed to import PDF.');
      }
    } finally {
      setImporting(false);
      // Reset the input so picking the same file
      // twice still triggers `change`.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!work) {
    return (
      <div
        data-testid="research-reader-loading"
        data-work-id={props.workId}
        style={{ padding: '1rem' }}
      >
        Loading paper…
      </div>
    );
  }

  return (
    <div
      data-testid="research-reader"
      data-work-id={props.workId}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', height: '100%' }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.5rem 1rem',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.1rem' }}>{work.title}</h1>
        <Pill data-testid="research-reader-work-status">{work.readingStatus}</Pill>
        <span style={{ flex: 1 }} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => props.onBackToLibrary(props.projectId)}
          data-testid="research-reader-back"
        >
          Back to library
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => props.onOpenEvidence(props.projectId)}
          data-testid="research-reader-open-evidence"
        >
          Open Evidence workspace
        </Button>
      </header>
      {notice ? (
        <p role="status" data-testid="research-reader-capture-notice" className="research-reader-notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" data-testid="research-reader-error" style={{ color: 'var(--color-danger, #b00)', padding: '0 1rem' }}>
          {error}
        </p>
      ) : null}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div ref={pdfAreaRef} data-testid="research-reader-pdf-area" style={{ flex: 1, minWidth: 0, padding: '0 1rem' }}>
          {sourceResult && sourceResult.kind === 'ok' ? (
            <LiteraturePDFViewer
              source={sourceResult.source}
              currentPageIndex={page}
              totalPages={totalPages}
              onPageChange={setPage}
              onTotalPagesChange={setTotalPages}
              zoom={zoom}
              onZoomChange={setZoom}
            />
          ) : (
            <EmptyPdfState
              error={sourceResult?.kind === 'error' ? sourceResult.error : null}
              onImport={handleImportClick}
              importing={importing}
              importError={importError}
            />
          )}
        </div>
        {captured ? (
          <PointPicker
            rect={captured.rect}
            excerpt={captured.text}
            truncated={captured.truncated}
            points={points}
            busy={captureBusy}
            error={captureError}
            onPick={(point, relation, note) => void handleCapture(captured, point, relation, note)}
            onClose={clearSelection}
          />
        ) : selection && selection.text.length > 0 && sourceResult?.kind === 'ok' ? (
          <SelectionActionBar
            rect={selection.rect}
            busy={captureBusy}
            onAddToPoint={() => setCaptured(freezeSelection())}
            onSaveExcerpt={() => {
              const snap = freezeSelection();
              if (snap) void handleCapture(snap);
            }}
            onPick={() => {
              setDraftOpen(true);
            }}
            onDismiss={clearSelection}
          />
        ) : null}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        data-testid="research-reader-file-input"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) void handleFileChosen(file);
        }}
      />
      {draftOpen && sourceResult?.kind === 'ok' && work ? (
        <EvidenceDraftDrawer
          projectId={props.projectId}
          work={work}
          source={sourceResult.source}
          pageNumber={page + 1}
          excerpt={(selection?.text ?? '').slice(0, MAX_EXCERPT_CHARS)}
          onClose={() => {
            setDraftOpen(false);
            setSelection(null);
            if (typeof window !== 'undefined') {
              window.getSelection?.()?.removeAllRanges();
            }
          }}
        />
      ) : null}
    </div>
  );
}

function SelectionActionBar(props: {
  readonly rect: DOMRect | null;
  readonly busy: boolean;
  readonly onAddToPoint: () => void;
  readonly onSaveExcerpt: () => void;
  readonly onPick: () => void;
  readonly onDismiss: () => void;
}): React.ReactElement | null {
  if (!props.rect) return null;
  const style: React.CSSProperties = {
    top: Math.max(8, props.rect.top - 44),
    left: Math.max(8, props.rect.left + props.rect.width / 2 - 170),
  };
  return (
    <div
      role="toolbar"
      aria-label="Use this passage"
      data-testid="selection-action-bar"
      className="selection-action-bar"
      style={style}
      // Keep the text selection while a button is pressed.
      onMouseDown={(e) => e.preventDefault()}
    >
      <Button
        variant="primary"
        size="sm"
        onClick={props.onAddToPoint}
        disabled={props.busy}
        data-testid="selection-action-point"
      >
        Add to a point…
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={props.onSaveExcerpt}
        disabled={props.busy}
        data-testid="selection-action-save"
      >
        Save excerpt
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={props.onPick}
        data-testid="selection-action-evidence"
        title="Open the full form (type, interpretation)"
      >
        Details…
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={props.onDismiss}
        data-testid="selection-action-dismiss"
        aria-label="Dismiss"
      >
        ×
      </Button>
    </div>
  );
}

const RELATIONS: readonly { value: ClaimEvidenceRelation; label: string }[] = [
  { value: 'supports', label: 'Supports' },
  { value: 'contradicts', label: 'Contradicts' },
  { value: 'qualifies', label: 'Limits' },
];

/**
 * "Which point does this passage speak to?" — one click on a point (or
 * Enter on a new one) saves, verifies and connects the excerpt.
 */
export function PointPicker(props: {
  readonly rect: DOMRect | null;
  readonly excerpt: string;
  readonly truncated: boolean;
  readonly points: readonly Claim[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly onPick: (point: CapturePointTarget, relation: ClaimEvidenceRelation, note: string) => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const [query, setQuery] = React.useState('');
  const [relation, setRelation] = React.useState<ClaimEvidenceRelation>('supports');
  const [note, setNote] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => inputRef.current?.focus(), []);

  const q = query.trim().toLowerCase();
  const matches = (q ? props.points.filter((p) => p.title.toLowerCase().includes(q)) : props.points).slice(0, 6);
  const exact = props.points.find((p) => p.title.trim().toLowerCase() === q);

  const submitQuery = (): void => {
    if (props.busy || !q) return;
    if (exact) props.onPick({ kind: 'existing', claimId: exact.id }, relation, note);
    else props.onPick({ kind: 'new', title: query.trim() }, relation, note);
  };

  const top = props.rect ? Math.min(window.innerHeight - 380, Math.max(8, props.rect.bottom + 8)) : 80;
  const left = props.rect ? Math.min(window.innerWidth - 360, Math.max(8, props.rect.left)) : 80;

  return (
    <div
      role="dialog"
      aria-label="Add excerpt to a point"
      data-testid="point-picker"
      className="point-picker"
      style={{ top, left }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <blockquote className="point-picker-quote" data-testid="point-picker-quote">
        {props.excerpt.length > 180 ? `${props.excerpt.slice(0, 180)}…` : props.excerpt}
      </blockquote>
      {props.truncated ? (
        <p className="point-picker-hint">Long selection: only the first 2,000 characters are kept.</p>
      ) : null}
      <div className="point-picker-relations" role="radiogroup" aria-label="This passage">
        {RELATIONS.map((r) => (
          <button
            key={r.value}
            type="button"
            role="radio"
            aria-checked={relation === r.value}
            className={`point-picker-relation${relation === r.value ? ' is-active' : ''}`}
            onClick={() => setRelation(r.value)}
            data-testid={`point-picker-relation-${r.value}`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <input
        ref={inputRef}
        className="research-input point-picker-input"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitQuery();
          }
        }}
        placeholder={props.points.length > 0 ? 'Find a point, or write a new one' : 'Write the point this passage speaks to'}
        aria-label="Point"
        data-testid="point-picker-input"
      />
      <ul className="point-picker-list" data-testid="point-picker-list">
        {matches.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="point-picker-option"
              disabled={props.busy}
              onClick={() => props.onPick({ kind: 'existing', claimId: p.id }, relation, note)}
              data-testid="point-picker-option"
            >
              {p.title}
            </button>
          </li>
        ))}
        {q && !exact ? (
          <li>
            <button
              type="button"
              className="point-picker-option point-picker-option--new"
              disabled={props.busy}
              onClick={submitQuery}
              data-testid="point-picker-new"
            >
              New point: “{query.trim()}”
            </button>
          </li>
        ) : null}
        {!q && props.points.length === 0 ? (
          <li className="point-picker-hint">Your points will appear here.</li>
        ) : null}
      </ul>
      <input
        className="research-input point-picker-note"
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
        placeholder="Why, in your words (optional)"
        aria-label="Why, in your words (optional)"
        data-testid="point-picker-note"
      />
      {props.error ? (
        <p role="alert" className="research-error" data-testid="point-picker-error">
          {props.error}
        </p>
      ) : null}
      <div className="point-picker-footer">
        <Button variant="ghost" size="sm" onClick={props.onClose} data-testid="point-picker-cancel">
          Cancel
        </Button>
      </div>
    </div>
  );
}

function EmptyPdfState(props: {
  readonly error: WorkReaderSourceError | null;
  readonly onImport: () => void;
  readonly importing: boolean;
  readonly importError: string | null;
}): React.ReactElement {
  const syncOnly = props.error?.kind === 'sync-only';
  return (
    <Surface
      data-testid="research-reader-empty"
      style={{ padding: '1.5rem', textAlign: 'center', borderRadius: '0.5rem' }}
    >
      <p
        data-testid="research-reader-empty-message"
        style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}
      >
        {syncOnly
          ? 'This Work has no local PDF. The DOI match needs the sync workspace.'
          : 'No PDF attached yet. Import a local PDF to read it and create Evidence.'}
      </p>
      {props.error ? (
        <p
          role="status"
          data-testid="research-reader-empty-detail"
          style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.85rem' }}
        >
          {props.error.message}
        </p>
      ) : null}
      {syncOnly ? null : (
        <div style={{ marginTop: '0.75rem' }}>
          <Button
            variant="primary"
            size="sm"
            onClick={props.onImport}
            disabled={props.importing}
            data-testid="research-reader-import"
          >
            {props.importing ? 'Importing…' : 'Import PDF'}
          </Button>
        </div>
      )}
      {props.importError ? (
        <p
          role="alert"
          data-testid="research-reader-import-error"
          style={{ color: 'var(--color-danger, #b00)', fontSize: '0.85rem', margin: '0.5rem 0 0 0' }}
        >
          {props.importError}
        </p>
      ) : null}
    </Surface>
  );
}

function EvidenceDraftDrawer(props: {
  readonly projectId: string;
  readonly work: Work;
  readonly source: { kind: 'remote' | 'local-url' | 'local-blob'; assetId?: string; paperId?: string; url?: string };
  readonly pageNumber: number;
  readonly excerpt: string;
  readonly onClose: () => void;
}): React.ReactElement {
  const deps = useResearchDeps();
  const [interpretation, setInterpretation] = React.useState('');
  const [evidenceType, setEvidenceType] = React.useState<EvidenceType>('finding');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<Evidence | null>(null);

  // The assetId comes from the resolved source. The
  // resolver is the single source of truth: a
  // `local-url` source carries the WorkAsset.id, a
  // `remote` source (linked-file / DOI match) carries
  // either the WorkAsset.id or the legacy paper id so
  // the locator round-trips. Without an assetId the
  // locator is incomplete and Verify is disabled.
  const assetId = props.source.assetId;

  const locator: ResearchSourceLocator = {
    kind: 'paper-page',
    workId: props.work.id,
    ...(assetId ? { assetId } : {}),
    pageNumber: props.pageNumber,
    quoteHash: hashQuote(props.excerpt),
    capturedAt: new Date().toISOString(),
  };

  const ready = isEvidenceReadyForVerification({
    locator,
    exactQuote: props.excerpt,
    userInterpretation: interpretation,
  });

  const handleSaveDraft = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const draft = await createEvidenceDraft(deps.repository, {
        projectId: props.projectId,
        workId: props.work.id,
        locator,
        exactQuote: props.excerpt,
        userInterpretation: interpretation,
        evidenceType,
      });
      setSaved(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Evidence.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (): Promise<void> => {
    if (!saved) return;
    setBusy(true);
    setError(null);
    try {
      const verified = await verifyEvidence(deps.repository, { evidenceId: saved.id });
      setSaved(verified);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify Evidence.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Evidence draft"
      data-testid="evidence-draft-drawer"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.32)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <Surface
        style={{ width: '100%', maxWidth: 720, padding: '1rem', borderRadius: '0.5rem 0.5rem 0 0' }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>New Evidence</h2>
          <Pill data-testid="evidence-draft-work">{props.work.title}</Pill>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" onClick={props.onClose} data-testid="evidence-draft-close">
            Close
          </Button>
        </header>
        <p
          data-testid="evidence-draft-locator"
          style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.8rem', margin: '0.5rem 0' }}
        >
          Locator: paper-page · page {props.pageNumber}
          {assetId ? ` · asset ${assetId}` : ' · no local asset'}
        </p>
        {!assetId ? (
          <p
            role="status"
            data-testid="evidence-draft-locator-incomplete"
            style={{ color: 'var(--color-warning, #b80)', fontSize: '0.85rem' }}
          >
            This Work has no local PDF asset. Import a PDF on the Reader page first;
            Verify Evidence is disabled until the locator is complete.
          </p>
        ) : null}
        <label htmlFor="evidence-draft-quote" style={{ display: 'block', marginTop: '0.5rem' }}>
          <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Excerpt</span>
          <textarea
            id="evidence-draft-quote"
            data-testid="evidence-draft-quote"
            value={props.excerpt}
            readOnly
            rows={3}
            style={{
              width: '100%',
              padding: '0.5rem 0.625rem',
              border: '1px solid var(--color-border, #ccc)',
              borderRadius: 'var(--radius-sm, 4px)',
              background: 'var(--color-bg, transparent)',
              color: 'var(--color-text, inherit)',
              font: 'inherit',
              resize: 'vertical',
            }}
          />
        </label>
        <label htmlFor="evidence-draft-interpretation" style={{ display: 'block', marginTop: '0.5rem' }}>
          <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
            Your interpretation
          </span>
          <textarea
            id="evidence-draft-interpretation"
            data-testid="evidence-draft-interpretation"
            value={interpretation}
            onChange={(e) => setInterpretation(e.currentTarget.value)}
            rows={3}
            placeholder="What does this passage say? In your own words."
            style={{
              width: '100%',
              padding: '0.5rem 0.625rem',
              border: '1px solid var(--color-border, #ccc)',
              borderRadius: 'var(--radius-sm, 4px)',
              background: 'var(--color-bg, transparent)',
              color: 'var(--color-text, inherit)',
              font: 'inherit',
              resize: 'vertical',
            }}
          />
        </label>
        <label htmlFor="evidence-draft-type" style={{ display: 'block', marginTop: '0.5rem' }}>
          <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Evidence type</span>
          <select
            id="evidence-draft-type"
            data-testid="evidence-draft-type"
            value={evidenceType}
            onChange={(e) => setEvidenceType(e.currentTarget.value as EvidenceType)}
            style={{
              padding: '0.4rem 0.5rem',
              border: '1px solid var(--color-border, #ccc)',
              borderRadius: 'var(--radius-sm, 4px)',
              background: 'var(--color-bg, transparent)',
              color: 'var(--color-text, inherit)',
              font: 'inherit',
            }}
          >
            {(['finding', 'method', 'definition', 'theory', 'limitation', 'context'] as EvidenceType[]).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {error ? (
          <p
            role="alert"
            data-testid="evidence-draft-error"
            style={{ color: 'var(--color-danger, #b00)', fontSize: '0.85rem', margin: '0.5rem 0' }}
          >
            {error}
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" onClick={props.onClose} data-testid="evidence-draft-cancel">
            Cancel
          </Button>
          {!saved ? (
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveDraft}
              disabled={busy || props.excerpt.trim().length === 0}
              data-testid="evidence-draft-save"
            >
              Save draft
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleVerify}
              disabled={busy || !ready}
              data-testid="evidence-draft-verify"
            >
              Verify Evidence
            </Button>
          )}
        </div>
        {saved ? (
          <p
            data-testid="evidence-draft-saved"
            style={{ margin: '0.5rem 0 0 0', color: 'var(--color-text-secondary, #666)', fontSize: '0.8rem' }}
          >
            Saved as {saved.status}.{' '}
            {saved.status === 'candidate'
              ? 'Add an interpretation and click Verify to promote to canonical Evidence.'
              : null}
          </p>
        ) : null}
      </Surface>
    </div>
  );
}
