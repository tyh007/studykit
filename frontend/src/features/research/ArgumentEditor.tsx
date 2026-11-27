/**
 * StudyKit v0.5 P3 — the argument editor (ADR-003).
 *
 * The project's points in order, each with four slots: evidence, why it
 * holds, against it, limits. An empty slot is a visible gap with one
 * obvious action. Only checked excerpts can be cited; clicking a cite
 * opens the source beside the argument at that page, where a highlight
 * can be added straight to a point. "Write it up" turns the finished
 * argument into a draft whose every citation leads back to its page.
 */

import React from "react";
import "./argument.css";
import { useResearchDeps } from "./researchContext";
import {
  addPoint,
  buildArgument,
  citeInSlot,
  composeArgumentDraft,
  movePoint,
  removeCite,
  updatePoint,
  type ArgumentCite,
  type ArgumentPoint,
  type ArgumentSlot,
  type ArgumentView,
  type CiteSlot,
} from "../../application/research/argument";
import type { Evidence } from "../../domain/research";
import type { Disagreement } from "../../domain/brainstorm";
import { Button } from "../../shared/ui/Button";

const ResearchReader = React.lazy(() =>
  import("./ResearchReader").then((m) => ({ default: m.ResearchReader })),
);

export interface ArgumentEditorProps {
  readonly projectId: string;
  /** Point to scroll to on open (e.g. from “What’s missing”). */
  readonly focusPointId?: string;
  readonly onOpenSource: (input: {
    workId: string;
    pageNumber?: number;
  }) => void;
  readonly onOpenOutput: (outputId: string) => void;
  readonly onOpenSources: () => void;
  /** P5: start a brainstorm (diverge before structuring). */
  readonly onStartBrainstorm?: () => void;
  /** P5: record that someone disagrees with a point, then open it. */
  readonly onRaiseDisagreement?: (claimId: string, question: string) => void;
  readonly onOpenDisagreement?: (disagreementId: string) => void;
}

interface ArgumentData {
  readonly loaded: boolean;
  readonly question: string;
  readonly view: ArgumentView;
  readonly evidence: readonly Evidence[];
  readonly works: readonly { id: string; title: string }[];
  readonly disagreements: readonly Disagreement[];
}

const EMPTY: ArgumentData = {
  loaded: false,
  question: "",
  view: { points: [], completeCount: 0, ready: false },
  evidence: [],
  works: [],
  disagreements: [],
};

function useArgument(projectId: string): ArgumentData {
  const { repository } = useResearchDeps();
  const [data, setData] = React.useState<ArgumentData>(EMPTY);
  React.useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      const [project, claims, evidence, links, works, disagreements] =
        await Promise.all([
          repository.getProject(projectId),
          repository.listClaims({ projectId }),
          repository.listEvidence({ projectId }),
          repository.listLinks({ projectId }),
          repository.listWorks({ projectId }),
          repository.listDisagreements({ projectId }),
        ]);
      if (cancelled) return;
      const workList = works.map((w) => ({
        id: w.id,
        title: w.title || "Untitled source",
      }));
      setData({
        loaded: true,
        question: project?.livingBrief.trim() ?? "",
        view: buildArgument({ claims, evidence, links, works: workList }),
        evidence,
        works: workList,
        disagreements,
      });
    };
    void refresh().catch(
      () => !cancelled && setData((d) => ({ ...d, loaded: true })),
    );
    const off = repository.subscribe(
      () => void refresh().catch(() => undefined),
    );
    return () => {
      cancelled = true;
      off();
    };
  }, [projectId, repository]);
  return data;
}

const SLOT_COPY: Readonly<
  Record<ArgumentSlot, { label: string; gap: string }>
> = {
  evidence: { label: "Evidence", gap: "Add an excerpt that supports this" },
  reasoning: {
    label: "Why it holds",
    gap: "In your own words: why does the evidence support this point?",
  },
  counter: {
    label: "Against it",
    gap: "Is there an excerpt that argues against this?",
  },
  limits: { label: "Limits", gap: "Where does this stop being true?" },
};

interface Peek {
  readonly workId: string;
  readonly pageNumber?: number;
}

