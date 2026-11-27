/**
 * StudyKit v0.5 P7a — bring a project from the old literature hub into
 * Research (ADR-004).
 *
 * Writes canonical records with deterministic ids derived from the
 * legacy ids: running it again adds what is new and never duplicates or
 * overwrites what the user changed since. Highlights arrive as unchecked
 * excerpts and AI summaries stay AI text, so nothing counts in the
 * ledger until the user checks it.
 */

import {
  canonicaliseDoi,
  makeWorkIdFromIdentifiers,
  nowIso,
  type Evidence,
  type ResearchProject,
  type Work,
  type WorkAsset,
} from '../../domain/research';
import type { OutputDocument, OutputSection, OutputStatement } from '../../domain/output';
import type { AiMessage, AiThread } from '../../domain/aiThread';
import type { LiteratureCustomField, LiteraturePaper, LiteratureProject } from '../../types';
import type { ResearchRepository } from './researchRepository';
import { LEGACY_AI_PROVIDER_ID } from './legacyIds';

// ---------------------------------------------------------------------------
// Where legacy data comes from
// ---------------------------------------------------------------------------

export interface LegacyNote {
  readonly id: string;
  readonly paper_id: string;
  readonly content: string;
  readonly created_at?: string;
}

export interface LegacyAnnotation {
  readonly id: string;
  readonly paper_id: string;
  readonly page_number: number;
  readonly annotation_type: 'highlight' | 'ink' | 'underline' | string;
  readonly text_content?: string | null;
  readonly created_at?: string;
  readonly deleted_at?: string | null;
}

export interface LegacyRelation {
  readonly id: string;
  readonly source_paper_id: string;
  readonly target_paper_id: string;
  readonly relation_type: string;
  readonly description?: string | null;
}

/**
 * Read access to the hub. Projects and papers are always available;
 * the rest only where the hub's server data is reachable (sync
 * workspaces). Missing methods mean "not reachable here".
 */
export interface LegacyLiteratureSource {
  listProjects(): Promise<readonly LiteratureProject[]>;
  listPapers(projectId: string): Promise<readonly LiteraturePaper[]>;
  listNotes?(paperId: string): Promise<readonly LegacyNote[]>;
  listAnnotations?(paperId: string): Promise<readonly LegacyAnnotation[]>;
  listRelations?(paperId: string): Promise<readonly LegacyRelation[]>;
  listCustomFields?(projectId: string): Promise<readonly LiteratureCustomField[]>;
}

// ---------------------------------------------------------------------------
// Ids (ADR-004)
// ---------------------------------------------------------------------------

export const legacyIds = {
  project: (id: string) => `lp_${id}`,
  asset: (paperId: string) => `lit_${paperId}`,
  excerpt: (annotationId: string) => `lit_ann_${annotationId}`,
  notesOutput: (projectId: string) => `lit_notes_${projectId}`,
  paperSection: (projectId: string, paperId: string) => `lit_sec_${projectId}_${paperId}`,
  relationsSection: (projectId: string) => `lit_sec_rel_${projectId}`,
  note: (noteId: string) => `lit_note_${noteId}`,
  relation: (relationId: string) => `lit_rel_${relationId}`,
  aiThread: (projectId: string) => `lit_ai_${projectId}`,
  aiSummary: (projectId: string, paperId: string) => `lit_sum_${projectId}_${paperId}`,
} as const;

export { LEGACY_AI_PROVIDER_ID };

const RELATION_VERB: Readonly<Record<string, string>> = {
  cites: 'cites',
  extends: 'extends',
  contradicts: 'contradicts',
  supports: 'supports',
  related: 'is related to',
  method: 'uses the same method as',
  dataset: 'uses the same data as',
};

const SUMMARY_FIELDS: readonly (readonly [string, string])[] = [
  ['background', 'Background'],
  ['theory', 'Theory'],
  ['methodology', 'Method'],
  ['measures', 'Measures'],
  ['results', 'Results'],
  ['implications', 'Implications'],
  ['limitations', 'Limitations'],
];

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export interface LegacyProjectEntry {
  readonly legacyId: string;
  readonly name: string;
  /** Already brought in: opening it goes to this Research project. */
  readonly projectId: string | null;
}

