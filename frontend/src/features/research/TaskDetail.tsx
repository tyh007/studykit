/**
 * StudyKit v0.4 — `features/research/TaskDetail`
 *
 * Single-task detail surface (WP-07). Mounted from the
 * research router when the URL is
 * `#/research/task-detail/<containerId>?__sid=<taskId>`.
 *
 * This file is the *orchestrator*: it owns the load
 * state, the repository calls, and the mutation
 * handlers. The visible surface is split into focused
 * sibling components under `./task-detail/` —
 * `TaskHeader`, `TaskWhyCard`, `TaskSourceRefCard`,
 * `TaskDependencyList`, `TaskBlockerCard`,
 * `TaskBlockerForm`, `TaskCompletionCard`,
 * `TaskCompletionForm`, `TaskStatusActions`.
 *
 * The surface shows the task's:
 *   - Title
 *   - **Why** this task exists (verbatim from the use case)
 *   - Definition of done
 *   - Source (with a deep link back to the upstream object
 *     when the sourceRef points at a Question / Decision /
 *     Risk in the same project)
 *   - Dependencies (with a one-line explanation per pending
 *     dependency: "Waiting on <title> — <status>")
 *   - Blocker (when status is `blocked`)
 *   - Completion artifact (when status is `done`)
 *   - Inline controls: change status, add a blocker note,
 *     mark as done (the "Complete" button is disabled
 *     until a completionRef is provided)
 *
 * Strict rules (enforced by the use cases, not the UI):
 *
 *   - "Complete" cannot be enabled until the user picks
 *     a completion artifact (the use case throws
 *     otherwise).
 *   - Changing a Decision creates a new revision; the
 *     previous row is preserved.
 *   - Dependencies are cycle-safe; the UI never offers
 *     to add a dependency that would close a loop.
 *   - AI never writes canonical Tasks. The use case
 *     refuses `authorType: 'ai'`.
 */

import React from 'react';
import { Button } from '../../shared/ui/Button';
import { useResearchDeps } from './researchContext';
import {
  addTaskDependency,
  clearTaskBlocker,
  completeTask,
  removeTaskDependency,
  setTaskBlocker,
  cancelTask,
  reopenTask,
} from '../../application/research/researchDesignUseCases';
import type {
  ResearchTask,
  TaskBlockerKind,
  TaskCompletionRefKind,
} from '../../domain/researchDesign';
import type { Evidence } from '../../domain/research';
import type {
  MethodDecision,
  ResearchQuestion,
  ResearchRisk,
} from '../../domain/researchDesign';
import { deriveMethodDecisionHeads } from '../../domain/researchDesign';
import { TaskHeader } from './task-detail/TaskHeader';
import { TaskWhyCard } from './task-detail/TaskWhyCard';
import {
  TaskSourceRefCard,
} from './task-detail/TaskSourceRefCard';
import {
  TaskDependencyList,
  type TaskDependencyCandidate,
} from './task-detail/TaskDependencyList';
import { TaskBlockerCard } from './task-detail/TaskBlockerCard';
import { TaskBlockerForm } from './task-detail/TaskBlockerForm';
import { TaskCompletionCard } from './task-detail/TaskCompletionCard';
import {
  TaskCompletionForm,
  type TaskCompletionCandidate,
} from './task-detail/TaskCompletionForm';
import { TaskStatusActions } from './task-detail/TaskStatusActions';
import './researchDesign.css';

export interface TaskDetailProps {
  readonly projectId: string;
  readonly taskId: string;
  readonly onBackToProject: (projectId: string) => void;
  readonly onOpenQuestion: (input: { projectId: string; questionId: string }) => void;
  readonly onOpenDecision: (input: { projectId: string; decisionId: string }) => void;
}

