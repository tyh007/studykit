/**
 * StudyKit v0.4 — `features/research/ProjectHome`
 *
 * Project-scoped landing surface. Pure orchestrator:
 * loads state through the research repository, owns
 * form-state, and hands the heavy layout to focused
 * sibling components in `project-home/`. The
 * orchestrator itself stays under ~350 lines; the
 * sections (LivingBrief, QuickActions, StatusGrid,
 * OpenQuestions, Hypotheses, Risks, Milestones,
 * Tasks, Lineage) each live in their own file.
 *
 * Empty state: the brief is freeform; the status
 * sections stay empty until the user has objects. The
 * surface never demands a Research Question.
 */

import React from 'react';
import { useResearchDeps } from './researchContext';
import {
  deriveProjectHomeStatus,
  createTask,
  createResearchQuestion,
  updateResearchQuestion,
  createHypothesis,
  createRisk,
  createMilestone,
  addTaskDependency,
} from '../../application/research/researchDesignUseCases';
import { updateLivingBrief } from '../../application/research/researchUseCases';
import { createOutput } from '../../application/output/outputUseCases';
import type { OutputDocument } from '../../domain/output';
import { useCollaborationDepsOptional } from '../collaboration/collaborationContext';
import { enqueueTaskShared } from '../../application/collaboration/syncService';
import { ACTION_RESEARCH_SUGGEST_DESIGN_TASKS } from '../../features/ai/kernel';
import { setDesignTaskWriter } from '../../features/ai/kernel/actions/safeActions';
import { openCapsule } from '../../features/ai/ui/openCapsule';
import type {
  Claim,
  Evidence,
  ResearchProject,
  SearchRun,
  Work,
} from '../../domain/research';
import type {
  ResearchTask,
  ResearchQuestion,
  Hypothesis,
  HypothesisKind,
  ResearchRisk,
  ResearchRiskKind,
  Milestone,
  MilestoneKind,
} from '../../domain/researchDesign';
import {
  LivingBriefCard,
  QuickActionsRow,
  StatusGrid,
  OpenQuestionsSection,
  HypothesisSection,
  RisksSection,
  MilestonesSection,
  TasksSection,
  LineageColumns,
} from './project-home';
import { Button } from '../../shared/ui/Button';
import { Surface } from '../../shared/ui/Surface';
import './researchDesign.css';
import { CollaborationPanel } from '../collaboration/CollaborationPanel';
import { isFeatureEnabled } from '../../app/feature-flags';
import { assignTask, unassignTask } from '../../application/research/researchDesignUseCases';
import { listOutboxStatus } from '../../application/collaboration/syncService';
import type { OutboxStatus } from '../../application/collaboration/syncService';
import { recordTaskAssignment } from '../../application/collaboration/collaborationUseCases';

export interface ProjectHomeProps {
  readonly projectId: string;
  readonly onOpenDiscovery: (projectId: string) => void;
  readonly onOpenLibrary: (projectId: string) => void;
  readonly onOpenEvidence: (projectId: string) => void;
  readonly onOpenCanvas: (projectId: string) => void;
  readonly onOpenReader: (input: { projectId: string; workId: string }) => void;
  /**
   * Open the design workspace, optionally anchored to
   * a specific Research Question. The questionId is
   * forwarded so `createDesignSpec` preserves the
   * link. The router reads it from URL params.
   */
  readonly onOpenDesign: (input: { projectId: string; questionId?: string }) => void;
  readonly onOpenTask: (input: { projectId: string; taskId: string }) => void;
  /** WP-10 Round 1: open an existing Output. The
   *  router forwards the id to the workspace. */
  readonly onOpenOutput: (input: { projectId: string; outputId: string }) => void;
  /** Create a new outline Output and open it. The
   *  router pushes the surface once the use case
   *  has produced an id. */
  readonly initialDetailsOpen?: boolean;
}

