/**
 * StudyKit v0.4 — `features/research/project-home/HypothesisSection`
 *
 * Inline "Add a hypothesis or objective" affordance
 * on the Project Home. The form is *not* a dashboard;
 * it is one line + optional rationale + optional
 * "linked question" pick, Save.
 *
 * `Hypothesis` rows are derived from
 * `repository.listHypotheses`; the canonical
 * `questionId` is preserved when the host passes it.
 * When the project has at least one open Question,
 * the form surfaces a "Link to question" select
 * whose first option is "(unlinked)" — leaving it
 * there saves a hypothesis with `questionId: null`.
 * The user explicitly opts in to the link, so the
 * typed schema does not require a default question.
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Pill } from '../../../shared/ui/Pill';
import { Surface } from '../../../shared/ui/Surface';
import type {
  Hypothesis,
  HypothesisKind,
  ResearchQuestion,
} from '../../../domain/researchDesign';

export interface HypothesisSectionProps {
  readonly hypotheses: readonly Hypothesis[];
  /**
   * The project's open Research Questions. The form
   * uses them to populate the "Link to question"
   * select. When empty, the select is hidden and the
   * saved row has `questionId: null`.
   */
  readonly questions: readonly ResearchQuestion[];
  readonly showForm: boolean;
  readonly formKind: HypothesisKind;
  /** Empty string means "unlinked". */
  readonly formQuestionId: string;
  readonly formText: string;
  readonly formRationale: string;
  readonly onKindChange: (k: HypothesisKind) => void;
  readonly onQuestionIdChange: (qid: string) => void;
  readonly onTextChange: (v: string) => void;
  readonly onRationaleChange: (v: string) => void;
  readonly onOpen: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}

export function HypothesisSection(props: HypothesisSectionProps): React.ReactElement {
  return (
    <Surface
      data-testid="project-home-hypotheses"
      style={{ padding: '0.75rem', borderRadius: '0.5rem' }}
    >
      <header className="rd-row">
        <h2 className="rd-h3">Hypotheses &amp; objectives</h2>
        <div style={{ flex: 1 }} />
        {!props.showForm && (
          <Button
            variant="ghost"
            size="sm"
            onClick={props.onOpen}
            data-testid="project-home-new-hypothesis"
            aria-label="Add a hypothesis or objective"
          >
            Add
          </Button>
        )}
      </header>
      {props.showForm && (
        <div data-testid="project-home-new-hypothesis-form" className="rd-inline-form">
          <select
            className="rd-select"
            value={props.formKind}
            onChange={(e) => props.onKindChange(e.currentTarget.value as HypothesisKind)}
            data-testid="project-home-new-hypothesis-kind"
            aria-label="Hypothesis kind"
          >
            <option value="hypothesis">Hypothesis</option>
            <option value="objective">Objective</option>
          </select>
          {props.questions.length > 0 && (
            <select
              className="rd-select"
              value={props.formQuestionId}
              onChange={(e) => props.onQuestionIdChange(e.currentTarget.value)}
              data-testid="project-home-new-hypothesis-question"
              aria-label="Linked question"
            >
              <option value="">(unlinked)</option>
              {props.questions.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.question.length > 60
                    ? `${q.question.slice(0, 60)}…`
                    : q.question}
                </option>
              ))}
            </select>
          )}
          <textarea
            className="rd-textarea"
            placeholder="What do you predict (or aim to do)?"
            value={props.formText}
            onChange={(e) => props.onTextChange(e.currentTarget.value)}
            data-testid="project-home-new-hypothesis-text"
            rows={2}
            aria-label="Hypothesis text"
          />
          <input
            type="text"
            className="rd-input"
            placeholder="Why this hypothesis? (optional)"
            value={props.formRationale}
            onChange={(e) => props.onRationaleChange(e.currentTarget.value)}
            data-testid="project-home-new-hypothesis-rationale"
            aria-label="Hypothesis rationale"
          />
          <div className="rd-inline-form-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={props.onCancel}
              data-testid="project-home-new-hypothesis-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={props.onSave}
              disabled={props.formText.trim().length === 0}
              data-testid="project-home-new-hypothesis-save"
            >
              Save
            </Button>
          </div>
        </div>
      )}
      {props.hypotheses.length === 0 ? (
        <p className="rd-dep-empty">No hypotheses or objectives yet.</p>
      ) : (
        <ul className="rd-list">
          {props.hypotheses.map((h) => (
            <li
              key={h.id}
              data-testid="project-home-hypothesis-row"
              data-hypothesis-id={h.id}
              data-question-id={h.questionId ?? ''}
              className="rd-list-item"
              style={{ flexDirection: 'column', alignItems: 'flex-start' }}
            >
              <div className="rd-row" style={{ width: '100%' }}>
                <Pill data-testid="project-home-hypothesis-kind">{h.kind}</Pill>
                <span style={{ flex: 1 }}>{h.text}</span>
              </div>
              {h.rationale && <div className="rd-list-item-meta">{h.rationale}</div>}
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}
