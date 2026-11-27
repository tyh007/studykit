/**
 * StudyKit v0.5 P6 — the provenance report for a piece of writing.
 *
 * Built from what StudyKit recorded while the work happened, not from
 * what the author says afterwards:
 *
 *   - Sentence by sentence: where it came from (own words, a quote, an
 *     AI draft edited or used as is), how well it is backed, and every
 *     excerpt behind it with source, page and exact wording.
 *   - Evidence coverage: how many sentences rest on checked excerpts.
 *   - AI use statement: every way the AI took part in the project
 *     (drafting, suggesting points or excerpts, brainstorm ideas,
 *     conversations), in numbers, ready to paste into a submission.
 *
 * A supervisor can check it independently: each quote carries the
 * source's title, authors, year, DOI and page, so it can be found in the
 * paper. The JSON export carries the same facts for tools.
 *
 * Pure apart from `loadProvenanceReport`.
 */

import type { Claim, ClaimEvidenceLink, Evidence, Work } from '../../domain/research';
import {
  auditStatement,
  stableSectionOrder,
  stableStatementOrder,
  type OutputDocument,
  type OutputSection,
  type OutputStatement,
  type StatementAuditState,
  type StatementSupport,
} from '../../domain/output';
import { classifySentence, keptShare, SENTENCE_SOURCES, SENTENCE_SOURCE_LABEL, type SentenceSource } from '../../domain/provenance';
import type { AiDraftDecision, AiMessage, AiThread } from '../../domain/aiThread';
import type { Brainstorm, Idea } from '../../domain/brainstorm';
import type { ResearchRepository } from './researchRepository';
import { AGENT_DRAFT_PREFIX, AGENT_PROVIDER_ID } from './mcp/agentIds';

export const REPORT_FORMAT_VERSION = 1;

export interface ReportSource {
  readonly workId: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly year?: number;
  readonly doi?: string;
}

export interface ReportExcerpt {
  readonly evidenceId: string;
  readonly quote: string;
  readonly pageNumber?: number;
  readonly relation: 'supports' | 'contradicts' | 'qualifies';
  /** Checked by the author against the source. */
  readonly checked: boolean;
  /** The excerpt was first proposed by the AI (and then checked by the author). */
  readonly suggestedByAi: boolean;
  readonly source: ReportSource;
}

export interface ReportSentence {
  readonly statementId: string;
  readonly section: string;
  readonly text: string;
  readonly source: SentenceSource;
  /** For AI drafts: the share of the AI's words the author kept, 0..1. */
  readonly aiWordsKept?: number;
  readonly ai?: { readonly provider: string; readonly model?: string; readonly acceptedAt: string };
  /** Composed from an argument point that the AI first suggested. */
  readonly pointFromAi?: boolean;
  readonly backing: StatementAuditState;
  readonly excerpts: readonly ReportExcerpt[];
}

export interface AiUse {
  readonly draftedSentences: number;
  readonly editedSentences: number;
  readonly verbatimSentences: number;
  readonly models: readonly string[];
  readonly pointsSuggested: number;
  readonly excerptsSuggested: number;
  readonly brainstormIdeas: { readonly fromAi: number; readonly total: number };
  readonly askedBeforeOwnIdeas: number;
  readonly conversations: number;
  readonly questions: number;
  readonly roles: readonly string[];
  readonly suggestionsApplied: number;
  readonly suggestionsRejected: number;
  readonly skippedOwnThinking: number;
  /** v0.5 P6b: external agents connected over MCP. */
  readonly agents: {
    readonly names: readonly string[];
    readonly excerptsProposed: number;
    readonly excerptsChecked: number;
    readonly pointsProposed: number;
    readonly pointsAccepted: number;
  };
}

export interface ProvenanceReport {
  readonly formatVersion: number;
  readonly generatedAt: string;
  readonly projectName: string;
  readonly title: string;
  readonly sentences: readonly ReportSentence[];
  readonly bySource: Readonly<Record<SentenceSource, number>>;
  readonly coverage: {
    readonly sentences: number;
    /** Backed by at least one checked excerpt and not contested. */
    readonly backed: number;
    readonly contested: number;
    readonly unbacked: number;
    readonly broken: number;
  };
  readonly ai: AiUse;
  /** Plain-language AI use statement. */
  readonly aiStatement: string;
}

