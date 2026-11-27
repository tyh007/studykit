/**
 * StudyKit v0.5 — Research workbench composition root (ADR-003, P1).
 *
 * Registers the existing Research surfaces as workbench editors. No
 * surface is rewritten: each keeps its props, and every navigation
 * callback that used to push a full-page location now opens a tab.
 *
 * Explorer groups appear only when they have something in them
 * (progressive disclosure). Copy uses plain words: sources, excerpts,
 * points, writing.
 */

import React from 'react';
import '../../features/research/research.css';
import { isFeatureEnabled } from '../feature-flags';
import { locationStore, useLocation } from './locationStore';
import { makeAppLocation } from '../../domain/workspace';
import type { CanvasObjectRef } from '../../domain/canvas';
import { useCanvasRuntime } from './canvasWiringContext';
import { useResearchDeps } from '../../features/research/researchContext';
import { Workbench, type EditorDefinition } from '../../features/workbench/Workbench';
import { useWorkbenchState, type WorkbenchController } from '../../features/workbench/useWorkbenchState';
import { activeInput, inputKey, isRevealed, type EditorInput } from '../../features/workbench/workbenchState';
import { editorInputForLocation, encodeOpenParam, workbenchLocation } from './workbenchRoutes';
import { Button } from '../../shared/ui/Button';
import { buildLedger, type Ledger, type LedgerGap } from '../../application/research/ledger';
import type { Claim, ClaimEvidenceLink, Evidence } from '../../domain/research';
import { contextForFocus } from '../../application/research/aiContext';
import { setCapsuleOverride } from '../../features/ai/ui/openCapsule';
import { useCurrentUserId } from '../../lib/auth';
import { useAiSync } from './useAiSync';
import { useThinkingSync } from './useThinkingSync';
import { thinkingAccess } from '../../application/research/thinkingSync';
import { ThinkingCollabProvider, type ThinkingCollab } from '../../features/research/thinkingCollab';
import { openDisagreement, startBrainstorm } from '../../application/research/brainstorm';
import type { Disagreement } from '../../domain/brainstorm';

const ProjectHome = React.lazy(() => import('../../features/research/ProjectHome').then((m) => ({ default: m.ProjectHome })));
const Sources = React.lazy(() => import('../../features/research/Sources').then((m) => ({ default: m.Sources })));
const Discovery = React.lazy(() => import('../../features/research/Discovery').then((m) => ({ default: m.Discovery })));
const ResearchReader = React.lazy(() => import('../../features/research/ResearchReader').then((m) => ({ default: m.ResearchReader })));
const EvidenceWorkspace = React.lazy(() => import('../../features/research/EvidenceWorkspace').then((m) => ({ default: m.EvidenceWorkspace })));
const ProjectAiPanel = React.lazy(() => import('../../features/research/ProjectAiPanel').then((m) => ({ default: m.ProjectAiPanel })));
const BrainstormEditor = React.lazy(() => import('../../features/research/BrainstormEditor').then((m) => ({ default: m.BrainstormEditor })));
const DisagreementEditor = React.lazy(() => import('../../features/research/DisagreementEditor').then((m) => ({ default: m.DisagreementEditor })));
const ProvenanceReportView = React.lazy(() =>
  import('../../features/research/ProvenanceReportView').then((m) => ({ default: m.ProvenanceReportView })),
);
const AgendaEditor = React.lazy(() => import('../../features/research/AgendaEditor').then((m) => ({ default: m.AgendaEditor })));
const ArgumentEditor = React.lazy(() => import('../../features/research/ArgumentEditor').then((m) => ({ default: m.ArgumentEditor })));
const OutputWorkspace = React.lazy(() => import('../../features/research/OutputWorkspace').then((m) => ({ default: m.OutputWorkspace })));
const DesignWorkspace = React.lazy(() => import('../../features/research/DesignWorkspace').then((m) => ({ default: m.DesignWorkspace })));
const TaskDetail = React.lazy(() => import('../../features/research/TaskDetail').then((m) => ({ default: m.TaskDetail })));
const CognitiveCanvasView = React.lazy(() => import('../../features/canvas/CognitiveCanvasView').then((m) => ({ default: m.CognitiveCanvasView })));