export function ArgumentEditor(props: ArgumentEditorProps): React.ReactElement {
  const { projectId } = props;
  const { repository } = useResearchDeps();
  const data = useArgument(projectId);
  const [peek, setPeek] = React.useState<Peek | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [writing, setWriting] = React.useState(false);

  const run = React.useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      setError(null);
      try {
        await action();
        return true;
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message.replace(/^\w+: /, "")
            : "Something went wrong.",
        );
        return false;
      }
    },
    [],
  );

  // Scroll to the requested point once it exists.
  const focused = React.useRef<string | null>(null);
  React.useEffect(() => {
    const id = props.focusPointId;
    if (!id || focused.current === id || !data.loaded) return;
    const el = document.querySelector<HTMLElement>(
      `[data-point-id="${CSS.escape(id)}"]`,
    );
    if (!el) return;
    focused.current = id;
    el.scrollIntoView?.({ block: "center" });
    el.classList.add("is-focused");
    window.setTimeout(() => el.classList.remove("is-focused"), 1600);
  }, [props.focusPointId, data.loaded, data.view]);

  const { view } = data;
  const missing = view.points.reduce((n, p) => n + p.gaps.length, 0);
  const peekTitle = peek
    ? (data.works.find((w) => w.id === peek.workId)?.title ?? "Source")
    : "";

  const writeUp = async (): Promise<void> => {
    setWriting(true);
    let outputId: string | null = null;
    await run(async () => {
      outputId = (await composeArgumentDraft(repository, { projectId })).output
        .id;
    });
    setWriting(false);
    if (outputId) props.onOpenOutput(outputId);
  };

  return (
    <div className="argument" data-testid="argument-editor">
      <div className={`argument-layout${peek ? " has-peek" : ""}`}>
        <div className="argument-main">
          <header className="argument-header">
            <div>
              <h1>Argument</h1>
              {data.question ? (
                <p
                  className="argument-question"
                  data-testid="argument-question"
                >
                  {data.question}
                </p>
              ) : null}
            </div>
            {view.points.length > 0 ? (
              <div className="argument-progress">
                <span data-testid="argument-progress">
                  {view.ready
                    ? "Every slot is filled."
                    : `${missing} empty ${missing === 1 ? "slot" : "slots"} · ${view.completeCount} of ${view.points.length} ${view.points.length === 1 ? "point" : "points"} ready`}
                </span>
                <Button
                  variant={view.ready ? "primary" : "secondary"}
                  disabled={!view.ready || writing}
                  onClick={() => void writeUp()}
                  title={
                    view.ready
                      ? "Turn this argument into a first draft"
                      : "Fill the empty slots first"
                  }
                  data-testid="argument-write-up"
                >
                  {writing ? "Writing…" : "Write it up"}
                </Button>
              </div>
            ) : null}
          </header>

          {error ? (
            <p className="argument-error" role="alert">
              {error}
            </p>
          ) : null}

          {data.loaded && view.points.length === 0 ? (
            <p className="argument-empty" data-testid="argument-empty">
              Start with the first point you want to make. You’ll back it with
              excerpts next.
              {props.onStartBrainstorm ? (
                <>
                  {" "}
                  Not sure yet?{" "}
                  <button
                    type="button"
                    className="argument-link"
                    onClick={props.onStartBrainstorm}
                    data-testid="argument-brainstorm"
                  >
                    Brainstorm first
                  </button>
                </>
              ) : null}
            </p>
          ) : null}

          <ol className="argument-points">
            {view.points.map((point, i) => (
              <PointCard
                key={point.claim.id}
                point={point}
                index={i}
                total={view.points.length}
                evidence={data.evidence}
                works={data.works}
                run={run}
                onPeek={setPeek}
                onOpenSources={props.onOpenSources}
                disagreements={data.disagreements.filter(
                  (d) => d.claimId === point.claim.id && d.status === "open",
                )}
                {...(props.onRaiseDisagreement
                  ? { onRaiseDisagreement: props.onRaiseDisagreement }
                  : {})}
                {...(props.onOpenDisagreement
                  ? { onOpenDisagreement: props.onOpenDisagreement }
                  : {})}
              />
            ))}
          </ol>

          <AddPointForm
            onAdd={(title) =>
              run(() => addPoint(repository, { projectId, title }))
            }
            first={view.points.length === 0}
          />
        </div>

        {peek ? (
          <aside
            className="argument-peek"
            aria-label={`Source: ${peekTitle}`}
            data-testid="argument-peek"
          >
            <div className="argument-peek-header">
              <span className="argument-peek-title">
                {peekTitle}
                {peek.pageNumber ? `, p. ${peek.pageNumber}` : ""}
              </span>
              <button
                type="button"
                className="argument-link"
                onClick={() => props.onOpenSource(peek)}
                data-testid="argument-peek-open"
              >
                Open in a tab
              </button>
              <button
                type="button"
                className="argument-icon"
                aria-label="Close source"
                onClick={() => setPeek(null)}
              >
                ×
              </button>
            </div>
            <p className="argument-peek-hint">
              Highlight a passage to add it to a point.
            </p>
            <React.Suspense
              fallback={<p className="argument-peek-hint">Opening…</p>}
            >
              <ResearchReader
                key={peek.workId}
                projectId={projectId}
                workId={peek.workId}
                onBackToLibrary={() => setPeek(null)}
                onOpenEvidence={() => undefined}
                {...(peek.pageNumber
                  ? { initialPageNumber: peek.pageNumber }
                  : {})}
              />
            </React.Suspense>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Point card
// ---------------------------------------------------------------------------

interface PointCardProps {
  readonly point: ArgumentPoint;
  readonly index: number;
  readonly total: number;
  readonly evidence: readonly Evidence[];
  readonly works: readonly { id: string; title: string }[];
  readonly run: (action: () => Promise<unknown>) => Promise<boolean>;
  readonly onPeek: (peek: Peek) => void;
  readonly onOpenSources: () => void;
  readonly disagreements: readonly Disagreement[];
  readonly onRaiseDisagreement?: (claimId: string, question: string) => void;
  readonly onOpenDisagreement?: (disagreementId: string) => void;
}

function PointCard(props: PointCardProps): React.ReactElement {
  const { point, run } = props;
  const { repository } = useResearchDeps();
  const claimId = point.claim.id;
  const projectId = point.claim.projectId;
  const [picking, setPicking] = React.useState<CiteSlot | null>(null);
  const isGap = (slot: ArgumentSlot): boolean => point.gaps.includes(slot);

  const cites = (slot: CiteSlot): readonly ArgumentCite[] =>
    slot === "evidence"
      ? point.evidence
      : slot === "counter"
        ? point.counter
        : point.limits;

  const citeSlot = (slot: CiteSlot): React.ReactElement => {
    const list = cites(slot);
    const none =
      slot === "counter"
        ? point.noCounter
        : slot === "limits"
          ? point.noLimits
          : false;
    const setNone = (value: boolean): Promise<boolean> =>
      run(() =>
        updatePoint(repository, {
          claimId,
          ...(slot === "counter" ? { noCounter: value } : { noLimits: value }),
        }),
      );
    return (
      <div
        className={`argument-slot${isGap(slot) ? " is-gap" : ""}`}
        data-testid={`argument-slot-${slot}`}
        data-gap={isGap(slot) || undefined}
      >
        <h3>{SLOT_COPY[slot].label}</h3>
        {list.length > 0 ? (
          <ul className="argument-cites">
            {list.map((c) => (
              <li
                key={c.linkId}
                className="argument-cite"
                data-testid="argument-cite"
              >
                <button
                  type="button"
                  className="argument-cite-open"
                  onClick={() =>
                    props.onPeek({
                      workId: c.workId,
                      ...(c.pageNumber ? { pageNumber: c.pageNumber } : {}),
                    })
                  }
                  title="Show this page beside the argument"
                >
                  <span className="argument-cite-quote">
                    “
                    {c.quote.length > 160
                      ? `${c.quote.slice(0, 160)}…`
                      : c.quote}
                    ”
                  </span>
                  <span className="argument-cite-where">
                    {c.workTitle}
                    {c.pageNumber ? `, p. ${c.pageNumber}` : ""}
                  </span>
                </button>
                <button
                  type="button"
                  className="argument-icon"
                  aria-label={`Remove excerpt from ${SLOT_COPY[slot].label}`}
                  onClick={() =>
                    void run(() => removeCite(repository, c.linkId))
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : none ? (
          <p className="argument-none">
            Looked — none found.{" "}
            <button
              type="button"
              className="argument-link"
              onClick={() => void setNone(false)}
            >
              Undo
            </button>
          </p>
        ) : (
          <p className="argument-gap-text">{SLOT_COPY[slot].gap}</p>
        )}
        {slot === "evidence" &&
        point.evidence.length > 0 &&
        point.supportingSources === 1 ? (
          <p
            className="argument-soft-hint"
            data-testid="argument-single-source"
          >
            Rests on one source. A second one makes it stronger.
          </p>
        ) : null}
        {!none ? (
          <div className="argument-slot-actions">
            <button
              type="button"
              className="argument-link"
              onClick={() => setPicking(picking === slot ? null : slot)}
              aria-expanded={picking === slot}
              data-testid={`argument-add-${slot}`}
            >
              + Add excerpt
            </button>
            {slot !== "evidence" && list.length === 0 ? (
              <button
                type="button"
                className="argument-link"
                onClick={() => void setNone(true)}
                data-testid={`argument-none-${slot}`}
              >
                Looked — none found
              </button>
            ) : null}
          </div>
        ) : null}
        {picking === slot ? (
          <ExcerptPicker
            evidence={props.evidence}
            works={props.works}
            exclude={new Set(list.map((c) => c.evidenceId))}
            onPick={async (evidenceId) => {
              if (
                await run(() =>
                  citeInSlot(repository, {
                    projectId,
                    claimId,
                    evidenceId,
                    slot,
                  }),
                )
              )
                setPicking(null);
            }}
            onPeek={(workId) => {
              setPicking(null);
              props.onPeek({ workId });
            }}
            onOpenSources={props.onOpenSources}
            onClose={() => setPicking(null)}
          />
        ) : null}
      </div>
    );
  };

  return (
    <li
      className={`argument-point${point.complete ? " is-complete" : ""}`}
      data-testid="argument-point"
      data-point-id={claimId}
      data-complete={point.complete || undefined}
    >
      <div className="argument-point-header">
        <span className="argument-point-number" aria-hidden="true">
          {props.index + 1}
        </span>
        <InlineText
          value={point.claim.title}
          label="Point"
          className="argument-point-title"
          onSave={(title) =>
            run(() => updatePoint(repository, { claimId, title }))
          }
          testId="argument-point-title"
        />
        <span
          className="argument-point-status"
          data-testid="argument-point-status"
        >
          {point.complete ? "Ready" : `${point.gaps.length} empty`}
        </span>
        <div className="argument-point-move">
          <button
            type="button"
            className="argument-icon"
            aria-label={`Move “${point.claim.title}” up`}
            disabled={props.index === 0}
            onClick={() =>
              void run(() =>
                movePoint(repository, { projectId, claimId, offset: -1 }),
              )
            }
          >
            ↑
          </button>
          <button
            type="button"
            className="argument-icon"
            aria-label={`Move “${point.claim.title}” down`}
            disabled={props.index === props.total - 1}
            onClick={() =>
              void run(() =>
                movePoint(repository, { projectId, claimId, offset: 1 }),
              )
            }
          >
            ↓
          </button>
        </div>
      </div>
      <div className="argument-slots">
        {citeSlot("evidence")}
        <div
          className={`argument-slot${isGap("reasoning") ? " is-gap" : ""}`}
          data-testid="argument-slot-reasoning"
          data-gap={isGap("reasoning") || undefined}
        >
          <h3>{SLOT_COPY.reasoning.label}</h3>
          <ReasoningField
            value={point.claim.body}
            placeholder={SLOT_COPY.reasoning.gap}
            onSave={(reasoning) =>
              run(() => updatePoint(repository, { claimId, reasoning }))
            }
          />
        </div>
        {citeSlot("counter")}
        {citeSlot("limits")}
      </div>
      <DisagreementRow
        claimId={claimId}
        disagreements={props.disagreements}
        {...(props.onRaiseDisagreement
          ? { onRaise: props.onRaiseDisagreement }
          : {})}
        {...(props.onOpenDisagreement
          ? { onOpen: props.onOpenDisagreement }
          : {})}
      />
    </li>
  );
}

/** Open disagreements about a point, and a quiet way to raise one. */
function DisagreementRow(props: {
  readonly claimId: string;
  readonly disagreements: readonly Disagreement[];
  readonly onRaise?: (claimId: string, question: string) => void;
  readonly onOpen?: (disagreementId: string) => void;
}): React.ReactElement | null {
  const [asking, setAsking] = React.useState(false);
  const [question, setQuestion] = React.useState("");
  if (!props.onRaise && props.disagreements.length === 0) return null;
  return (
    <div className="argument-disagreements">
      {props.disagreements.map((d) => (
        <button
          key={d.id}
          type="button"
          className="argument-disagreement"
          onClick={() => props.onOpen?.(d.id)}
          data-testid="argument-disagreement"
        >
          Open disagreement: {d.question}
        </button>
      ))}
      {props.onRaise ? (
        asking ? (
          <form
            className="argument-raise"
            onSubmit={(e) => {
              e.preventDefault();
              const q = question.trim();
              if (!q) return;
              props.onRaise!(props.claimId, q);
              setQuestion("");
              setAsking(false);
            }}
          >
            <input
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What is in dispute?"
              aria-label="What is in dispute?"
              onKeyDown={(e) => e.key === "Escape" && setAsking(false)}
              data-testid="argument-raise-input"
            />
          </form>
        ) : (
          <button
            type="button"
            className="argument-link"
            onClick={() => setAsking(true)}
            data-testid="argument-raise"
          >
            Someone disagrees
          </button>
        )
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function ReasoningField(props: {
  readonly value: string;
  readonly placeholder: string;
  readonly onSave: (value: string) => Promise<boolean>;
}): React.ReactElement {
  const [draft, setDraft] = React.useState(props.value);
  const editing = React.useRef(false);
  React.useEffect(() => {
    if (!editing.current) setDraft(props.value);
  }, [props.value]);
  return (
    <textarea
      className="argument-reasoning"
      value={draft}
      rows={3}
      placeholder={props.placeholder}
      aria-label="Why it holds"
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        editing.current = false;
        if (draft !== props.value) void props.onSave(draft);
      }}
      data-testid="argument-reasoning"
    />
  );
}

function InlineText(props: {
  readonly value: string;
  readonly label: string;
  readonly className: string;
  readonly testId: string;
  readonly onSave: (value: string) => Promise<boolean>;
}): React.ReactElement {
  const [draft, setDraft] = React.useState(props.value);
  React.useEffect(() => setDraft(props.value), [props.value]);
  const commit = (): void => {
    const next = draft.trim();
    if (!next) {
      setDraft(props.value);
      return;
    }
    if (next !== props.value) void props.onSave(next);
  };
  return (
    <input
      className={props.className}
      value={draft}
      aria-label={props.label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(props.value);
          e.currentTarget.blur();
        }
      }}
      data-testid={props.testId}
    />
  );
}

function AddPointForm(props: {
  readonly onAdd: (title: string) => Promise<boolean>;
  readonly first: boolean;
}): React.ReactElement {
  const [title, setTitle] = React.useState("");
  return (
    <form
      className="argument-add"
      onSubmit={(e) => {
        e.preventDefault();
        const t = title.trim();
        if (!t) return;
        void props.onAdd(t).then((ok) => ok && setTitle(""));
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={
          props.first
            ? "Your first point, in one sentence"
            : "Add another point"
        }
        aria-label="New point"
        data-testid="argument-add-point"
      />
      <Button
        type="submit"
        variant="secondary"
        disabled={!title.trim()}
        data-testid="argument-add-point-submit"
      >
        Add point
      </Button>
    </form>
  );
}

export function ExcerptPicker(props: {
  readonly evidence: readonly Evidence[];
  readonly works: readonly { id: string; title: string }[];
  readonly exclude: ReadonlySet<string>;
  readonly onPick: (evidenceId: string) => void;
  readonly onPeek: (workId: string) => void;
  readonly onOpenSources: () => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const [query, setQuery] = React.useState("");
  const title = (workId: string): string =>
    props.works.find((w) => w.id === workId)?.title ?? "Untitled source";
  const q = query.trim().toLowerCase();
  const checked = props.evidence.filter(
    (e) => e.status === "verified" && !props.exclude.has(e.id),
  );
  const shown = checked.filter(
    (e) =>
      !q ||
      e.exactQuote.toLowerCase().includes(q) ||
      title(e.workId).toLowerCase().includes(q),
  );
  return (
    <div
      className="argument-picker"
      data-testid="argument-picker"
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onClose();
      }}
    >
      {checked.length > 0 ? (
        <>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your excerpts"
            aria-label="Search your excerpts"
          />
          <ul>
            {shown.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => props.onPick(e.id)}
                  data-testid="argument-picker-option"
                >
                  <span className="argument-cite-quote">
                    “
                    {e.exactQuote.length > 160
                      ? `${e.exactQuote.slice(0, 160)}…`
                      : e.exactQuote}
                    ”
                  </span>
                  <span className="argument-cite-where">
                    {title(e.workId)}
                    {e.locator.pageNumber ? `, p. ${e.locator.pageNumber}` : ""}
                  </span>
                </button>
              </li>
            ))}
            {shown.length === 0 ? (
              <li className="argument-picker-empty">No excerpt matches.</li>
            ) : null}
          </ul>
        </>
      ) : (
        <p className="argument-picker-empty">
          No checked excerpts to use here yet.
        </p>
      )}
      <div className="argument-picker-sources">
        <span>Or highlight a passage in a source:</span>
        {props.works.length > 0 ? (
          props.works.slice(0, 6).map((w) => (
            <button
              key={w.id}
              type="button"
              className="argument-link"
              onClick={() => props.onPeek(w.id)}
              data-testid="argument-picker-source"
            >
              {w.title}
            </button>
          ))
        ) : (
          <button
            type="button"
            className="argument-link"
            onClick={props.onOpenSources}
          >
            Add sources
          </button>
        )}
      </div>
    </div>
  );
}
