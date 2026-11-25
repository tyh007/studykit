/**
 * StudyKit v0.4 — `features/research/Sources` (WP-11R2)
 *
 * The user-facing **Sources** surface. WP-11R2 merges
 * the old Discover / Library / Search into a single
 * surface with two sub-states:
 *
 *   - `library` (default) — the saved Works list with
 *     a unified **Add sources** panel that exposes
 *     `Search literature` / `Import PDF` /
 *     `Import from Zotero` / `Add URL/DOI`. The
 *     "Search" entry is *inside* the Add panel, not
 *     a separate top-level destination.
 *   - `search` — the active `SearchRun`; the user
 *     picks a previous run, runs a new one, or
 *     switches back to the Library. The Search
 *     sub-state never owns its own data path: it
 *     reuses the canonical `Discovery` component
 *     (which keeps the `SearchRun` / `Work` /
 *     `QuerySpec` contract unchanged) and renders
 *     it inline below the Add panel.
 *
 * The component does NOT introduce a new repository,
 * a new `Work` storage path, or a duplicate import
 * path. It composes the existing `Library` (read +
 * add) and `Discovery` (search) components so the
 * data flow is unchanged: `deps.repository`,
 * `useSupports('zotero.import')`, `importLocalPdf`,
 * `importFromZotero`, `runSearch`, `saveWorkFromCandidate`.
 *
 * Deep-link compatibility: this component is
 * rendered when the active `AppLocation.surface` is
 * `'library'`. The router's `reader + view=discovery`
 * case still renders the legacy `Discovery` alone —
 * the audit Step 6 deep link must keep working.
 */
import React from 'react';
import { Library } from './Library';
import { Discovery } from './Discovery';
import { Button } from '../../shared/ui/Button';
import { Input } from '../../shared/ui/Input';
import { useResearchDeps } from './researchContext';
import { addWorkFromIdentifier } from '../../application/research/researchUseCases';

export type SourcesView = 'library' | 'search';

export interface SourcesProps {
  readonly projectId: string;
  /**
   * Initial sub-view. The `Library` surface used to
   * default to the Works list; the `Discovery`
   * surface used to live on its own URL. WP-11R2
   * defaults to `'library'`; the deep-link
   * `library?view=search` parameter still flips to
   * the search sub-state without breaking the old
   * hash.
   */
  readonly initialView?: SourcesView;
  readonly initialAdd?: boolean;
  /** Back to project. */
  readonly onBackToProject: (projectId: string) => void;
  /** Open a specific work in the reader. */
  readonly onOpenReader: (input: { projectId: string; workId: string }) => void;
}

