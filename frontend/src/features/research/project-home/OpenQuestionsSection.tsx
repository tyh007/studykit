/**
 * StudyKit v0.4 — `features/research/project-home/OpenQuestionsSection`
 *
 * Open-questions list + the "Add a question" form on
 * the Project Home. Compact: a single-line textarea
 * for the question, optional rationale + scope, Save.
 * The form is *not* a wizard; the user can edit /
 * add questions freely.
 *
 * The "Ask AI" chip opens the Universal Intent
 * Capsule with the typed args for the
 * `research-suggest-design-tasks` safe action. The
 * Capsule renders the per-row Accept / Ignore
 * surface; the Project Home never talks to the
 * provider router directly.
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Pill } from '../../../shared/ui/Pill';
import { Surface } from '../../../shared/ui/Surface';
import type { ResearchQuestion } from '../../../domain/researchDesign';
import type { ResearchSuggestDesignTasksArgs } from '../../../features/ai/kernel';

export interface OpenQuestionsSectionProps {
  readonly questions: readonly ResearchQuestion[];
  readonly aiError: string | null;
  readonly showForm: boolean;
  readonly editingId: string | null;
  readonly formText: string;
  readonly formRationale: string;
  readonly formScope: string;
  readonly onTextChange: (v: string) => void;
  readonly onRationaleChange: (v: string) => void;
  readonly onScopeChange: (v: string) => void;
  readonly onAskAi: (
    sourceKind: 'question',
    id: string,
    label: string,
    args: ResearchSuggestDesignTasksArgs,
  ) => void;
  readonly onStartDesign: (questionId: string) => void;
  readonly onEditQuestion: (q: ResearchQuestion) => void;
  readonly onOpen: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}

export function OpenQuestionsSection(
  props: OpenQuestionsSectionProps,
): React.ReactElement {
  return (
    <Surface
      data-testid="project-home-questions"
      style={{ padding: '0.75rem', borderRadius: '0.5rem' }}
    >
      <header className="rd-row">
        <h2 className="rd-h3">Open questions</h2>
        <div style={{ flex: 1 }} />
        {!props.showForm && (
          <Button
            variant="primary"
            size="sm"
            onClick={props.onOpen}
            data-testid="project-home-new-question"
            aria-label="Add a question"
          >
            Add a question
          </Button>
        )}
      </header>
      {props.aiError && (
        <p
          role="alert"
          data-testid="project-home-ai-error"
          className="rd-ai-error"
        >
          {props.aiError}
        </p>
      )}
      {props.showForm && (
        <div data-testid="project-home-new-question-form" className="rd-inline-form">
          <input
            type="text"
            className="rd-input"
            placeholder="What do you want to find out?"
            value={props.formText}
            onChange={(e) => props.onTextChange(e.currentTarget.value)}
            data-testid="project-home-new-question-text"
            aria-label="Question text"
          />
          <textarea
            className="rd-textarea"
            placeholder="Why does this question matter? (optional)"
            value={props.formRationale}
            onChange={(e) => props.onRationaleChange(e.currentTarget.value)}
            data-testid="project-home-new-question-rationale"
            rows={2}
            aria-label="Question rationale"
          />
          <input
            type="text"
            className="rd-input"
            placeholder="Scope: population, setting, time window (optional)"
            value={props.formScope}
            onChange={(e) => props.onScopeChange(e.currentTarget.value)}
            data-testid="project-home-new-question-scope"
            aria-label="Question scope"
          />
          <div className="rd-inline-form-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={props.onCancel}
              data-testid="project-home-new-question-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={props.onSave}
              disabled={props.formText.trim().length === 0}
              data-testid="project-home-new-question-save"
            >
              {props.editingId ? 'Save' : 'Add question'}
            </Button>
          </div>
        </div>
      )}
      {props.questions.length === 0 ? (
        <p className="rd-dep-empty">No questions yet. Add one above, or run a search to surface a gap.</p>
      ) : (
        <ul className="rd-list">
          {props.questions.map((q) => (
            <li
              key={q.id}
              data-testid="project-home-question-row"
              data-question-id={q.id}
              className="rd-list-item"
            >
              <span style={{ flex: 1 }}>{q.question}</span>
              <Pill tone="info" data-testid="project-home-question-hint">{q.status}</Pill>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  props.onAskAi('question', q.id, q.question, {
                    projectId: q.projectId,
                    sourceKind: 'question',
                    sourceId: q.id,
                    sourceLabel: q.question,
                  })
                }
                data-testid="project-home-question-ask-ai"
                aria-label="Ask AI for task suggestions"
              >
                Ask AI
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => props.onStartDesign(q.id)}
                data-testid="project-home-question-start-design"
              >
                Start design
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => props.onEditQuestion(q)}
                data-testid="project-home-question-edit"
                aria-label="Edit question"
              >
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}