export interface ReportInput {
  readonly projectName: string;
  readonly output: OutputDocument;
  readonly sections: readonly OutputSection[];
  readonly statements: readonly OutputStatement[];
  readonly supports: readonly StatementSupport[];
  readonly claims: readonly Claim[];
  readonly evidence: readonly Evidence[];
  readonly links: readonly ClaimEvidenceLink[];
  readonly works: readonly Work[];
  readonly aiThreads: readonly AiThread[];
  readonly aiMessages: readonly AiMessage[];
  readonly aiDecisions: readonly AiDraftDecision[];
  readonly brainstorms: readonly Brainstorm[];
  readonly ideas: readonly Idea[];
  readonly now: string;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function pageOf(e: Evidence): number | undefined {
  const n = (e.locator as { pageNumber?: unknown }).pageNumber;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function sourceOf(work: Work | undefined, workId: string): ReportSource {
  if (!work) return { workId, title: 'Unknown source', authors: [] };
  const doi = work.identifiers?.doi;
  return {
    workId,
    title: work.title || 'Untitled source',
    authors: work.authors,
    ...(work.year ? { year: work.year } : {}),
    ...(doi ? { doi } : {}),
  };
}

export function buildProvenanceReport(input: ReportInput): ProvenanceReport {
  const evidenceById = new Map(input.evidence.map((e) => [e.id, e]));
  const claimById = new Map(input.claims.map((c) => [c.id, c]));
  const workById = new Map(input.works.map((w) => [w.id, w]));
  const lookups = {
    claims: new Map(input.claims.filter((c) => c.status === 'canonical').map((c) => [c.id, c])),
    evidence: new Map(input.evidence.filter((e) => e.status === 'verified').map((e) => [e.id, e])),
  };

  // Excerpts behind a sentence: cited directly, or through a cited point.
  const excerptsFor = (statementId: string): ReportExcerpt[] => {
    const out = new Map<string, ReportExcerpt>();
    const add = (e: Evidence | undefined, relation: ReportExcerpt['relation']): void => {
      if (!e || out.has(e.id)) return;
      const page = pageOf(e);
      out.set(e.id, {
        evidenceId: e.id,
        quote: e.exactQuote,
        ...(page ? { pageNumber: page } : {}),
        relation,
        checked: e.status === 'verified',
        suggestedByAi: e.authorType === 'ai' || Boolean(e.draftId),
        source: sourceOf(workById.get(e.workId), e.workId),
      });
    };
    for (const s of input.supports.filter((x) => x.statementId === statementId)) {
      if (s.ref.kind === 'evidence') add(evidenceById.get(s.ref.id), s.relation);
      else for (const l of input.links.filter((x) => x.claimId === s.ref.id)) add(evidenceById.get(l.evidenceId), l.relation);
    }
    return [...out.values()];
  };

  const checkedQuotes = input.evidence.filter((e) => e.status === 'verified').map((e) => e.exactQuote);
  const sectionTitle = new Map(input.sections.map((s) => [s.id, s.title]));
  const sectionOrder = new Map(stableSectionOrder(input.sections).map((s, i) => [s.id, i]));
  const ordered = [...input.statements].sort(
    (a, b) => (sectionOrder.get(a.sectionId) ?? 0) - (sectionOrder.get(b.sectionId) ?? 0),
  );
  const bySection = new Map<string, OutputStatement[]>();
  for (const s of ordered) bySection.set(s.sectionId, [...(bySection.get(s.sectionId) ?? []), s]);

  const sentences: ReportSentence[] = [];
  for (const [sectionId, list] of bySection) {
    for (const st of stableStatementOrder(list)) {
      const excerpts = excerptsFor(st.id);
      // A word-for-word quote of any checked excerpt counts, linked or not.
      const source = classifySentence({ body: st.body, origin: st.origin, quotes: checkedQuotes });
      const audit = auditStatement({ statement: st, supports: input.supports, lookups });
      const origin = st.origin;
      sentences.push({
        statementId: st.id,
        section: sectionTitle.get(sectionId) ?? '',
        text: st.body,
        source,
        ...(origin?.kind === 'ai'
          ? {
              aiWordsKept: Math.round(keptShare(origin.aiText, st.body) * 100) / 100,
              ai: { provider: origin.provider, ...(origin.model ? { model: origin.model } : {}), acceptedAt: origin.acceptedAt },
            }
          : {}),
        ...(origin?.kind === 'argument' && origin.pointFromAi ? { pointFromAi: true } : {}),
        backing: audit.state,
        excerpts,
      });
    }
  }

  const bySource = Object.fromEntries(SENTENCE_SOURCES.map((k) => [k, sentences.filter((s) => s.source === k).length])) as Record<
    SentenceSource,
    number
  >;
  const coverage = {
    sentences: sentences.length,
    backed: sentences.filter((s) => s.backing === 'supported').length,
    contested: sentences.filter((s) => s.backing === 'conflicted').length,
    unbacked: sentences.filter((s) => s.backing === 'unsupported').length,
    broken: sentences.filter((s) => s.backing === 'broken').length,
  };

  // AI use across the project.
  const aiSentences = sentences.filter((s) => s.ai);
  const userQuestions = input.aiMessages.filter((m) => m.role === 'user');
  // External agents (MCP) are counted on their own, not as the built-in partner.
  const agentMessages = input.aiMessages.filter((m) => m.provider?.id === AGENT_PROVIDER_ID);
  const agentDraftIds = new Set(agentMessages.flatMap((m) => m.drafts.map((d) => d.draftId)));
  const partnerDecisions = input.aiDecisions.filter((d) => !agentDraftIds.has(d.draftId));
  const agentExcerpts = input.evidence.filter((e) => e.draftId?.startsWith(AGENT_DRAFT_PREFIX) && e.status !== 'rejected');
  const ai: AiUse = {
    draftedSentences: aiSentences.length,
    editedSentences: bySource['ai-edited'],
    verbatimSentences: bySource['ai-verbatim'],
    models: [...new Set(aiSentences.map((s) => (s.ai!.model ? `${s.ai!.provider} (${s.ai!.model})` : s.ai!.provider)))].sort(),
    pointsSuggested: input.claims.filter((c) => c.authorType === 'ai' || c.aiSuggested).length,
    excerptsSuggested: input.evidence.filter(
      (e) => e.status === 'verified' && (e.authorType === 'ai' || e.draftId) && !e.draftId?.startsWith(AGENT_DRAFT_PREFIX),
    ).length,
    brainstormIdeas: { fromAi: input.ideas.filter((i) => i.authorType === 'ai').length, total: input.ideas.length },
    askedBeforeOwnIdeas: input.brainstorms.filter((b) => b.askedAiEarly).length,
    conversations: new Set(userQuestions.map((m) => m.threadId)).size,
    questions: userQuestions.length,
    roles: [...new Set(input.aiMessages.map((m) => m.aiRole).filter((r): r is NonNullable<typeof r> => Boolean(r)))].sort(),
    suggestionsApplied: partnerDecisions.filter((d) => d.decision === 'applied').length,
    suggestionsRejected: partnerDecisions.filter((d) => d.decision === 'rejected').length,
    skippedOwnThinking: userQuestions.filter((m) => m.skippedOwnThinking).length,
    agents: {
      names: [...new Set(agentMessages.map((m) => m.provider!.model))].sort(),
      excerptsProposed: agentExcerpts.length,
      excerptsChecked: agentExcerpts.filter((e) => e.status === 'verified').length,
      pointsProposed: agentDraftIds.size,
      pointsAccepted: input.aiDecisions.filter((d) => agentDraftIds.has(d.draftId) && d.decision === 'applied').length,
    },
  };

  return {
    formatVersion: REPORT_FORMAT_VERSION,
    generatedAt: input.now,
    projectName: input.projectName,
    title: input.output.title,
    sentences,
    bySource,
    coverage,
    ai,
    aiStatement: aiUseStatement(ai, {
      sentences: sentences.length,
      unknown: bySource.unknown,
      citedExcerpts: new Set(sentences.flatMap((s) => s.excerpts.map((e) => e.evidenceId))).size,
      uncheckedExcerpts: new Set(sentences.flatMap((s) => s.excerpts.filter((e) => !e.checked).map((e) => e.evidenceId))).size,
    }),
  };
}

export interface StatementFacts {
  readonly sentences: number;
  /** Paragraphs written before sources were recorded. */
  readonly unknown: number;
  readonly citedExcerpts: number;
  readonly uncheckedExcerpts: number;
}

/**
 * The AI use statement, in plain sentences, from recorded facts only.
 * It never claims more than was recorded: paragraphs without a recorded
 * source are named as such, not counted as the author's.
 */
export function aiUseStatement(ai: AiUse, facts: StatementFacts): string {
  const sentenceCount = facts.sentences;
  const known = sentenceCount - facts.unknown;
  const parts: string[] = [];
  if (ai.draftedSentences === 0) {
    parts.push(
      facts.unknown === 0
        ? `None of the ${plural(sentenceCount, 'paragraph')} in this text began as an AI draft.`
        : known === 0
          ? `This text was written before StudyKit recorded where paragraphs came from, so their origin is not known.`
          : `None of the ${plural(known, 'paragraph')} with a recorded source began as an AI draft.`,
    );
  } else {
    const how = [ai.editedSentences ? `${ai.editedSentences} edited by the author` : '', ai.verbatimSentences ? `${ai.verbatimSentences} used as drafted` : '']
      .filter(Boolean)
      .join(', ');
    parts.push(
      `${ai.draftedSentences} of ${plural(sentenceCount, 'paragraph')} began as AI drafts (${how}), generated with ${ai.models.join(', ')} from excerpts the author selected.`,
    );
  }
  if (ai.pointsSuggested > 0) parts.push(`${plural(ai.pointsSuggested, 'point')} in the argument ${ai.pointsSuggested === 1 ? 'was' : 'were'} first suggested by the AI and accepted by the author.`);
  if (ai.excerptsSuggested > 0) parts.push(`${plural(ai.excerptsSuggested, 'excerpt')} ${ai.excerptsSuggested === 1 ? 'was' : 'were'} first proposed by the AI; the author checked each against the source.`);
  if (ai.brainstormIdeas.fromAi > 0) {
    parts.push(
      `In brainstorming, ${ai.brainstormIdeas.fromAi} of ${plural(ai.brainstormIdeas.total, 'idea')} came from the AI${ai.askedBeforeOwnIdeas > 0 ? `; the AI was asked before the author had written three ideas of their own in ${plural(ai.askedBeforeOwnIdeas, 'session')}` : ''}.`,
    );
  }
  if (ai.questions > 0) {
    parts.push(
      `The author asked the AI ${plural(ai.questions, 'question')} in ${plural(ai.conversations, 'conversation')}${ai.roles.length ? ` (roles: ${ai.roles.join(', ')})` : ''}; of its suggestions, ${ai.suggestionsApplied} ${ai.suggestionsApplied === 1 ? 'was' : 'were'} applied and ${ai.suggestionsRejected} rejected.`,
    );
  }
  const ag = ai.agents;
  if (ag.names.length > 0) {
    const did = [
      ag.excerptsProposed ? `proposed ${plural(ag.excerptsProposed, 'excerpt')} (${ag.excerptsChecked} checked and kept by the author)` : '',
      ag.pointsProposed ? `proposed ${plural(ag.pointsProposed, 'point')} (${ag.pointsAccepted} accepted by the author)` : '',
    ]
      .filter(Boolean)
      .join(' and ');
    parts.push(`External AI agents connected to StudyKit (${ag.names.join(', ')})${did ? ` ${did}` : ' took part'}; they could not change the project directly.`);
  }
  if (ai.skippedOwnThinking > 0) parts.push(`${plural(ai.skippedOwnThinking, 'question')} skipped the author's own attempt first.`);
  if (facts.unknown > 0 && known > 0) {
    parts.push(`${plural(facts.unknown, 'paragraph')} ${facts.unknown === 1 ? 'was' : 'were'} written before StudyKit recorded sources, so ${facts.unknown === 1 ? 'its' : 'their'} origin is not known.`);
  }
  if (facts.citedExcerpts > 0) {
    parts.push(
      facts.uncheckedExcerpts === 0
        ? `All ${plural(facts.citedExcerpts, 'cited excerpt')} ${facts.citedExcerpts === 1 ? 'was' : 'were'} checked by the author against the source; each is listed with its page.`
        : `${facts.citedExcerpts - facts.uncheckedExcerpts} of ${plural(facts.citedExcerpts, 'cited excerpt')} were checked by the author against the source; each is listed with its page.`,
    );
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function cite(s: ReportSource, page?: number): string {
  const who = s.authors.length === 0 ? '' : s.authors.length > 2 ? `${s.authors[0]} et al.` : s.authors.join(' & ');
  const head = [who, s.year ? `(${s.year})` : ''].filter(Boolean).join(' ');
  return `${head ? `${head}, ` : ''}${s.title}${s.doi ? `, doi:${s.doi}` : ''}${page ? `, p. ${page}` : ''}`;
}

const BACKING_LABEL: Readonly<Record<StatementAuditState, string>> = {
  supported: 'Backed by checked excerpts',
  conflicted: 'Has evidence for and against',
  unsupported: 'No checked excerpt behind it',
  broken: 'Cites something that was removed',
};

export function reportToMarkdown(r: ProvenanceReport): string {
  const pct = (n: number): string => (r.coverage.sentences ? `${Math.round((n / r.coverage.sentences) * 100)}%` : '0%');
  const lines: string[] = [
    `# Provenance report — ${r.title}`,
    '',
    `Project: ${r.projectName || 'Research project'} · Generated ${r.generatedAt.slice(0, 16).replace('T', ' ')} UTC by StudyKit`,
    '',
    '## AI use statement',
    '',
    r.aiStatement,
    '',
    '## Where the text came from',
    '',
    ...SENTENCE_SOURCES.filter((k) => r.bySource[k] > 0).map((k) => `- ${SENTENCE_SOURCE_LABEL[k]}: ${r.bySource[k]}`),
    '',
    '## Evidence coverage',
    '',
    `- ${r.coverage.backed} of ${r.coverage.sentences} paragraphs (${pct(r.coverage.backed)}) are backed by checked excerpts`,
    ...(r.coverage.contested ? [`- ${r.coverage.contested} have evidence for and against`] : []),
    ...(r.coverage.unbacked ? [`- ${r.coverage.unbacked} have no checked excerpt behind them`] : []),
    ...(r.coverage.broken ? [`- ${r.coverage.broken} cite something that was later removed`] : []),
    '',
    '## Paragraph by paragraph',
  ];
  let section: string | null = null;
  r.sentences.forEach((s, i) => {
    if (s.section !== section) {
      section = s.section;
      lines.push('', `### ${s.section || 'Untitled section'}`);
    }
    const ai = s.ai ? ` · ${s.ai.model ? `${s.ai.provider} (${s.ai.model})` : s.ai.provider}${s.source === 'ai-edited' && s.aiWordsKept !== undefined ? `, ${Math.round(s.aiWordsKept * 100)}% of the AI's words kept` : ''}` : '';
    lines.push('', `${i + 1}. ${s.text}`, '', `   *${SENTENCE_SOURCE_LABEL[s.source]}${ai}${s.pointFromAi ? ' · point first suggested by the AI' : ''} · ${BACKING_LABEL[s.backing]}*`);
    for (const e of s.excerpts) {
      const rel = e.relation === 'supports' ? '' : e.relation === 'contradicts' ? ' (against)' : ' (limits)';
      lines.push(`   - “${e.quote}”${rel} — ${cite(e.source, e.pageNumber)}${e.checked ? '' : ' — not checked'}${e.suggestedByAi ? ' — proposed by the AI, checked by the author' : ''}`);
    }
  });
  lines.push('', '---', '', `Format version ${r.formatVersion}. Sources are recorded as the work happens; a paragraph's source is set when it is first written and does not change when it is edited.`);
  return lines.join('\n');
}

export function reportToJson(r: ProvenanceReport): string {
  return JSON.stringify(r, null, 2);
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export async function loadProvenanceReport(repository: ResearchRepository, outputId: string, now: string = new Date().toISOString()): Promise<ProvenanceReport> {
  const output = await repository.getOutput(outputId);
  if (!output) throw new Error(`loadProvenanceReport: output ${outputId} not found.`);
  const projectId = output.projectId;
  const [project, sections, statements, supports, claims, evidence, links, works, aiThreads, brainstorms, ideas] = await Promise.all([
    repository.getProject(projectId),
    repository.listOutputSections({ outputId }),
    repository.listOutputStatements({ outputId }),
    repository.listStatementSupports({ outputId }),
    repository.listClaims({ projectId }),
    repository.listEvidence({ projectId }),
    repository.listLinks({ projectId }),
    repository.listWorks({ projectId }),
    repository.listAiThreads({ projectId }),
    repository.listBrainstorms({ projectId }),
    repository.listIdeas({ projectId }),
  ]);
  const [aiMessages, aiDecisions] = await Promise.all([
    Promise.all(aiThreads.map((t) => repository.listAiMessages({ threadId: t.id }))).then((x) => x.flat()),
    Promise.all(aiThreads.map((t) => repository.listAiDraftDecisions({ threadId: t.id }))).then((x) => x.flat()),
  ]);
  return buildProvenanceReport({
    projectName: project?.name ?? '',
    output,
    sections,
    statements,
    supports,
    claims,
    evidence,
    links,
    works,
    aiThreads,
    aiMessages,
    aiDecisions,
    brainstorms,
    ideas,
    now,
  });
}
