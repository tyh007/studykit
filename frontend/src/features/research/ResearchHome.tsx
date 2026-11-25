/**
 * StudyKit v0.4 — `features/research/ResearchHome` (WP-11R2)
 *
 * Research Mode's top-level Home. WP-11R2 reverses the
 * order so **Resume existing project** comes first and
 * **New project** is collapsed:
 *
 *   - The "Your projects" list is the visual primary
 *     (the user almost always wants to keep working on
 *     a project they've already started).
 *   - "New project" is a single small button that
 *     opens an inline form. The form no longer
 *     auto-focuses the input (the audit noted the
 *     auto-focus was a visual hint that creating is
 *     the default — wrong for return users).
 *
 * The component is otherwise unchanged: it reads via
 * `useResearchDeps()`, hands the host the navigation
 * callback, and the router maps it to
 * `locationStore.push`. No new state store, no new
 * repository, no schema change.
 */
import React from 'react';
import { Button } from '../../shared/ui/Button';
import { Input } from '../../shared/ui/Input';
import { Pill } from '../../shared/ui/Pill';
import { Surface } from '../../shared/ui/Surface';
import { useResearchDeps } from './researchContext';
import { createProject } from '../../application/research/researchUseCases';
import { type ResearchProject } from '../../domain/research';
import { useCollaborationDepsOptional } from '../collaboration/collaborationContext';

export interface ResearchHomeProps {
  readonly initialAddOpen?: boolean;
  readonly onOpenProject: (projectId: string) => void;
}