interface ProjectIndex {
  readonly loaded: boolean;
  readonly name: string;
  readonly question: string;
  readonly works: readonly { id: string; title: string }[];
  readonly outputs: readonly { id: string; title: string }[];
  readonly tasks: readonly { id: string; title: string }[];
  readonly excerptCount: number;
  readonly pointCount: number;
  readonly claims: readonly Claim[];
  readonly evidence: readonly Evidence[];
  readonly links: readonly ClaimEvidenceLink[];
  readonly brainstorms: readonly { id: string; title: string }[];
  readonly disagreements: readonly Disagreement[];
}

const TRANSIENT_PARAMS: readonly string[] = ['add', 'details', 'point'];

const EMPTY_INDEX: ProjectIndex = {
  loaded: false,
  name: '',
  question: '',
  works: [],
  outputs: [],
  tasks: [],
  excerptCount: 0,
  pointCount: 0,
  claims: [],
  evidence: [],
  links: [],
  brainstorms: [],
  disagreements: [],
};

/** Live index of the project's objects for the explorer and tab titles. */
function useProjectIndex(projectId: string): ProjectIndex {
  const { repository } = useResearchDeps();
  const [index, setIndex] = React.useState<ProjectIndex>(EMPTY_INDEX);
  React.useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      const [project, works, outputs, tasks, evidence, claims, links, brainstorms, disagreements] = await Promise.all([
        repository.getProject(projectId),
        repository.listWorks({ projectId }),
        repository.listOutputs({ projectId }),
        repository.listTasks({ projectId }),
        repository.listEvidence({ projectId }),
        repository.listClaims({ projectId }),
        repository.listLinks({ projectId }),
        repository.listBrainstorms({ projectId }),
        repository.listDisagreements({ projectId }),
      ]);
      if (cancelled) return;
      const byTitle = (a: { title: string }, b: { title: string }): number => a.title.localeCompare(b.title);
      setIndex({
        loaded: true,
        name: project?.name ?? '',
        question: project?.livingBrief ?? '',
        works: works.map((w) => ({ id: w.id, title: w.title || 'Untitled source' })).sort(byTitle),
        outputs: outputs.map((o) => ({ id: o.id, title: o.title || 'Untitled draft' })).sort(byTitle),
        tasks: tasks.map((t) => ({ id: t.id, title: t.title })),
        excerptCount: evidence.filter((e) => e.status !== 'rejected').length,
        pointCount: claims.length,
        claims,
        evidence,
        links,
        brainstorms: brainstorms.map((b) => ({ id: b.id, title: b.prompt || 'Brainstorm' })),
        disagreements,
      });
    };
    void refresh().catch(() => {
      if (!cancelled) setIndex((prev) => ({ ...prev, loaded: true }));
    });
    const off = repository.subscribe(() => void refresh().catch(() => undefined));
    return () => {
      cancelled = true;
      off();
    };
  }, [projectId, repository]);
  return index;
}

export interface ResearchWorkbenchProps {
  readonly projectId: string;
}