export async function listLegacyProjects(repository: ResearchRepository, source: LegacyLiteratureSource): Promise<LegacyProjectEntry[]> {
  const projects = await source.listProjects();
  const out: LegacyProjectEntry[] = [];
  for (const p of projects) {
    if ((p as { deleted_at?: string }).deleted_at) continue;
    const id = legacyIds.project(p.id);
    out.push({ legacyId: p.id, name: p.name || 'Untitled project', projectId: (await repository.getProject(id)) ? id : null });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface LegacyImportReport {
  readonly projectId: string;
  readonly works: { readonly added: number; readonly alreadyThere: number };
  readonly excerpts: number;
  readonly notes: number;
  readonly relations: number;
  readonly aiSummaries: number;
  readonly skipped: {
    readonly trashedPapers: number;
    readonly highlightsWithoutText: number;
    readonly drawings: number;
  };
  /** What the hub couldn't provide here (e.g. notes in a local workspace). */
  readonly unavailable: readonly ('notes' | 'highlights' | 'relations' | 'summary columns')[];
}

function splitAuthors(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/;|\s+and\s+|\n/)
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .slice(0, 100);
}

function titleOf(paper: LiteraturePaper): string {
  const t = paper.title?.trim();
  if (t) return t;
  return paper.file_name.replace(/\.pdf$/i, '').trim() || 'Untitled paper';
}

function iso(value: string | undefined, fallback: string): string {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : fallback;
}

function summaryBody(paper: LiteraturePaper, title: string, fieldNames: ReadonlyMap<string, string>): string | null {
  const data = paper.extracted_data;
  if (!data) return null;
  const lines: string[] = [];
  if (data.paperType?.trim()) lines.push(`Type: ${data.paperType.trim()}`);
  for (const [key, label] of SUMMARY_FIELDS) {
    const value = (data as unknown as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) lines.push(`${label}: ${value.trim()}`);
  }
  for (const [key, value] of Object.entries(data.customFields ?? {})) {
    if (typeof value === 'string' && value.trim()) lines.push(`${fieldNames.get(key) ?? key}: ${value.trim()}`);
  }
  if (lines.length === 0) return null;
  return [`${title}`, '', ...lines, '', 'Generated by AI in the old literature hub; not checked.'].join('\n').slice(0, 60_000);
}

export async function importLegacyProject(
  repository: ResearchRepository,
  source: LegacyLiteratureSource,
  input: { readonly legacyProjectId: string; readonly userId: string; readonly now?: string },
): Promise<LegacyImportReport> {
  const now = input.now ?? nowIso();
  const legacy = (await source.listProjects()).find((p) => p.id === input.legacyProjectId);
  if (!legacy) throw new Error('importLegacyProject: that project is no longer in the old literature hub.');
  const projectId = legacyIds.project(legacy.id);
  const papers = await source.listPapers(legacy.id);
  const live = papers.filter((p) => !p.in_trash && !p.deleted_at);
  const unavailable: LegacyImportReport['unavailable'][number][] = [];
  if (!source.listNotes) unavailable.push('notes');
  if (!source.listAnnotations) unavailable.push('highlights');
  if (!source.listRelations) unavailable.push('relations');
  if (!source.listCustomFields) unavailable.push('summary columns');

  const [existingProject, customFields] = await Promise.all([
    repository.getProject(projectId),
    source.listCustomFields ? source.listCustomFields(legacy.id).catch(() => []) : Promise.resolve([]),
  ]);
  const fieldNames = new Map(customFields.flatMap((f) => [[f.id, f.name] as const, [f.name, f.name] as const]));

  const projectRow: ResearchProject | null = existingProject
    ? null
    : {
        id: projectId,
        container: { workspaceId: null, mode: 'research', kind: 'project', id: projectId },
        name: legacy.name || 'Imported project',
        livingBrief: legacy.description?.trim() ?? '',
        kind: 'review',
        createdAt: iso(legacy.created_at, now),
        updatedAt: now,
        authorType: 'imported',
      };

  // Papers → Works + linked files.
  const works: Work[] = [];
  const assets: WorkAsset[] = [];
  const workByPaper = new Map<string, { work: Work; title: string }>();
  let added = 0;
  let alreadyThere = 0;
  for (const paper of live) {
    const title = titleOf(paper);
    const authors = splitAuthors(paper.authors);
    const doi = canonicaliseDoi(paper.doi ?? null);
    const identifiers = doi ? { doi } : {};
    const workId = makeWorkIdFromIdentifiers(identifiers, title, authors, paper.year);
    const assetId = legacyIds.asset(paper.id);
    const existing = workByPaper.get(paper.id)?.work ?? works.find((w) => w.id === workId) ?? (await repository.getWork(workId));
    let work: Work;
    if (existing) {
      alreadyThere += 1;
      work = {
        ...existing,
        projectIds: existing.projectIds.includes(projectId) ? existing.projectIds : [...existing.projectIds, projectId],
        assetIds: existing.assetIds.includes(assetId) ? existing.assetIds : [...existing.assetIds, assetId],
        updatedAt: now,
      };
    } else {
      added += 1;
      const at = { providerId: 'legacy-literature', at: now };
      work = {
        id: workId,
        identifiers,
        title,
        authors,
        ...(paper.year ? { year: paper.year } : {}),
        ...(paper.journal?.trim() ? { venue: paper.journal.trim() } : {}),
        ...(paper.abstract?.trim() ? { abstract: paper.abstract.trim() } : {}),
        metadataProvenance: {
          title: at,
          authors: at,
          ...(paper.year ? { year: at } : {}),
          ...(paper.journal?.trim() ? { venue: at } : {}),
          ...(doi ? { doi: at } : {}),
        },
        integrity: 'unknown',
        assetIds: [assetId],
        projectIds: [projectId],
        readingStatus: paper.reading_status ?? 'unread',
        importance: Math.max(0, Math.min(5, Math.round(paper.importance ?? 0))),
        createdAt: iso(paper.created_at, now),
        updatedAt: now,
        authorType: 'imported',
      };
    }
    const at = works.findIndex((w) => w.id === work.id);
    if (at >= 0) works[at] = work;
    else works.push(work);
    if (!(await repository.listWorkAssetsForWork(work.id)).some((a) => a.id === assetId)) {
      assets.push({ id: assetId, workId: work.id, kind: 'linked-file', ref: paper.id, createdAt: now });
    }
    workByPaper.set(paper.id, { work, title });
  }

  // Highlights → unchecked excerpts.
  const evidence: Evidence[] = [];
  let highlightsWithoutText = 0;
  let drawings = 0;
  if (source.listAnnotations) {
    const existingIds = new Set((await repository.listEvidence({ projectId })).map((e) => e.id));
    for (const paper of live) {
      const target = workByPaper.get(paper.id)!;
      for (const a of await source.listAnnotations(paper.id).catch(() => [])) {
        if (a.deleted_at) continue;
        if (a.annotation_type === 'ink') {
          drawings += 1;
          continue;
        }
        const quote = a.text_content?.trim();
        if (!quote) {
          highlightsWithoutText += 1;
          continue;
        }
        const id = legacyIds.excerpt(a.id);
        if (existingIds.has(id)) continue;
        const created = iso(a.created_at, now);
        evidence.push({
          id,
          projectId,
          workId: target.work.id,
          locator: {
            kind: 'paper-page',
            workId: target.work.id,
            assetId: legacyIds.asset(paper.id),
            pageNumber: Math.max(1, Math.round(a.page_number)),
            capturedAt: created,
          },
          exactQuote: quote.slice(0, 4000),
          userInterpretation: '',
          evidenceType: 'finding',
          status: 'candidate',
          note: 'Highlighted in the old literature hub',
          createdAt: created,
          updatedAt: now,
          authorType: 'imported',
        });
      }
    }
  }

  // Notes and relations → one piece of writing.
  const outputId = legacyIds.notesOutput(legacy.id);
  const existingOutput = await repository.getOutput(outputId);
  const existingStatementIds = new Set(
    existingOutput ? (await repository.listOutputStatements({ outputId })).map((s) => s.id) : [],
  );
  const existingSectionIds = new Set(existingOutput ? (await repository.listOutputSections({ outputId })).map((s) => s.id) : []);
  const sections: OutputSection[] = [];
  const statements: OutputStatement[] = [];
  const addStatement = (sectionId: string, sectionTitle: string, order: number, id: string, body: string): void => {
    if (existingStatementIds.has(id) || statements.some((s) => s.id === id)) return;
    if (!existingSectionIds.has(sectionId) && !sections.some((s) => s.id === sectionId)) {
      sections.push({ id: sectionId, projectId, outputId, title: sectionTitle.slice(0, 300), order: existingSectionIds.size + sections.length, createdAt: now, updatedAt: now });
    }
    statements.push({
      id,
      projectId,
      outputId,
      sectionId,
      body: body.slice(0, 20_000),
      order,
      authorType: 'imported',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      origin: { kind: 'imported' },
    });
  };
  let notes = 0;
  if (source.listNotes) {
    for (const paper of live) {
      const { title } = workByPaper.get(paper.id)!;
      const list = await source.listNotes(paper.id).catch(() => []);
      list.forEach((n, i) => {
        if (!n.content?.trim()) return;
        const before = statements.length;
        addStatement(legacyIds.paperSection(legacy.id, paper.id), title, i, legacyIds.note(n.id), n.content.trim());
        if (statements.length > before) notes += 1;
      });
    }
  }
  let relations = 0;
  if (source.listRelations) {
    const seen = new Set<string>();
    let order = 0;
    for (const paper of live) {
      for (const r of await source.listRelations(paper.id).catch(() => [])) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        const a = workByPaper.get(r.source_paper_id);
        const b = workByPaper.get(r.target_paper_id);
        if (!a || !b) continue;
        const sentence = `${a.title} ${RELATION_VERB[r.relation_type] ?? 'is related to'} ${b.title}${r.description?.trim() ? `: ${r.description.trim()}` : '.'}`;
        const before = statements.length;
        addStatement(legacyIds.relationsSection(legacy.id), 'How the papers relate', order++, legacyIds.relation(r.id), sentence);
        if (statements.length > before) relations += 1;
      }
    }
  }
  const outputRow: OutputDocument | null =
    !existingOutput && statements.length > 0
      ? { id: outputId, projectId, title: 'Notes from the old literature hub', status: 'draft', authorType: 'imported', createdAt: now, updatedAt: now }
      : null;

  // AI summaries → AI text in a private conversation.
  const threadId = legacyIds.aiThread(legacy.id);
  const existingThread = await repository.getAiThread(threadId);
  const existingMessageIds = new Set(existingThread ? (await repository.listAiMessages({ threadId })).map((m) => m.id) : []);
  const messages: AiMessage[] = [];
  for (const paper of live) {
    const { work, title } = workByPaper.get(paper.id)!;
    const id = legacyIds.aiSummary(legacy.id, paper.id);
    if (existingMessageIds.has(id)) continue;
    const body = summaryBody(paper, title, fieldNames);
    if (!body) continue;
    messages.push({
      id,
      threadId,
      projectId,
      role: 'assistant',
      authorId: input.userId,
      body,
      context: [{ kind: 'work', objectId: work.id, label: title, locator: null, excerpt: null }],
      drafts: [],
      provider: { id: LEGACY_AI_PROVIDER_ID, model: 'old literature hub' },
      status: 'complete',
      createdAt: iso(paper.processed_at ?? paper.updated_at, now),
    });
  }
  const threadRow: AiThread | null =
    !existingThread && messages.length > 0
      ? {
          id: threadId,
          projectId,
          title: 'AI summaries from the old literature hub',
          visibility: 'private',
          createdBy: input.userId,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        }
      : null;

  await repository.transact(async (tx) => {
    if (projectRow) tx.putProject(projectRow);
    for (const w of works) tx.putWork(w);
    for (const a of assets) tx.putWorkAsset(a);
    for (const e of evidence) tx.putEvidence(e);
    if (outputRow) tx.putOutput(outputRow);
    for (const s of sections) tx.putOutputSection(s);
    for (const s of statements) tx.putOutputStatement(s);
    if (threadRow) tx.putAiThread(threadRow);
    for (const m of messages) tx.appendAiMessage(m);
  });

  return {
    projectId,
    works: { added, alreadyThere },
    excerpts: evidence.length,
    notes,
    relations,
    aiSummaries: messages.length,
    skipped: { trashedPapers: papers.length - live.length, highlightsWithoutText, drawings },
    unavailable,
  };
}