export function ResearchHome(props: ResearchHomeProps): React.ReactElement {
  const deps = useResearchDeps();
  const collab = useCollaborationDepsOptional();
  const [projects, setProjects] = React.useState<readonly ResearchProject[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showNew, setShowNew] = React.useState(props.initialAddOpen ?? false);
  const [name, setName] = React.useState('');
  const [brief, setBrief] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (props.initialAddOpen) setShowNew(true);
  }, [props.initialAddOpen]);

  const mountedRef = React.useRef<boolean>(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = React.useCallback(async (): Promise<void> => {
    if (!mountedRef.current) return;
    setLoading(true);
    setError(null);
    try {
      if (collab?.listSharedProjects) {
        const shared = await collab.listSharedProjects();
        const local = await deps.repository.listProjects();
        const localIds = new Set(local.map((p) => p.id));
        const missing = shared.filter((p) => !localIds.has(p.id));
        if (missing.length > 0) {
          await deps.repository.transact(async (tx) => {
            for (const p of missing) {
              tx.putProject({
                id: p.id,
                container: {
                  workspaceId: null,
                  mode: 'research',
                  kind: 'project',
                  id: p.id,
                },
                name: p.name,
                livingBrief: '',
                kind: p.kind === 'literature-review'
                  ? 'review'
                  : p.kind === 'mixed'
                    ? 'explore'
                    : p.kind === 'empirical'
                      ? 'empirical'
                      : 'blank',
                createdAt: p.created_at,
                updatedAt: p.updated_at,
                authorType: 'imported',
              });
            }
          });
        }
      }
      const all = await deps.repository.listProjects();
      if (!mountedRef.current) return;
      setProjects(all);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load projects.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [collab, deps.repository]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  React.useEffect(() => {
    const off = deps.repository.subscribe(() => {
      if (mountedRef.current) void reload();
    });
    return off;
  }, [deps.repository, reload]);

  // Resume priority: the most recently updated
  // project. The list is already sorted by the
  // repository in the production path; we re-sort
  // defensively so a unit test that pokes the list
  // directly still finds the right row.
  const resumeProject = React.useMemo(() => {
    if (projects.length === 0) return null;
    const sorted = [...projects].sort((a, b) =>
      (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
    );
    return sorted[0] ?? null;
  }, [projects]);

  const handleCreate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!mountedRef.current) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createProject(deps.repository, {
        name: trimmed,
        livingBrief: brief,
        kind: 'blank',
        container: { workspaceId: null, mode: 'research', kind: 'project', id: '' },
      });
      if (!mountedRef.current) return;
      const fixed: ResearchProject = {
        ...created,
        container: { ...created.container, id: created.id },
      };
      await deps.repository.transact(async (tx) => {
        tx.putProject(fixed);
      });
      if (collab?.createSharedProject) {
        await collab.createSharedProject({
          id: fixed.id,
          name: fixed.name,
          kind: fixed.kind,
        });
      } else {
        await collab?.bootstrapLocalOwner?.(fixed.id);
      }
      if (!mountedRef.current) return;
      setName('');
      setBrief('');
      setShowNew(false);
      props.onOpenProject(fixed.id);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to create project.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <div data-testid="research-home" className="v04-research-home" style={{ padding: '1rem', maxWidth: 920, margin: '0 auto' }}>
      <header style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Research</h1>
        <p style={{ margin: '0.25rem 0 0 0', color: 'var(--color-text-secondary, #666)' }}>
          Resume a project, or start a new one when you are ready.
        </p>
      </header>

      {error && (
        <p role="alert" data-testid="research-home-error" style={{ color: 'var(--color-danger, #b00)', fontSize: '0.85rem' }}>
          {error}
        </p>
      )}

      {/*
        Resume first: the most recently updated
        project is the visual primary.
      */}
      <section data-testid="research-home-resume" aria-label="Resume" style={{ marginBottom: '1rem' }}>
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>Resume</h2>
        {loading ? (
          <p data-testid="research-projects-loading" style={{ color: 'var(--color-text-secondary, #666)' }}>
            Loading projects…
          </p>
        ) : resumeProject ? (
          <div data-testid="research-home-resume-actions">
            <Button
              variant="primary"
              size="md"
              onClick={() => props.onOpenProject(resumeProject.id)}
              data-testid="research-home-resume-button"
            >
              Open “{resumeProject.name}”
            </Button>
          </div>
        ) : (
          <p data-testid="research-projects-empty" style={{ color: 'var(--color-text-secondary, #666)' }}>
            No projects yet. Start one below when you are ready.
          </p>
        )}
      </section>

      <section data-testid="research-projects-list" aria-label="Your projects" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>Your projects</h2>
          {!showNew && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowNew(true);
                setError(null);
              }}
              data-testid="research-new-project-toggle"
            >
              New project
            </Button>
          )}
        </div>
        {projects.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
            {projects.map((p) => (
              <li key={p.id}>
                <ProjectRow
                  project={p}
                  onOpen={() => props.onOpenProject(p.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {showNew && (
        <Surface
          data-testid="research-new-project"
          style={{ padding: '1rem', borderRadius: '0.5rem' }}
        >
          <h2 style={{ margin: 0, fontSize: '1rem' }}>New project</h2>
          <p style={{ margin: '0.25rem 0 0.75rem 0', color: 'var(--color-text-secondary, #666)' }}>
            A freeform goal — you can refine it later.
          </p>
          <form onSubmit={handleCreate} data-testid="research-new-project-form">
            <label
              htmlFor="research-new-project-name"
              style={{ display: 'block', marginBottom: '0.5rem' }}
            >
              <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                Name
              </span>
              <Input
                id="research-new-project-name"
                data-testid="research-new-project-name"
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
                placeholder="e.g. Sleep &amp; memory"
              />
            </label>
            <label
              htmlFor="research-new-project-brief"
              style={{ display: 'block', marginBottom: '0.75rem' }}
            >
              <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                Living Brief
              </span>
              <textarea
                id="research-new-project-brief"
                data-testid="research-new-project-brief"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="What is this project about?"
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
            <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowNew(false);
                  setName('');
                  setBrief('');
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={busy || name.trim().length === 0}
                data-testid="research-new-project-submit"
              >
                {busy ? 'Creating…' : 'Create project'}
              </Button>
            </div>
          </form>
        </Surface>
      )}
    </div>
  );
}

function ProjectRow(props: {
  readonly project: ResearchProject;
  readonly onOpen: () => void;
}): React.ReactElement {
  const p = props.project;
  return (
    <button
      type="button"
      onClick={props.onOpen}
      data-testid="research-project-row"
      data-project-id={p.id}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '0.75rem 0.875rem',
        border: '1px solid var(--color-border, #ccc)',
        borderRadius: 'var(--radius-sm, 4px)',
        background: 'var(--color-bg, transparent)',
        color: 'var(--color-text, inherit)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.5rem',
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontWeight: 600 }}>{p.name}</span>
        <span style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.85rem' }}>
          {p.livingBrief || 'No brief yet.'}
        </span>
      </span>
      <Pill data-testid="research-project-kind-pill">{p.kind}</Pill>
    </button>
  );
}