export function ResearchWorkbench(props: ResearchWorkbenchProps): React.ReactElement {
  const { projectId } = props;
  const location = useLocation();
  // `add` (open the add panel) and `details` (expand project details) are
  // one-shot requests, not something to restore after a reload.
  const controller = useWorkbenchState(projectId, { transientParams: TRANSIENT_PARAMS });
  const index = useProjectIndex(projectId);
  const canvasRuntime = useCanvasRuntime();
  const { state } = controller;

  // URL ⇄ tabs. The URL always names the active editor
  // (#/research/workbench/<id>?open=<kind>:<id>), and a URL that names
  // a different editor (deep link, Add menu, legacy link) opens it.
  // Two refs keep the directions from feeding each other:
  // - `lastWritten`: the key this component last put in the URL, so the
  //   echo of our own write is ignored;
  // - `pending`: an editor the URL asked for that is not active yet, so
  //   the URL is not overwritten with the old tab in the meantime.
  const requested = editorInputForLocation(location);
  const requestedKey = requested ? inputKey(requested) : '';
  const current = activeInput(state);
  const currentKey = current ? inputKey(current) : '';
  const lastWritten = React.useRef<string | null>(null);
  const pending = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!requested || requestedKey === lastWritten.current || requestedKey === currentKey) return;
    pending.current = requestedKey;
    controller.open(requested);
    // `requested` is derived from `location`; the location is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  React.useEffect(() => {
    if (pending.current) {
      if (currentKey !== pending.current) return;
      pending.current = null;
    }
    lastWritten.current = currentKey || null;
    const alreadyThere =
      location.surface === 'workbench' && (location.params?.open ?? '') === (current ? encodeOpenParam(current) : '');
    if (!alreadyThere) locationStore.replace(workbenchLocation(projectId, current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, projectId, location]);

  // 3. A project with saved tabs restores them; an empty one with
  //    sources opens the overview; a brand-new one shows the start screen.
  React.useEffect(() => {
    if (!index.loaded || requested || state.tabs.length > 0) return;
    if (index.works.length > 0 || index.outputs.length > 0) {
      controller.open({ kind: 'overview', id: projectId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index.loaded, projectId]);

  const open = React.useCallback(
    (input: EditorInput) => {
      if (input.kind === 'canvas') controller.reveal('canvas');
      if (input.kind === 'design') controller.reveal('design');
      if (input.kind === 'task') controller.reveal('tasks');
      controller.open(input);
    },
    [controller],
  );

  // Editors are memoised; they read the latest excerpts through a ref.
  const evidenceRef = React.useRef(index.evidence);
  evidenceRef.current = index.evidence;
  const { repository } = useResearchDeps();
  const userIdRef = React.useRef('local');
  const newBrainstorm = React.useCallback(() => {
    void startBrainstorm(repository, { projectId, prompt: '' }, { userId: userIdRef.current }).then((b) =>
      open({ kind: 'brainstorm', id: b.id }),
    );
  }, [repository, projectId, open]);
  const editors = useResearchEditors(projectId, open, canvasRuntime, evidenceRef, userIdRef);
  const ledger = React.useMemo(
    () => buildLedger({ claims: index.claims, evidence: index.evidence, links: index.links }),
    [index.claims, index.evidence, index.links],
  );
  const openDisagreements = React.useMemo(() => index.disagreements.filter((d) => d.status === 'open'), [index.disagreements]);

  // The project AI (P4). The header's Ask button and Cmd/Ctrl+K open the
  // docked panel here instead of the global capsule.
  const userId = useCurrentUserId();
  userIdRef.current = userId;
  const aiSync = useAiSync(projectId, userId);
  // P5b: brainstorms and disagreements follow project members.
  const access = thinkingAccess(aiSync.role);
  useThinkingSync({ projectId, userId, access, ...(aiSync.thinking ? { port: aiSync.thinking } : {}) });
  const thinkingCollab = React.useMemo<ThinkingCollab>(
    () => ({ access, hasMembers: aiSync.hasMembers, memberNames: aiSync.memberNames }),
    [access, aiSync.hasMembers, aiSync.memberNames],
  );
  const setAiOpen = controller.setAiOpen;
  React.useEffect(
    () =>
      setCapsuleOverride(() => {
        setAiOpen(true);
        window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('[data-testid="ai-input"]')?.focus(), 0);
        return true;
      }),
    [setAiOpen],
  );
  const aiContext = React.useMemo(
    () =>
      state.aiOpen
        ? contextForFocus(
            {
              projectName: index.name,
              question: index.question,
              works: index.works,
              outputs: index.outputs,
              claims: index.claims,
              evidence: index.evidence,
              links: index.links,
            },
            current ? { kind: current.kind, id: current.id } : null,
          )
        : [],
    [state.aiOpen, index, current?.kind, current?.id],
  );

  const titleFor = (input: EditorInput): string => {
    switch (input.kind) {
      case 'overview':
        return 'Overview';
      case 'library':
        return 'Sources';
      case 'search':
        return 'Find papers';
      case 'work':
        return index.works.find((w) => w.id === input.id)?.title ?? 'Source';
      case 'evidence':
        return 'Excerpts and points';
      case 'output':
        return index.outputs.find((o) => o.id === input.id)?.title ?? 'Writing';
      case 'argument':
        return 'Argument';
      case 'report':
        return `Report: ${index.outputs.find((o) => o.id === input.id)?.title ?? 'Writing'}`;
      case 'brainstorm':
        return index.brainstorms.find((b) => b.id === input.id)?.title ?? 'Brainstorm';
      case 'disagreement':
        return index.disagreements.find((d) => d.id === input.id)?.question ?? 'Disagreement';
      case 'agenda':
        return 'Meeting agenda';
      case 'design':
        return 'Research design';
      case 'task':
        return index.tasks.find((t) => t.id === input.id)?.title ?? 'Task';
      case 'canvas':
        return 'Canvas';
      default:
        return input.kind;
    }
  };

  return (
    <ThinkingCollabProvider value={thinkingCollab}>
    <Workbench
      controller={controller}
      editors={editors}
      titleFor={titleFor}
      explorerLabel="Project explorer"
      aside={{
        label: 'Project AI',
        content: (
          <React.Suspense fallback={<p className="workbench-loading sk-delayed-fallback" role="status">Loading…</p>}>
            <ProjectAiPanel
              projectId={projectId}
              userId={userId}
              context={aiContext}
              onClose={() => setAiOpen(false)}
              {...(aiSync.sync ? { sync: aiSync.sync } : {})}
              role={aiSync.role}
              memberNames={aiSync.memberNames}
              onOpenArgument={(claimId) =>
                open({ kind: 'argument', id: projectId, ...(claimId ? { params: { point: claimId } } : {}) })
              }
            />
          </React.Suspense>
        ),
      }}
      explorer={
        <ResearchExplorer
          projectId={projectId}
          index={index}
          controller={controller}
          open={open}
          onNewBrainstorm={newBrainstorm}
          showAgenda={aiSync.hasMembers || index.disagreements.length > 0}
        />
      }
      panel={
        ledger.points.length > 0 || ledger.excerptCount > 0 || openDisagreements.length > 0
          ? {
              title: 'What’s missing',
              summary: ledgerSummary(ledger, openDisagreements.length),
              content: (
                <LedgerPanel ledger={ledger} index={index} projectId={projectId} open={open} disagreements={openDisagreements} />
              ),
            }
          : undefined
      }
      emptyState={
        <div className="workbench-start" data-testid="workbench-start">
          <h1>{index.name || 'New project'}</h1>
          <p>Start with a paper, or write down what you want to figure out.</p>
          <div className="workbench-start-actions">
            <Button
              variant="primary"
              onClick={() => open({ kind: 'library', id: projectId, params: { add: '1' } })}
              data-testid="workbench-start-add-sources"
            >
              Add sources
            </Button>
            <Button
              variant="secondary"
              onClick={() => open({ kind: 'overview', id: projectId })}
              data-testid="workbench-start-write-question"
            >
              Write your question
            </Button>
          </div>
        </div>
      }
    />
    </ThinkingCollabProvider>
  );
}

// ---------------------------------------------------------------------------
// Explorer
// ---------------------------------------------------------------------------

interface ExplorerProps {
  readonly projectId: string;
  readonly index: ProjectIndex;
  readonly controller: WorkbenchController;
  readonly open: (input: EditorInput) => void;
  readonly onNewBrainstorm: () => void;
  /** P5b: once the project has members or disagreements. */
  readonly showAgenda: boolean;
}

function ResearchExplorer(props: ExplorerProps): React.ReactElement {
  const { projectId, index, controller } = props;
  const active = activeInput(controller.state);
  const isActive = (kind: string, id: string): boolean => active?.kind === kind && active.id === id;

  // Single click previews; double click keeps the tab (VS Code).
  const item = (input: EditorInput, label: string, testId: string): React.ReactElement => (
    <li key={inputKey(input)}>
      <button
        type="button"
        className="workbench-explorer-item"
        aria-current={isActive(input.kind, input.id) ? 'true' : undefined}
        title={label}
        onClick={() => controller.open(input, { preview: true })}
        onDoubleClick={() => props.open(input)}
        data-testid={testId}
      >
        {label}
      </button>
    </li>
  );

  const points = index.excerptCount + index.pointCount;

  return (
    <nav className="workbench-explorer" data-testid="workbench-explorer">
      <div className="workbench-explorer-header">
        <button
          type="button"
          className="workbench-explorer-back"
          onClick={() => locationStore.push(makeAppLocation({ mode: 'research', surface: 'research-home' }))}
          data-testid="workbench-all-projects"
        >
          ← All projects
        </button>
        <p className="workbench-explorer-title" data-testid="workbench-project-name">
          {index.name || '…'}
        </p>
      </div>

      <ul className="workbench-explorer-list">
        {item({ kind: 'overview', id: projectId }, 'Overview', 'workbench-explorer-overview')}
      </ul>

      <section className="workbench-explorer-group" aria-labelledby="workbench-group-sources">
        <div className="workbench-explorer-group-header">
          <h2 id="workbench-group-sources">Sources</h2>
          <button
            type="button"
            className="workbench-explorer-add"
            onClick={() => props.open({ kind: 'library', id: projectId, params: { add: '1' } })}
            aria-label="Add sources"
            data-testid="workbench-explorer-add-sources"
          >
            + Add
          </button>
        </div>
        {index.loaded && index.works.length === 0 ? (
          <p className="workbench-explorer-hint">Add a PDF or search for papers. They’ll show up here.</p>
        ) : (
          <ul className="workbench-explorer-list" data-testid="workbench-explorer-sources">
            {index.works.map((w) => item({ kind: 'work', id: w.id }, w.title, 'workbench-explorer-source'))}
          </ul>
        )}
      </section>

      {points > 0 && (
        <section className="workbench-explorer-group" aria-labelledby="workbench-group-points">
          <div className="workbench-explorer-group-header">
            <h2 id="workbench-group-points">Excerpts and points</h2>
          </div>
          <ul className="workbench-explorer-list">
            {item(
              { kind: 'evidence', id: projectId },
              `${plural(index.excerptCount, 'excerpt', 'excerpts')} · ${plural(index.pointCount, 'point', 'points')}`,
              'workbench-explorer-evidence',
            )}
          </ul>
        </section>
      )}

      {(index.outputs.length > 0 || points > 0) && (
        <section className="workbench-explorer-group" aria-labelledby="workbench-group-writing">
          <div className="workbench-explorer-group-header">
            <h2 id="workbench-group-writing">Writing</h2>
          </div>
          <ul className="workbench-explorer-list" data-testid="workbench-explorer-writing">
            {points > 0 && item({ kind: 'argument', id: projectId }, 'Argument', 'workbench-explorer-argument')}
            {index.outputs.map((o) => item({ kind: 'output', id: o.id }, o.title, 'workbench-explorer-output'))}
          </ul>
        </section>
      )}

      {(isRevealed(controller.state, 'canvas') ||
        isRevealed(controller.state, 'design') ||
        index.brainstorms.length > 0 ||
        index.disagreements.length > 0 ||
        props.showAgenda ||
        index.works.length > 0 ||
        points > 0) && (
        <section className="workbench-explorer-group" aria-labelledby="workbench-group-thinking">
          <div className="workbench-explorer-group-header">
            <h2 id="workbench-group-thinking">Thinking</h2>
            <button
              type="button"
              className="workbench-explorer-add"
              onClick={props.onNewBrainstorm}
              aria-label="New brainstorm"
              data-testid="workbench-explorer-new-brainstorm"
            >
              + Brainstorm
            </button>
          </div>
          <ul className="workbench-explorer-list" data-testid="workbench-explorer-thinking">
            {props.showAgenda && item({ kind: 'agenda', id: projectId }, 'Meeting agenda', 'workbench-explorer-agenda')}
            {index.brainstorms.map((b) => item({ kind: 'brainstorm', id: b.id }, b.title, 'workbench-explorer-brainstorm'))}
            {index.disagreements.map((d) =>
              item(
                { kind: 'disagreement', id: d.id },
                `${d.status === 'open' ? 'Disagreement' : 'Settled'}: ${d.question}`,
                'workbench-explorer-disagreement',
              ),
            )}
            {isRevealed(controller.state, 'canvas') &&
              item({ kind: 'canvas', id: `canvas-${projectId}` }, 'Canvas', 'workbench-explorer-canvas')}
            {isRevealed(controller.state, 'design') &&
              item({ kind: 'design', id: projectId }, 'Research design', 'workbench-explorer-design')}
          </ul>
        </section>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// What's missing (the verification ledger, P2)
// ---------------------------------------------------------------------------

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function ledgerSummary(ledger: Ledger, openDisagreements = 0): string {
  const parts = [plural(ledger.points.length, 'point', 'points')];
  if (ledger.points.length > 0) parts.push(`${ledger.supportedCount} well supported`);
  if (openDisagreements > 0) parts.push(plural(openDisagreements, 'open disagreement', 'open disagreements'));
  parts.push(ledger.gaps.length === 0 ? 'nothing missing' : plural(ledger.gaps.length, 'thing to look at', 'things to look at'));
  return parts.join(' · ');
}

function gapText(gap: LedgerGap, index: ProjectIndex): { label: string; detail?: string } {
  switch (gap.kind) {
    case 'no-support':
      return { label: `“${gap.title}” has no supporting excerpt yet` };
    case 'contested':
      return { label: `“${gap.title}” has ${plural(gap.contradicts, 'excerpt', 'excerpts')} against it` };
    case 'single-source':
      return { label: `“${gap.title}” rests on a single source` };
    case 'unconnected-excerpt': {
      const title = index.works.find((w) => w.id === gap.workId)?.title ?? 'a source';
      const where = gap.pageNumber ? `, p. ${gap.pageNumber}` : '';
      return {
        label: `Excerpt from ${title}${where} isn’t connected to a point`,
        detail: gap.quote.length > 140 ? `${gap.quote.slice(0, 140)}…` : gap.quote,
      };
    }
  }
}

function LedgerPanel(props: {
  readonly ledger: Ledger;
  readonly index: ProjectIndex;
  readonly projectId: string;
  readonly open: (input: EditorInput) => void;
  readonly disagreements?: readonly Disagreement[];
}): React.ReactElement {
  const { ledger } = props;
  const disagreements = props.disagreements ?? [];
  const disputes =
    disagreements.length > 0 ? (
      <ul className="workbench-ledger" data-testid="ledger-disagreements">
        {disagreements.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              className="workbench-ledger-item workbench-ledger-item--disagreement"
              onClick={() => props.open({ kind: 'disagreement', id: d.id })}
              data-testid="ledger-disagreement"
            >
              <span className="workbench-ledger-label">Open disagreement: {d.question}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : null;
  if (ledger.gaps.length === 0) {
    if (disputes) return disputes;
    return (
      <p className="workbench-ledger-done" data-testid="ledger-done">
        Every point is backed by two or more sources, and every excerpt is connected.
      </p>
    );
  }
  return (
    <>
    {disputes}
    <ul className="workbench-ledger" data-testid="ledger-gaps">
      {ledger.gaps.map((gap) => {
        const { label, detail } = gapText(gap, props.index);
        const target: EditorInput =
          gap.kind === 'unconnected-excerpt'
            ? { kind: 'work', id: gap.workId, ...(gap.pageNumber ? { params: { page: String(gap.pageNumber) } } : {}) }
            : { kind: 'argument', id: props.projectId, params: { point: gap.claimId } };
        const key = gap.kind === 'unconnected-excerpt' ? gap.evidenceId : `${gap.kind}:${gap.claimId}`;
        return (
          <li key={key}>
            <button
              type="button"
              className={`workbench-ledger-item workbench-ledger-item--${gap.kind}`}
              onClick={() => props.open(target)}
              data-testid="ledger-gap"
              data-gap-kind={gap.kind}
            >
              <span className="workbench-ledger-label">{label}</span>
              {detail ? <span className="workbench-ledger-detail">{detail}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
// Editors
// ---------------------------------------------------------------------------

function useResearchEditors(
  projectId: string,
  open: (input: EditorInput) => void,
  canvasRuntime: ReturnType<typeof useCanvasRuntime>,
  evidenceRef: React.MutableRefObject<readonly Evidence[]>,
  userIdRef: React.MutableRefObject<string>,
): Readonly<Record<string, EditorDefinition>> {
  const { repository } = useResearchDeps();
  return React.useMemo(() => {
    const overview = (): void => open({ kind: 'overview', id: projectId });
    const library = (): void => open({ kind: 'library', id: projectId });
    const evidence = (): void => open({ kind: 'evidence', id: projectId });
    const work = (workId: string): void => open({ kind: 'work', id: workId });
    const source = (workId: string, pageNumber?: number): void =>
      open({ kind: 'work', id: workId, ...(pageNumber ? { params: { page: String(pageNumber) } } : {}) });
    const p5 = { get userId() { return userIdRef.current; } };
    const newBrainstorm = (): void => {
      void startBrainstorm(repository, { projectId, prompt: '' }, { userId: p5.userId }).then((b) =>
        open({ kind: 'brainstorm', id: b.id }),
      );
    };
    const raiseDisagreement = (claimId: string, question: string): void => {
      void openDisagreement(repository, { projectId, claimId, question }, { userId: p5.userId }).then((d) =>
        open({ kind: 'disagreement', id: d.id }),
      );
    };
    const argumentAt = (claimId: string): void => open({ kind: 'argument', id: projectId, params: { point: claimId } });
    // A citation in a draft opens its source at the cited page.
    const excerpt = ({ evidenceId }: { evidenceId: string }): void => {
      const e = evidenceRef.current.find((x) => x.id === evidenceId);
      if (e) source(e.workId, e.locator.pageNumber);
      else evidence();
    };

    const editors: Record<string, EditorDefinition> = {
      overview: {
        render: (input) => (
          <ProjectHome
            projectId={projectId}
            initialDetailsOpen={input.params?.details === '1'}
            onOpenDiscovery={() => open({ kind: 'search', id: projectId })}
            onOpenLibrary={library}
            onOpenEvidence={evidence}
            onOpenCanvas={() => open({ kind: 'canvas', id: `canvas-${projectId}` })}
            onOpenReader={({ workId }) => work(workId)}
            onOpenDesign={({ questionId }) =>
              open({ kind: 'design', id: projectId, ...(questionId ? { params: { question: questionId } } : {}) })
            }
            onOpenTask={({ taskId }) => open({ kind: 'task', id: taskId })}
            onOpenOutput={({ outputId }) => open({ kind: 'output', id: outputId })}
          />
        ),
      },
      library: {
        render: (input) => (
          <Sources
            projectId={projectId}
            initialView="library"
            initialAdd={input.params?.add === '1'}
            onOpenReader={({ workId }) => work(workId)}
            onBackToProject={overview}
          />
        ),
      },
      search: {
        render: () => <Discovery projectId={projectId} onClose={overview} onOpenLibrary={library} />,
      },
      work: {
        render: (input) => (
          <ResearchReader
            projectId={projectId}
            workId={input.id}
            onBackToLibrary={library}
            onOpenEvidence={evidence}
            {...(input.params?.page ? { initialPageNumber: Number(input.params.page) } : {})}
          />
        ),
      },
      evidence: {
        render: () => (
          <EvidenceWorkspace
            projectId={projectId}
            onBackToProject={overview}
            onOpenLibrary={library}
            onOpenWork={({ workId }) => work(workId)}
            cognitiveCanvasAvailable={Boolean(canvasRuntime)}
            onOpenCanvas={({ evidenceIds, claimIds }) => {
              const params: Record<string, string> = {};
              if (evidenceIds.length > 0) params.evidence = evidenceIds.join(',');
              if (claimIds.length > 0) params.claim = claimIds.join(',');
              open({ kind: 'canvas', id: `canvas-${projectId}`, ...(Object.keys(params).length > 0 ? { params } : {}) });
            }}
          />
        ),
      },
      output: {
        render: (input) => (
          <OutputWorkspace
            projectId={projectId}
            outputId={input.id}
            onBackToProject={overview}
            onJumpToEvidence={excerpt}
            onJumpToClaim={({ claimId }) => open({ kind: 'argument', id: projectId, params: { point: claimId } })}
            onOpenReader={({ workId }) => work(workId)}
            onOpenReport={() => open({ kind: 'report', id: input.id })}
          />
        ),
      },
      report: {
        render: (input) => (
          <ProvenanceReportView
            outputId={input.id}
            onOpenOutput={() => open({ kind: 'output', id: input.id })}
            onOpenSource={({ workId, pageNumber }) => source(workId, pageNumber)}
          />
        ),
      },
      argument: {
        render: (input) => (
          <ArgumentEditor
            projectId={projectId}
            {...(input.params?.point ? { focusPointId: input.params.point } : {})}
            onOpenSource={({ workId, pageNumber }) => source(workId, pageNumber)}
            onOpenOutput={(outputId) => open({ kind: 'output', id: outputId })}
            onOpenSources={library}
            onStartBrainstorm={newBrainstorm}
            onRaiseDisagreement={raiseDisagreement}
            onOpenDisagreement={(id) => open({ kind: 'disagreement', id })}
          />
        ),
      },
      brainstorm: {
        render: (input) => (
          <BrainstormEditor
            brainstormId={input.id}
            userId={p5.userId}
            onOpenArgument={() => open({ kind: 'argument', id: projectId })}
          />
        ),
      },
      agenda: {
        render: () => (
          <AgendaEditor
            projectId={projectId}
            onOpen={(target) => {
              if (target.kind === 'disagreement') open({ kind: 'disagreement', id: target.id });
              else if (target.kind === 'brainstorm') open({ kind: 'brainstorm', id: target.id });
              else if (target.kind === 'point') argumentAt(target.claimId);
              else source(target.workId, target.pageNumber);
            }}
          />
        ),
      },
      disagreement: {
        render: (input) => (
          <DisagreementEditor
            disagreementId={input.id}
            userId={p5.userId}
            onOpenSource={({ workId, pageNumber }) => source(workId, pageNumber)}
            onOpenPoint={argumentAt}
            onOpenSources={library}
          />
        ),
      },
      design: {
        render: (input) => (
          <DesignWorkspace
            projectId={projectId}
            {...(input.params?.question ? { questionId: input.params.question } : {})}
            onBackToProject={overview}
          />
        ),
      },
      task: {
        render: (input) => (
          <TaskDetail
            projectId={projectId}
            taskId={input.id}
            onBackToProject={overview}
            onOpenQuestion={() => open({ kind: 'design', id: projectId })}
            onOpenDecision={() => open({ kind: 'design', id: projectId })}
          />
        ),
      },
      canvas: {
        render: (input) => {
          if (!isFeatureEnabled('v04Canvas') || !canvasRuntime) {
            return (
              <p className="workbench-loading" role="status" data-testid="cognitive-canvas-unavailable">
                The canvas isn’t available in this workspace.
              </p>
            );
          }
          const refs: CanvasObjectRef[] = [
            ...(input.params?.evidence ?? '')
              .split(',')
              .filter(Boolean)
              .map((id) => ({ kind: 'knowledge' as const, id, objectKind: 'evidence' as const })),
            ...(input.params?.claim ?? '')
              .split(',')
              .filter(Boolean)
              .map((id) => ({ kind: 'knowledge' as const, id, objectKind: 'claim' as const })),
          ];
          return (
            <CognitiveCanvasView
              viewId={input.id}
              useCases={canvasRuntime.useCases}
              repository={canvasRuntime.repository}
              initialRefs={refs}
            />
          );
        },
      },
    };
    return editors;
  }, [projectId, open, canvasRuntime, repository]);
}