export function ProjectHome(props: ProjectHomeProps): React.ReactElement {
  const deps = useResearchDeps();
  // The collab slice is opt-in: when the
  // `<CollaborationProvider>` is not mounted, the
  // publish flow still works (the canonical
  // writer creates the Task in the research repo)
  // but the cross-user `task-shared` enqueue is
  // a no-op. The host (V04Shell) mounts the
  // CollaborationProvider when the
  // `v04Collaboration` flag is on.
  const collabDeps = useCollaborationDepsOptional();
  // eslint-disable-next-line no-console
  if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
    /* debug-removed */
  }
  const [project, setProject] = React.useState<ResearchProject | null>(null);
  const [brief, setBrief] = React.useState<string>('');
  const [dirty, setDirty] = React.useState(false);
  // WP-11R2: the secondary sections (Questions /
  // Hypotheses / Risks / Milestones / Tasks / Lineage)
  // are hidden by default and live inside a
  // "Project details" expander. The first screen shows
  // only Focus / Continue / Add / Next / Recent.
  const [showProjectDetails, setShowProjectDetails] = React.useState(props.initialDetailsOpen ?? false);
  const [recentEvidence, setRecentEvidence] = React.useState<readonly Evidence[]>([]);
  const [recentClaims, setRecentClaims] = React.useState<readonly Claim[]>([]);
  const [worksById, setWorksById] = React.useState<ReadonlyMap<string, Work>>(new Map());
  const [lastRun, setLastRun] = React.useState<SearchRun | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<Awaited<ReturnType<typeof deriveProjectHomeStatus>> | null>(null);
  const [tasks, setTasks] = React.useState<readonly ResearchTask[]>([]);
  const [questions, setQuestions] = React.useState<readonly ResearchQuestion[]>([]);
  const [hypotheses, setHypotheses] = React.useState<readonly Hypothesis[]>([]);
  const [risks, setRisks] = React.useState<readonly ResearchRisk[]>([]);
  const [milestones, setMilestones] = React.useState<readonly Milestone[]>([]);
  const [outputs, setOutputs] = React.useState<readonly OutputDocument[]>([]);
  const [aiError, setAiError] = React.useState<string | null>(null);

  // P0-5: Shared Task UI state. The
  // `assignableMembers` is the project's
  // collaborator list (the assignee MUST be
  // a member). The `canAssign` flag is
  // `true` for owner / editor. The
  // `outboxStatusFor` looks up the per-task
  // outbox status so the row surfaces
  // "queued" / "synced" / "failed".
  const [assignableMembers, setAssignableMembers] = React.useState<readonly { userId: string; displayName: string }[]>([]);
  const [myRole, setMyRole] = React.useState<string | null>(null);
  const [taskOutbox, setTaskOutbox] = React.useState<ReadonlyMap<string, OutboxStatus>>(new Map());

  const canAssignTasks = myRole === 'owner' || myRole === 'editor';

  const reloadSharedTaskState = React.useCallback(async (): Promise<void> => {
    if (!collabDeps) {
      setAssignableMembers([]);
      setMyRole(null);
      return;
    }
    try {
      const members = await collabDeps.repository.listCollaborators({ projectId: props.projectId });
      setAssignableMembers(
        members.map((m) => ({ userId: m.userId, displayName: m.displayName })),
      );
      const me = members.find((m) => m.userId === collabDeps.localUserId);
      setMyRole(me?.role ?? null);
    } catch {
      setAssignableMembers([]);
      setMyRole(null);
    }
  }, [collabDeps, props.projectId]);

  const reloadOutboxStatus = React.useCallback(async (): Promise<void> => {
    try {
      const rows = await listOutboxStatus(props.projectId);
      const map = new Map<string, OutboxStatus>();
      for (const r of rows) {
        // The map is keyed by the task's
        // target id (the op's payload
        // carries `taskId`). The op kinds
        // we surface are `task-assigned`
        // and `task-status-changed`. The
        // per-task "status" is the latest
        // op for the task.
        if (r.kind === 'task-assigned' || r.kind === 'task-status-changed') {
          try {
            const payload = JSON.parse(r.payload) as { taskId?: string };
            if (payload.taskId) {
              map.set(payload.taskId, r.status);
            }
          } catch {
            // ignore malformed payload
          }
        }
      }
      setTaskOutbox(map);
    } catch {
      setTaskOutbox(new Map());
    }
  }, [props.projectId]);

  React.useEffect(() => {
    void reloadSharedTaskState();
  }, [reloadSharedTaskState]);

  React.useEffect(() => {
    void reloadOutboxStatus();
  }, [reloadOutboxStatus]);

  const outboxStatusFor = React.useCallback(
    (taskId: string): OutboxStatus | null => taskOutbox.get(taskId) ?? null,
    [taskOutbox],
  );

  const onAssignTask = async (taskId: string, userId: string, displayName: string): Promise<void> => {
    setError(null);
    try {
      const previous = tasks.find((task) => task.id === taskId);
      const updated = await assignTask(deps.repository, {
        projectId: props.projectId,
        taskId,
        assigneeUserId: userId,
        assigneeDisplayName: displayName,
      });
      if (collabDeps) {
        await recordTaskAssignment(collabDeps, {
          projectId: props.projectId,
          taskId,
          taskTitle: updated.title,
          assignee: updated.assignee,
          previousAssignee: previous?.assignee ?? null,
        });
      }
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      if (collabDeps?.tickSync) {
        await collabDeps.tickSync(props.projectId);
      }
      await reloadOutboxStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign task.');
    }
  };

  const onUnassignTask = async (taskId: string): Promise<void> => {
    setError(null);
    try {
      const previous = tasks.find((task) => task.id === taskId);
      const updated = await unassignTask(deps.repository, {
        projectId: props.projectId,
        taskId,
      });
      if (collabDeps) {
        await recordTaskAssignment(collabDeps, {
          projectId: props.projectId,
          taskId,
          taskTitle: updated.title,
          assignee: null,
          previousAssignee: previous?.assignee ?? null,
        });
      }
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      if (collabDeps?.tickSync) {
        await collabDeps.tickSync(props.projectId);
      }
      await reloadOutboxStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unassign task.');
    }
  };

  // Form state. The form-save handlers update
  // local state synchronously so the new rows
  // re-render in the same tick as the form closes
  // (no async setState cascade that escapes the
  // userEvent act boundary).
  const [showNewQuestion, setShowNewQuestion] = React.useState(false);
  const [editingQuestionId, setEditingQuestionId] = React.useState<string | null>(null);
  const [questionText, setQuestionText] = React.useState('');
  const [questionRationale, setQuestionRationale] = React.useState('');
  const [questionScope, setQuestionScope] = React.useState('');

  const [showNewHypothesis, setShowNewHypothesis] = React.useState(false);
  const [hypothesisKind, setHypothesisKind] = React.useState<HypothesisKind>('hypothesis');
  const [hypothesisText, setHypothesisText] = React.useState('');
  const [hypothesisRationale, setHypothesisRationale] = React.useState('');
  // The hypothesis form can optionally link the new
  // row to an existing open Research Question. The
  // select is empty by default (unlinked); the user
  // picks a question when the hypothesis answers one.
  const [hypothesisQuestionId, setHypothesisQuestionId] = React.useState<string>('');

  const [showNewRisk, setShowNewRisk] = React.useState(false);
  const [riskKind, setRiskKind] = React.useState<ResearchRiskKind>('risk');
  const [riskTitle, setRiskTitle] = React.useState('');
  const [riskBody, setRiskBody] = React.useState('');
  const [riskSeverity, setRiskSeverity] = React.useState<'low' | 'medium' | 'high'>('medium');
  const [riskMitigation, setRiskMitigation] = React.useState('');

  const [showNewMilestone, setShowNewMilestone] = React.useState(false);
  const [milestoneKind, setMilestoneKind] = React.useState<MilestoneKind>('proposal');
  const [milestoneLabel, setMilestoneLabel] = React.useState('');
  const [milestoneTarget, setMilestoneTarget] = React.useState('');

  const [showNewTask, setShowNewTask] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState('');
  const [newWhy, setNewWhy] = React.useState('');
  const [newDod, setNewDod] = React.useState('');

  // Keep a ref of the latest `brief` so the `reload`
  // callback can read it *without* subscribing to
  // changes. The earlier `useCallback` included
  // `brief` in its deps, which created a feedback
  // loop: every setState re-created the callback,
  // the useEffect re-fired `reload`, and the
  // component flickered between "loading" and the
  // h1 — leaving the production test stuck in the
  // loading state.
  const briefRef = React.useRef<string>('');
  briefRef.current = brief;

  const reload = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const p = await deps.repository.getProject(props.projectId);
      setProject(p);
      if (p && briefRef.current === '') {
        setBrief(p.livingBrief);
      }
      const [ev, cl, runs, works, next, ts, qs, hs, rs, ms] = await Promise.all([
        deps.repository.listEvidence({ projectId: props.projectId }),
        deps.repository.listClaims({ projectId: props.projectId }),
        deps.repository.listRuns({ projectId: props.projectId, limit: 1 }),
        deps.repository.listWorks({ projectId: props.projectId }),
        deriveProjectHomeStatus(deps.repository, props.projectId),
        deps.repository.listTasks({ projectId: props.projectId, limit: 200 }),
        deps.repository.listQuestions({ projectId: props.projectId, limit: 100 }),
        deps.repository.listHypotheses({ projectId: props.projectId, limit: 100 }),
        deps.repository.listRisks({ projectId: props.projectId, limit: 100 }),
        deps.repository.listMilestones({ projectId: props.projectId, limit: 100 }),
      ]);
      // eslint-disable-next-line no-console
      if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
        /* debug-removed */
      }
      setRecentEvidence(ev.slice(0, 3));
      setRecentClaims(cl.slice(0, 3));
      setLastRun(runs[0] ?? null);
      setWorksById(new Map(works.map((w) => [w.id, w])));
      setStatus(next);
      setTasks(ts);
      setQuestions(qs);
      setHypotheses(hs);
      setRisks(rs);
      setMilestones(ms);
      const outs = await deps.repository.listOutputs({ projectId: props.projectId });
      setOutputs(outs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project.');
    } finally {
      setLoading(false);
    }
  }, [deps, props.projectId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  // WP-08 Round 2: when the collab gateway
  // applies a remote `task-shared` op to
  // the local research repo, the
  // ProjectHome's `tasks` state is stale
  // until the next reload. The collab
  // panel's tick is scoped to the panel;
  // the ProjectHome runs its own tick so
  // a cross-user task is visible to the
  // user as soon as the inbox applies it.
  // The tick is best-effort (a network
  // failure is logged and the next
  // mount retries).
  React.useEffect(() => {
    if (!collabDeps?.tickSync) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await collabDeps.tickSync?.(project?.id ?? props.projectId);
        if (cancelled) return;
        if (r && typeof r === 'object' && 'pulled' in r) {
          const pulled = (r as { pulled?: { applied?: number } }).pulled;
          if (pulled && (pulled.applied ?? 0) > 0) {
            await reload();
          }
        }
      } catch {
        // best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // Wire the design-task accept writer once per
  // mount so the AI action can route Accepts to the
  // right use case. The writer forwards the typed
  // `origin` (set by `acceptDesignTaskSuggestion`
  // for AI-Accepted tasks) so the canonical row
  // carries the structured Draft Layer provenance.
  React.useEffect(() => {
    setDesignTaskWriter({
      createTask: async (input) => {
        const created = await createTask(deps.repository, {
          projectId: input.projectId,
          title: input.title,
          why: input.why,
          definitionOfDone: input.definitionOfDone,
          sourceRef: input.sourceRef,
          sourceNote: input.sourceNote,
          // WP-07 Round 4 P0-3: the safe action
          // resolves every dependsOnTaskTitles hint
          // BEFORE calling createTask, so the
          // canonical `ResearchTask` is written with
          // its initial `dependencies` in a single
          // atomic pass. We do NOT add dependencies
          // via a separate `addTaskDependency` call
          // — that path was the source of the
          // half-success / non-atomic behaviour. The
          // use case's existing invariant (no self,
          // no missing ids, no cycle) runs as part
          // of the create and rejects the whole write
          // if any hint is unsupported.
          ...(input.dependencies && input.dependencies.length > 0
            ? { dependencies: input.dependencies }
            : {}),
          ...(input.origin
            ? { origin: input.origin as unknown as Parameters<typeof createTask>[1]['origin'] }
            : {}),
        });
        return { id: created.id };
      },
      addTaskDependency: async (input) => {
        // Kept on the writer for backward compatibility
        // (older callers may still use the two-step
        // create-then-deps path), but the canonical
        // WP-07 Round 4 flow goes through
        // `createTask.dependencies` instead. We
        // forward to the use case so existing tests
        // and any legacy caller keep working.
        await addTaskDependency(deps.repository, input);
        return { ok: true };
      },
    });
    return () => {
      setDesignTaskWriter(null);
    };
  }, [deps.repository]);

  const saveBrief = async (): Promise<void> => {
    if (!project) return;
    try {
      const next = await updateLivingBrief(deps.repository, {
        projectId: project.id,
        livingBrief: brief,
      });
      setProject(next);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save brief.');
    }
  };

  const onCreateManualTask = async (): Promise<void> => {
    setError(null);
    try {
      const t = await createTask(deps.repository, {
        projectId: props.projectId,
        title: newTitle,
        why: newWhy,
        definitionOfDone: newDod,
        sourceRef: { kind: 'manual', id: null },
      });
      setTasks((prev) => [t, ...prev]);
      setNewTitle('');
      setNewWhy('');
      setNewDod('');
      setShowNewTask(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task.');
    }
  };

  const onAskAiTasks = (
    sourceKind: 'question',
    sourceId: string,
    sourceLabel: string,
  ): void => {
    setAiError(null);
    openCapsule({
      surface: 'object',
      selectedObjectIds: [sourceId],
      precomputedActionArgs: {
        [ACTION_RESEARCH_SUGGEST_DESIGN_TASKS]: {
          projectId: props.projectId,
          sourceKind,
          sourceId,
          sourceLabel,
        },
      },
      initialScope: 'current-view',
    });
  };

  const onSaveQuestion = async (): Promise<void> => {
    setError(null);
    try {
      if (editingQuestionId) {
        const updated = await updateResearchQuestion(deps.repository, {
          questionId: editingQuestionId,
          question: questionText,
          rationale: questionRationale,
          scope: questionScope,
        });
        setQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
      } else {
        const created = await createResearchQuestion(deps.repository, {
          projectId: props.projectId,
          question: questionText,
          rationale: questionRationale,
          scope: questionScope,
        });
        setQuestions((prev) => [...prev, created]);
      }
      setShowNewQuestion(false);
      setEditingQuestionId(null);
      setQuestionText('');
      setQuestionRationale('');
      setQuestionScope('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save question.');
    }
  };

  const onEditQuestion = (q: ResearchQuestion): void => {
    setEditingQuestionId(q.id);
    setShowNewQuestion(true);
    setQuestionText(q.question);
    setQuestionRationale(q.rationale);
    setQuestionScope(q.scope);
  };

  const onSaveHypothesis = async (): Promise<void> => {
    setError(null);
    try {
      const created = await createHypothesis(deps.repository, {
        projectId: props.projectId,
        kind: hypothesisKind,
        text: hypothesisText,
        rationale: hypothesisRationale,
        ...(hypothesisQuestionId.trim() === ''
          ? {}
          : { questionId: hypothesisQuestionId }),
      });
      setHypotheses((prev) => [...prev, created]);
      setShowNewHypothesis(false);
      setHypothesisText('');
      setHypothesisRationale('');
      setHypothesisQuestionId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save hypothesis.');
    }
  };

  const onSaveRisk = async (): Promise<void> => {
    setError(null);
    try {
      const created = await createRisk(deps.repository, {
        projectId: props.projectId,
        kind: riskKind,
        title: riskTitle,
        body: riskBody,
        severity: riskKind === 'risk' ? riskSeverity : null,
        mitigation: riskMitigation,
      });
      setRisks((prev) => [...prev, created]);
      setShowNewRisk(false);
      setRiskTitle('');
      setRiskBody('');
      setRiskMitigation('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save risk.');
    }
  };

  const onSaveMilestone = async (): Promise<void> => {
    setError(null);
    try {
      const created = await createMilestone(deps.repository, {
        projectId: props.projectId,
        kind: milestoneKind,
        label: milestoneKind === 'custom' ? milestoneLabel : undefined,
        targetDate: milestoneTarget.trim() === '' ? undefined : milestoneTarget,
      });
      setMilestones((prev) => [...prev, created]);
      setShowNewMilestone(false);
      setMilestoneLabel('');
      setMilestoneTarget('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save milestone.');
    }
  };

  if (loading && !project) {
    return (
      <div data-testid="project-home-loading" className="rd-card">
        Loading project…
      </div>
    );
  }
  if (!project) {
    return (
      <div data-testid="project-home-missing" className="rd-card">
        <p>Project not found.</p>
        {error && <p role="alert" data-testid="project-home-error">{error}</p>}
      </div>
    );
  }

  return (
    <div
      data-testid="project-home"
      data-project-id={project.id}
      className="rd-stack-md"
      style={{ padding: '1rem', maxWidth: 920, margin: '0 auto' }}
    >
      <header className="rd-row">
        <h1 className="rd-h1">{project.name}</h1>
        <PillForProject project={project} />
      </header>
      <p className="rd-brief">
        {lastRun
          ? `Last search: ${lastRun.status} · ${lastRun.totalHits} hits · run #${lastRun.runNumber}`
          : 'No searches yet.'}
      </p>

      <LivingBriefCard
        brief={brief}
        dirty={dirty}
        onChange={(v) => { setBrief(v); setDirty(true); }}
        onSave={saveBrief}
      />

      {error && <p role="alert" data-testid="project-home-error" className="rd-error">{error}</p>}

      <QuickActionsRow
        continueLabel={
          recentEvidence[0]
            ? 'Continue from recent evidence'
            : worksById.size > 0
              ? 'Continue reading'
              : lastRun
                ? 'Continue search'
                : 'Add your first source'
        }
        onContinue={() => {
          const evidence = recentEvidence[0];
          if (evidence) props.onOpenReader({ projectId: project.id, workId: evidence.workId });
          else {
            const firstWork = worksById.values().next().value as Work | undefined;
            if (firstWork) props.onOpenReader({ projectId: project.id, workId: firstWork.id });
            else if (lastRun) props.onOpenDiscovery(project.id);
            else props.onOpenLibrary(project.id);
          }
        }}
        onOpenDiscovery={() => props.onOpenDiscovery(project.id)}
        onOpenLibrary={() => props.onOpenLibrary(project.id)}
        onOpenEvidence={() => props.onOpenEvidence(project.id)}
        onOpenDesign={() => props.onOpenDesign({ projectId: project.id })}
        onOpenCanvas={() => props.onOpenCanvas(project.id)}
        onCreateOutput={() => {
          void createOutput(deps.repository, { projectId: project.id, title: 'Untitled output' }).then((created) => {
            props.onOpenOutput({ projectId: project.id, outputId: created.id });
          }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not create output.'));
        }}
      />

      {status && (status.nextSections.length > 0 || status.blockedTasks.length > 0 || status.waitingTasks.length > 0) ? (
        <Surface level="sunken" className="project-next-focus" data-testid="project-home-next-focus">
          <strong>Next</strong>
          {status.blockedTasks[0] ? (
            <Button variant="ghost" size="sm" onClick={() => props.onOpenTask({ projectId: project.id, taskId: status.blockedTasks[0]!.task.id })}>
              Resolve: {status.blockedTasks[0].task.title}
            </Button>
          ) : status.waitingTasks[0] ? (
            <Button variant="ghost" size="sm" onClick={() => props.onOpenTask({ projectId: project.id, taskId: status.waitingTasks[0]!.task.id })}>
              Review dependency: {status.waitingTasks[0].task.title}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => props.onOpenDesign({ projectId: project.id })}>
              Develop the next design decision
            </Button>
          )}
        </Surface>
      ) : null}

      {(recentEvidence.length > 0 || recentClaims.length > 0) ? (
        <LineageColumns
          recentEvidence={recentEvidence}
          recentClaims={recentClaims}
          worksById={worksById}
          onOpenReader={(workId) => props.onOpenReader({ projectId: project.id, workId })}
        />
      ) : null}

      {/*
        WP-11R2: empty collections no longer render
        placeholder cards. The Project details
        expander is always rendered (it owns the
        "Add a question" / "Add a hypothesis" /
        "Add a task" forms), but the inner sections
        (Hypotheses / Risks / Milestones / Tasks /
        Lineage) only appear when they have data.
        OpenQuestionsSection is also always
        rendered — the user must be able to add the
        first question without first opening the
        expander. The expander is collapsed by
        default so the first screen stays clean.
      */}
      <details
            data-testid="project-home-details"
            className="rd-card"
            open={showProjectDetails}
            onToggle={(e) => setShowProjectDetails((e.target as HTMLDetailsElement).open)}
          >
            <summary
              className="rd-row"
              style={{ cursor: 'pointer', listStyle: 'none' }}
              data-testid="project-home-details-toggle"
            >
              <strong>Project details</strong>
              <span className="rd-row-spacer" />
              <span style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.85rem' }}>
                {[
                  questions.length > 0 ? `${questions.length} questions` : null,
                  hypotheses.length > 0 ? `${hypotheses.length} hypotheses` : null,
                  risks.length > 0 ? `${risks.length} risks` : null,
                  milestones.length > 0 ? `${milestones.length} milestones` : null,
                  tasks.length > 0 ? `${tasks.length} tasks` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </summary>
            <div data-testid="project-home-details-body">

      {status && (
        <StatusGrid
          status={status}
          onOpenDesign={() => props.onOpenDesign({ projectId: project.id })}
          onOpenTask={(taskId) => props.onOpenTask({ projectId: project.id, taskId })}
        />
      )}

      {/*
        OpenQuestionsSection is always rendered —
        the user needs the "Add a question" form
        even on an empty project. The empty
        placeholder text inside the section stays
        minimal; the rest of the secondary sections
        (Hypotheses / Risks / Milestones / Tasks /
        Lineage) follow the "hide when empty" rule.
      */}
      <OpenQuestionsSection
        questions={questions}
        aiError={aiError}
        showForm={showNewQuestion}
        editingId={editingQuestionId}
        formText={questionText}
        formRationale={questionRationale}
        formScope={questionScope}
        onTextChange={setQuestionText}
        onRationaleChange={setQuestionRationale}
        onScopeChange={setQuestionScope}
        onAskAi={onAskAiTasks}
        onStartDesign={(qid) => props.onOpenDesign({ projectId: project.id, questionId: qid })}
        onEditQuestion={onEditQuestion}
        onOpen={() => {
          setShowNewQuestion(true);
          setEditingQuestionId(null);
          setQuestionText('');
          setQuestionRationale('');
          setQuestionScope('');
        }}
        onCancel={() => {
          setShowNewQuestion(false);
          setEditingQuestionId(null);
          setQuestionText('');
          setQuestionRationale('');
          setQuestionScope('');
        }}
        onSave={onSaveQuestion}
      />

      <HypothesisSection
        hypotheses={hypotheses}
        questions={questions}
        showForm={showNewHypothesis}
        formKind={hypothesisKind}
        formQuestionId={hypothesisQuestionId}
        formText={hypothesisText}
        formRationale={hypothesisRationale}
        onKindChange={setHypothesisKind}
        onQuestionIdChange={setHypothesisQuestionId}
        onTextChange={setHypothesisText}
        onRationaleChange={setHypothesisRationale}
        onOpen={() => setShowNewHypothesis(true)}
        onCancel={() => {
          setShowNewHypothesis(false);
          setHypothesisText('');
          setHypothesisRationale('');
          setHypothesisQuestionId('');
        }}
        onSave={onSaveHypothesis}
      />

      <RisksSection
        risks={risks}
        showForm={showNewRisk}
        formKind={riskKind}
        formTitle={riskTitle}
        formBody={riskBody}
        formSeverity={riskSeverity}
        formMitigation={riskMitigation}
        onKindChange={setRiskKind}
        onTitleChange={setRiskTitle}
        onBodyChange={setRiskBody}
        onSeverityChange={setRiskSeverity}
        onMitigationChange={setRiskMitigation}
        onOpen={() => setShowNewRisk(true)}
        onCancel={() => {
          setShowNewRisk(false);
          setRiskTitle('');
          setRiskBody('');
          setRiskMitigation('');
        }}
        onSave={onSaveRisk}
      />

      <MilestonesSection
        milestones={milestones}
        showForm={showNewMilestone}
        formKind={milestoneKind}
        formLabel={milestoneLabel}
        formTarget={milestoneTarget}
        onKindChange={setMilestoneKind}
        onLabelChange={setMilestoneLabel}
        onTargetChange={setMilestoneTarget}
        onOpen={() => setShowNewMilestone(true)}
        onCancel={() => {
          setShowNewMilestone(false);
          setMilestoneLabel('');
          setMilestoneTarget('');
        }}
        onSave={onSaveMilestone}
      />

      <TasksSection
        tasks={tasks}
        showForm={showNewTask}
        formTitle={newTitle}
        formWhy={newWhy}
        formDod={newDod}
        onTitleChange={setNewTitle}
        onWhyChange={setNewWhy}
        onDodChange={setNewDod}
        onOpen={() => setShowNewTask(true)}
        onCancel={() => {
          setShowNewTask(false);
          setNewTitle('');
          setNewWhy('');
          setNewDod('');
        }}
        onSave={onCreateManualTask}
        onOpenTask={(taskId) => props.onOpenTask({ projectId: project.id, taskId })}
        canAssign={canAssignTasks}
        members={assignableMembers}
        onAssign={onAssignTask}
        onReassign={onAssignTask}
        onUnassign={onUnassignTask}
        outboxStatus={outboxStatusFor}
      />

      {outputs.length > 0 ? (
        <OutputsSection
          outputs={outputs}
          onOpen={(outputId) => props.onOpenOutput({ projectId: project.id, outputId })}
          onCreate={async () => {
            if (!deps.repository) return '';
            const created = await createOutput(deps.repository, {
              projectId: project.id,
              title: 'Untitled output',
            });
            props.onOpenOutput({ projectId: project.id, outputId: created.id });
            return created.id;
          }}
        />
      ) : null}

      {/* WP-08: Collaboration Foundation. The panel
          is mounted only when the local user is the
          project member. The CollaborationProvider is
          mounted higher in the v04 composition root
          (gated on the `v04Collaboration` feature
          flag). The panel shows members, comments,
          activity, and the Private Scratch publish
          preview; it never auto-publishes a scratch
          and never posts / edits a comment on the
          user's behalf via the AI.

          The `resolveCanonicalId` callback is the
          only place a Private Scratch becomes a real
          canonical row. v0.4 Beta only wires
          `kind === 'task'` — for other kinds the
          resolver throws a clear "publishing X is not
          yet supported" error so the dialog stays in
          `publishing` state and the user can Cancel.
          The publish flow is the *only* path that
          produces a canonical row from a scratch;
          AI never reaches this callback. */}
      {isCollaborationEnabled ? (
        <CollaborationPanel
          projectId={project.id}
          resolveCanonicalId={async (scratch) => {
            // The host is the gate. v0.4 Beta only
            // supports publishing a `task` scratch.
            if (scratch.kind !== 'task') {
              throw new Error(
                `Publishing a ${scratch.kind} scratch is not yet supported in v0.4 Beta. ` +
                  'Only `task` is publishable; other kinds stay private.',
              );
            }
            // The dialog has already moved the
            // scratch to `publishing`. We write the
            // canonical Task here; on success the
            // dialog calls `confirmPublish` with the
            // returned id. On failure the dialog
            // surfaces the error and the scratch
            // stays `publishing` (the user can Cancel
            // to revert to `private`).
            const trimmedTitle = scratch.title.trim();
            const trimmedBody = scratch.body.trim();
            const created = await createTask(deps.repository, {
              projectId: project.id,
              title: trimmedTitle.length > 0
                ? trimmedTitle
                : (trimmedBody.length > 0
                    ? trimmedBody.slice(0, 60)
                    : 'Untitled task'),
              why: trimmedBody.length > 0
                ? trimmedBody
                : 'Drafted privately in a Private Scratch.',
              definitionOfDone:
                'Review the published task, refine the why / DoD, and complete the work.',
              sourceRef: { kind: 'manual', id: null },
              // The publish flow is the canonical
              // source of the task; the link back
              // is persisted on the task so the
              // Project Home / Task detail can
              // render a "from scratch" trail.
              publishedFromScratchId: scratch.id,
            });
            // WP-08 Round 2: enqueue the cross-user
            // `task-shared` op so the other side's
            // inbox pull applies the same task to
            // their local research repo. The enqueue
            // is best-effort (it never throws); when
            // the collab wiring is off (e.g. AI-only
            // unit tests), the helper is a no-op.
            if (collabDeps) {
              // eslint-disable-next-line no-console
              if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
                /* debug-removed */
              }
              try {
                await enqueueTaskShared(project.id, {
                  task: created,
                  scratchId: scratch.id,
                  scratchTitle: scratch.title,
                });
                // eslint-disable-next-line no-console
                if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
                  /* debug-removed */
                }
              } catch (err) {
                // eslint-disable-next-line no-console
                if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
                  /* debug-removed */
                }
              }
            } else {
              // eslint-disable-next-line no-console
              if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
                /* debug-removed */
              }
            }
            return created.id;
          }}
        />
      ) : null}
            </div>
          </details>
    </div>
  );
}

// Local Pill import (kept here to keep the section
// files free of small-import noise).
import { Pill } from '../../shared/ui/Pill';
function PillForProject(props: { readonly project: ResearchProject }): React.ReactElement {
  return <Pill data-testid="project-home-kind">{props.project.kind}</Pill>;
}

// WP-08: read the `v04Collaboration` flag once
// per mount. The panel is hidden entirely when
// the flag is off so a flag-off build behaves
// exactly like WP-07.
const isCollaborationEnabled = isFeatureEnabled('v04Collaboration');

// WP-10 Round 1: Outputs section on the Project
// Home. Listens to the same `outputs` state as the
// page; offers a single "New output" affordance
// when the list is empty. Inline here (rather than
// in `project-home/`) because it's a small, host-
// specific composable that does not need to be
// reused by other surfaces.
function OutputsSection(props: {
  readonly outputs: readonly OutputDocument[];
  readonly onOpen: (outputId: string) => void;
  readonly onCreate: () => Promise<string>;
}): React.ReactElement {
  const [creating, setCreating] = React.useState(false);
  return (
    <Surface
      level="sunken"
      style={{ padding: '0.75rem', borderRadius: '0.5rem' }}
      data-testid="project-home-outputs"
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        <strong>Outputs</strong>
        <span style={{ opacity: 0.6 }}>{props.outputs.length}</span>
      </header>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0' }} data-testid="project-home-outputs-list">
        {props.outputs.map((o) => (
          <li key={o.id} style={{ padding: '0.25rem 0' }}>
            <button
              type="button"
              onClick={() => props.onOpen(o.id)}
              style={{
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: 0,
                textAlign: 'left',
              }}
              data-testid="project-home-output-row"
              data-output-id={o.id}
            >
              {o.title} <span style={{ opacity: 0.5, fontSize: '0.85rem' }}>· {o.status}</span>
            </button>
          </li>
        ))}
      </ul>
      <Button
        variant="primary"
        size="sm"
        disabled={creating}
        onClick={async () => {
          setCreating(true);
          try {
            await props.onCreate();
          } finally {
            setCreating(false);
          }
        }}
        data-testid="project-home-create-output"
      >
        {creating ? 'Creating…' : 'New output'}
      </Button>
    </Surface>
  );
}