export function Sources(props: SourcesProps): React.ReactElement {
  const deps = useResearchDeps();
  const [view, setView] = React.useState<SourcesView>(props.initialView ?? 'library');
  const [showAdd, setShowAdd] = React.useState(props.initialAdd ?? false);
  const [libraryAction, setLibraryAction] = React.useState<'pdf' | 'zotero' | null>(null);
  const [identifierOpen, setIdentifierOpen] = React.useState(false);
  const [identifier, setIdentifier] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [identifierBusy, setIdentifierBusy] = React.useState(false);
  const [identifierError, setIdentifierError] = React.useState<string | null>(null);
  const [libraryRevision, setLibraryRevision] = React.useState(0);

  const addIdentifier = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!identifier.trim() || identifierBusy) return;
    setIdentifierBusy(true);
    setIdentifierError(null);
    try {
      await addWorkFromIdentifier(deps.repository, {
        projectId: props.projectId,
        value: identifier,
        ...(title.trim() ? { title } : {}),
      });
      setIdentifier('');
      setTitle('');
      setIdentifierOpen(false);
      setShowAdd(false);
      setView('library');
      setLibraryRevision((current) => current + 1);
    } catch (error) {
      setIdentifierError(error instanceof Error ? error.message : 'Could not add this source.');
    } finally {
      setIdentifierBusy(false);
    }
  };

  return (
    <div
      data-testid="research-sources"
      data-project-id={props.projectId}
      data-view={view}
      className="research-surface research-sources"
    >
      <header className="research-header">
        <h1 className="research-h1">Sources</h1>
        <span className="research-header-spacer" />
        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowAdd((v) => !v)}
          aria-expanded={showAdd}
          aria-controls="research-sources-add-panel"
          data-testid="research-sources-add-toggle"
        >
          {showAdd ? 'Close add' : 'Add sources'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => props.onBackToProject(props.projectId)}
          data-testid="research-sources-back"
        >
          Back to project
        </Button>
      </header>

      {/*
        View toggle. The Library list is the default;
        Search is the same surface in a different
        state (the audit Step 6 verdict: "Search is
        a *work state*, not a destination").
      */}
      <div className="research-toolbar" role="tablist" aria-label="Source view">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'library'}
          className={`v04-tab ${view === 'library' ? 'is-active' : ''}`}
          onClick={() => setView('library')}
          data-testid="research-sources-tab-library"
        >
          Library
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'search'}
          className={`v04-tab ${view === 'search' ? 'is-active' : ''}`}
          onClick={() => setView('search')}
          data-testid="research-sources-tab-search"
        >
          Search
        </button>
      </div>

      {/*
        Unified Add Sources panel. Each row hands off
        to the same library/import use cases; we
        don't add a new handler.
      */}
      {showAdd ? (
        <section
          id="research-sources-add-panel"
          role="region"
          aria-label="Add sources"
          data-testid="research-sources-add-panel"
          className="research-add-panel"
        >
          <h2 className="research-h2">Add sources</h2>
          <ul className="research-add-list">
            <li>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setView('search');
                  setShowAdd(false);
                }}
                data-testid="research-sources-add-search"
              >
                Search literature
              </Button>
            </li>
            <li>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setView('library');
                  setLibraryAction('pdf');
                  setShowAdd(false);
                }}
                data-testid="research-sources-add-pdf-hint"
              >
                Import PDF
              </Button>
            </li>
            <li>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setView('library');
                  setLibraryAction('zotero');
                  setShowAdd(false);
                }}
                data-testid="research-sources-add-zotero-hint"
              >
                Import from Zotero
              </Button>
            </li>
            <li>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setIdentifierOpen((current) => !current);
                  setIdentifierError(null);
                }}
                data-testid="research-sources-add-url-doi"
              >
                Add URL / DOI
              </Button>
            </li>
          </ul>
          {identifierOpen ? (
            <form className="research-identifier-form" onSubmit={addIdentifier} data-testid="research-sources-identifier-form">
              <label htmlFor="research-source-identifier">DOI or URL</label>
              <Input
                id="research-source-identifier"
                value={identifier}
                onChange={(event) => setIdentifier(event.currentTarget.value)}
                placeholder="10.1000/example or https://…"
                autoFocus
              />
              <label htmlFor="research-source-title">Title (optional)</label>
              <Input
                id="research-source-title"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                placeholder="A readable title"
              />
              <Button type="submit" variant="primary" size="sm" disabled={!identifier.trim() || identifierBusy}>
                {identifierBusy ? 'Adding…' : 'Add to library'}
              </Button>
              {identifierError ? <p role="alert" className="research-error">{identifierError}</p> : null}
            </form>
          ) : null}
        </section>
      ) : null}

      {view === 'library' ? (
        <Library
          key={`${props.projectId}:${libraryRevision}`}
          projectId={props.projectId}
          onOpenReader={props.onOpenReader}
          onBackToProject={props.onBackToProject}
          embedded
          requestedAction={libraryAction}
          onRequestedActionHandled={() => setLibraryAction(null)}
        />
      ) : (
        <Discovery
          projectId={props.projectId}
          onClose={() => setView('library')}
          onOpenLibrary={() => setView('library')}
        />
      )}
    </div>
  );
}