export function TaskDetail(props: TaskDetailProps): React.ReactElement {
  const deps = useResearchDeps();
  const [task, setTask] = React.useState<ResearchTask | null>(null);
  const [allTasks, setAllTasks] = React.useState<readonly ResearchTask[]>([]);
  const [questions, setQuestions] = React.useState<readonly ResearchQuestion[]>([]);
  const [decisions, setDecisions] = React.useState<readonly MethodDecision[]>([]);
  const [risks, setRisks] = React.useState<readonly ResearchRisk[]>([]);
  const [evidence, setEvidence] = React.useState<readonly Evidence[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [blockerKind, setBlockerKind] = React.useState<TaskBlockerKind>('data');
  const [blockerNote, setBlockerNote] = React.useState('');
  const [completionKind, setCompletionKind] = React.useState<TaskCompletionRefKind>('decision');
  const [completionId, setCompletionId] = React.useState('');
  const [completionNote, setCompletionNote] = React.useState('');

  const reload = React.useCallback(async (): Promise<void> => {
    try {
      const t = await deps.repository.getTask(props.taskId);
      setTask(t);
      const tasks = await deps.repository.listTasks({ projectId: props.projectId, limit: 200 });
      setAllTasks(tasks);
      const [qs, ds, rs, es] = await Promise.all([
        deps.repository.listQuestions({ projectId: props.projectId, limit: 100 }),
        deps.repository.listMethodDecisions({ projectId: props.projectId, limit: 200 }),
        deps.repository.listRisks({ projectId: props.projectId, limit: 100 }),
        deps.repository.listEvidence({ projectId: props.projectId, limit: 200 }),
      ]);
      setQuestions(qs);
      setDecisions(ds);
      setRisks(rs);
      setEvidence(es);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task.');
    }
  }, [deps.repository, props.projectId, props.taskId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  React.useEffect(() => {
    const off = deps.repository.subscribe(() => {
      void reload();
    });
    return off;
  }, [deps.repository, reload]);

  if (!task) {
    return (
      <div
        data-testid="task-detail-missing"
        style={{ padding: '1rem', maxWidth: 920, margin: '0 auto' }}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => props.onBackToProject(props.projectId)}
          data-testid="task-back-to-project"
        >
          ← Project
        </Button>
        {error ? <p role="alert">{error}</p> : <p>Task not found.</p>}
      </div>
    );
  }

  const depTasks = new Map(allTasks.map((t) => [t.id, t]));

  const onComplete = async (): Promise<void> => {
    if (completionId.trim().length === 0) {
      setError('Pick an artifact to complete against.');
      return;
    }
    setError(null);
    try {
      const next = await completeTask(deps.repository, {
        taskId: task.id,
        completionRef: { kind: completionKind, id: completionId.trim(), note: completionNote },
      });
      setTask(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete task.');
    }
  };

  const onSetBlocker = async (): Promise<void> => {
    if (blockerNote.trim().length === 0) {
      setError('Blocker note is required.');
      return;
    }
    setError(null);
    try {
      const next = await setTaskBlocker(deps.repository, {
        taskId: task.id,
        blocker: { kind: blockerKind, note: blockerNote.trim() },
      });
      setTask(next);
      setBlockerNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set blocker.');
    }
  };

  const onClearBlocker = async (): Promise<void> => {
    setError(null);
    try {
      const next = await clearTaskBlocker(deps.repository, task.id);
      setTask(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear blocker.');
    }
  };

  const onCancel = async (): Promise<void> => {
    try {
      const next = await cancelTask(deps.repository, task.id);
      setTask(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel task.');
    }
  };

  const onReopen = async (): Promise<void> => {
    try {
      const next = await reopenTask(deps.repository, task.id);
      setTask(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reopen task.');
    }
  };

  const onAddDependency = async (dependsOnTaskId: string): Promise<void> => {
    setError(null);
    try {
      await addTaskDependency(deps.repository, {
        taskId: task.id,
        dependsOnTaskId,
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add dependency.');
    }
  };

  const onRemoveDependency = async (dependsOnTaskId: string): Promise<void> => {
    setError(null);
    try {
      await removeTaskDependency(deps.repository, task.id, dependsOnTaskId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove dependency.');
    }
  };

  const sourceRef = task.sourceRef;
  const sourceLabel = (() => {
    if (sourceRef.kind === 'manual') return 'manual';
    if (sourceRef.kind === 'question' && sourceRef.id) {
      const q = questions.find((x) => x.id === sourceRef.id);
      return q ? `question: ${q.question.slice(0, 80)}` : `question: ${sourceRef.id}`;
    }
    if (sourceRef.kind === 'decision' && sourceRef.id) {
      const d = decisions.find((x) => x.id === sourceRef.id);
      return d ? `decision: ${d.title}` : `decision: ${sourceRef.id}`;
    }
    if (sourceRef.kind === 'risk' && sourceRef.id) {
      const r = risks.find((x) => x.id === sourceRef.id);
      return r ? `${r.kind}: ${r.title}` : `risk: ${sourceRef.id}`;
    }
    if (sourceRef.kind === 'evidence-gap' && sourceRef.id) {
      const e = evidence.find((x) => x.id === sourceRef.id);
      return e ? `evidence gap: ${e.exactQuote.slice(0, 80)}` : `evidence gap: ${sourceRef.id}`;
    }
    return sourceRef.id ?? sourceRef.kind;
  })();

  const decisionCandidates = deriveMethodDecisionHeads(decisions).map((v) => v.decision);
  const evidenceCandidates = evidence.filter((e) => e.status === 'verified');

  // Candidates for the dependency-add select: same project, not this
  // task, not already a dependency. Use case enforces cycle safety;
  // the host just filters the obvious cases.
  const depCandidates: readonly TaskDependencyCandidate[] = allTasks
    .filter((t) => t.id !== task.id && !task.dependencies.includes(t.id))
    .map((t) => ({ id: t.id, title: t.title, status: t.status }));

  const decisionCompletionCandidates: readonly TaskCompletionCandidate[] = decisionCandidates.map(
    (d) => ({ id: d.id, label: d.title }),
  );
  const evidenceCompletionCandidates: readonly TaskCompletionCandidate[] = evidenceCandidates.map(
    (e) => ({ id: e.id, label: e.exactQuote.slice(0, 60) }),
  );

  const canOpenQuestion = sourceRef.kind === 'question' && Boolean(sourceRef.id);
  const canOpenDecision = sourceRef.kind === 'decision' && Boolean(sourceRef.id);
  const onOpenQuestionHandler = canOpenQuestion
    ? () => props.onOpenQuestion({
        projectId: props.projectId,
        questionId: sourceRef.id as string,
      })
    : undefined;
  const onOpenDecisionHandler = canOpenDecision
    ? () => props.onOpenDecision({
        projectId: props.projectId,
        decisionId: sourceRef.id as string,
      })
    : undefined;

  const showBlockerForm =
    task.status !== 'blocked' && task.status !== 'done' && task.status !== 'cancelled';
  const showCompletionForm =
    task.status !== 'done' && task.status !== 'cancelled';
  const statusActionMode: 'cancel' | 'reopen' =
    task.status === 'done' || task.status === 'cancelled' ? 'reopen' : 'cancel';

  return (
    <div
      data-testid="task-detail"
      data-task-id={task.id}
      style={{ padding: '1rem', maxWidth: 920, margin: '0 auto', display: 'grid', gap: '0.75rem' }}
    >
      <TaskHeader
        title={task.title}
        status={task.status}
        onBack={() => props.onBackToProject(props.projectId)}
      />
      {error && <p role="alert" data-testid="task-error">{error}</p>}

      <TaskWhyCard why={task.why} definitionOfDone={task.definitionOfDone} />

      <TaskSourceRefCard
        sourceKind={sourceRef.kind}
        sourceLabel={sourceLabel}
        sourceNote={task.sourceNote}
        canOpenQuestion={canOpenQuestion}
        canOpenDecision={canOpenDecision}
        onOpenQuestion={onOpenQuestionHandler}
        onOpenDecision={onOpenDecisionHandler}
      />

      <TaskDependencyList
        dependencies={task.dependencies}
        depTasks={depTasks}
        candidates={depCandidates}
        onRemoveDependency={(id) => void onRemoveDependency(id)}
        onAddDependency={(id) => void onAddDependency(id)}
      />

      {task.status === 'blocked' && task.blocker && (
        <TaskBlockerCard
          blockerKind={task.blocker.kind}
          blockerNote={task.blocker.note}
          onClear={() => void onClearBlocker()}
        />
      )}

      {showBlockerForm && (
        <TaskBlockerForm
          blockerKind={blockerKind}
          blockerNote={blockerNote}
          onKindChange={setBlockerKind}
          onNoteChange={setBlockerNote}
          onSubmit={() => void onSetBlocker()}
        />
      )}

      {task.status === 'done' && task.completionRef && (
        <TaskCompletionCard
          completionKind={task.completionRef.kind}
          completionId={task.completionRef.id}
          completionNote={task.completionRef.note}
        />
      )}

      {showCompletionForm && (
        <TaskCompletionForm
          completionKind={completionKind}
          completionId={completionId}
          completionNote={completionNote}
          decisionCandidates={decisionCompletionCandidates}
          evidenceCandidates={evidenceCompletionCandidates}
          onKindChange={setCompletionKind}
          onIdChange={setCompletionId}
          onNoteChange={setCompletionNote}
          onSubmit={() => void onComplete()}
        />
      )}

      <TaskStatusActions
        mode={statusActionMode}
        onCancel={statusActionMode === 'cancel' ? () => void onCancel() : undefined}
        onReopen={statusActionMode === 'reopen' ? () => void onReopen() : undefined}
      />
    </div>
  );
}
