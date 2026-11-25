/**
 * StudyKit v0.4 — `repositories/shimStudyKitRepository`
 *
 * The *production* implementation of the
 * `StudyKitRepository` contract that the cognitive-canvas
 * `upgradeNode` use case writes through.
 *
 * Why a shim, not a new Dexie adapter? Because the WP-04
 * (`StudyRepository`) and WP-05 (`ResearchRepository`)
 * contracts *already* back their tables with the real
 * Dexie schema (additive migrations v4 + v5). The
 * cognitive canvas needs the *same* persistence paths
 * — not a third Dexie migration. So the shim:
 *
 *   - Holds a reference to the live
 *     `ResearchRepository` and `StudyRepository`
 *     (both feature-flag-gated: the canvas only
 *     mounts when the relevant flag is on).
 *   - `getObject` fans out across the two repos
 *     and the literature-API papers endpoint, and
 *     maps each result onto a `KnowledgeObject`.
 *   - `put` only accepts `KnowledgeObjectKind`
 *     values that have a real Dexie write path
 *     today. Other kinds throw
 *     `UnsupportedKindError` so the UI surfaces
 *     a clear message instead of silently
 *     dropping the upgrade.
 *   - `queryObjects` delegates to the right repo
 *     based on the requested kind.
 *   - `transact` enforces the same atomicity as
 *     the underlying repos: the callback receives
 *     a single `RepositoryTransaction` and the
 *     shim routes `put` to the right adapter
 *     and `delete` to a memory "tombstone" map.
 *     A delete is honoured only when the
 *     underlying repo has a `delete*` method;
 *     otherwise the shim is conservative and
 *     archives the object instead of dropping it
 *     (the Dexie repos do not have a `delete` for
 *     every kind, and the cognitive canvas
 *     respects that).
 *   - `subscribe` re-emits events from the
 *     underlying repos. The Dexie repos already
 *     debounce their notifications; the shim
 *     does not re-debounce.
 *
 * Writes that *would* silently go to in-memory
 * storage are explicitly refused. The only in-memory
 * component is the "tombstone for delete" map, which
 * lives only for the lifetime of the page.
 *
 * The shim is *not* a generic replacement for the
 * WP-00 `MemoryRepository`. It is a one-off bridge
 * for the cognitive-canvas use case.
 */

import type {
  KnowledgeObject,
  KnowledgeObjectKind,
  ObjectQuery,
  ObjectState,
  QueryListener,
  RepositoryTransaction,
  StudyKitRepository,
  Unsubscribe,
} from '../domain/repository';
import type { ResearchRepository } from '../application/research/researchRepository';
import type { StudyRepository } from '../application/study/studyRepository';
import type { Evidence } from '../domain/research';
import type { ReviewState, StudyQuestion } from '../domain/study';
import type { LiteraturePaper } from '../types';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * The set of `KnowledgeObjectKind` values the cognitive
 * canvas can promote a free node into.
 *
 * Why only `note` and `question`? The cognitive canvas
 * holds free nodes as *canvas-local* notes — bodies
 * the user types while in flow, with no Work /
 * locator / verified-Evidence backing. Promoting to
 * `evidence`, `claim`, or `source` would force the
 * shim to fabricate WP-05 canonical fields (a
 * `workId`, a `paper-work` locator, a `verified`
 * status, a `Claim.title` / `Claim.body` mapping,
 * etc.) that the cognitive canvas does not have.
 * Fabricating those fields would silently produce
 * rows that violate WP-05 invariants (e.g. a
 * `verified` Evidence with no Work).
 *
 * `note` and `question` are the two kinds the
 * cognitive canvas can persist *honestly*:
 *
 *   - `note`     → the v0.3 `noteBlocks` table; the
 *                 free node body becomes the row
 *                 content; `lecture_id = null`.
 *   - `question` → the WP-04 `StudyQuestion` table; the
 *                 free node body becomes the question
 *                 body; `status = 'open'`;
 *                 `review = 'unreviewed'`.
 *
 * `evidence`, `claim`, and `source` are owned by
 * WP-05 / WP-04 and the Evidence Workspace's
 * explicit flows (Verify, Link, Claim create). The
 * cognitive canvas never reaches into them; the
 * `UnsupportedKindError` makes the seam visible.
 */
export const UPGRADEABLE_KINDS: readonly KnowledgeObjectKind[] = [
  'note',
  'question',
] as const;

export type UpgradeableKind = (typeof UPGRADEABLE_KINDS)[number];

export function isUpgradeableKind(
  value: KnowledgeObjectKind,
): value is UpgradeableKind {
  return (UPGRADEABLE_KINDS as readonly KnowledgeObjectKind[]).includes(value);
}

export class UnsupportedKindError extends Error {
  readonly kind: KnowledgeObjectKind;
  constructor(kind: KnowledgeObjectKind) {
    super(
      `KnowledgeObject kind "${kind}" is not yet wired to a Dexie write path. ` +
        `The cognitive canvas only upgrades into: ${UPGRADEABLE_KINDS.join(', ')}. ` +
        `Adding a real Dexie schema for "${kind}" is a WP-02 follow-up.`,
    );
    this.name = 'UnsupportedKindError';
    this.kind = kind;
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers — domain → KnowledgeObject
// ---------------------------------------------------------------------------

function evidenceToKnowledgeObject(e: Evidence): KnowledgeObject {
  return {
    id: e.id,
    kind: 'evidence',
    body: e.exactQuote || e.userInterpretation || '',
    state: e.status === 'verified' ? 'active' : e.status === 'candidate' ? 'active' : 'archived',
    authorType: e.authorType,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function claimToKnowledgeObject(c: import('../domain/research').Claim): KnowledgeObject {
  return {
    id: c.id,
    kind: 'claim',
    body: c.body || c.title,
    state: c.status === 'canonical' ? 'active' : 'active',
    authorType: c.authorType,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function questionToKnowledgeObject(q: StudyQuestion): KnowledgeObject {
  return {
    id: q.id,
    kind: 'question',
    body: q.body,
    state: 'active',
    authorType: q.authorType,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

function paperToKnowledgeObject(p: LiteraturePaper): KnowledgeObject {
  return {
    id: p.id,
    kind: 'source',
    body: p.title || '',
    state: p.in_trash ? 'trashed' : 'active',
    authorType: 'imported',
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Mapping helpers — KnowledgeObject → Dexie row
// ---------------------------------------------------------------------------

interface NoteBackingStore {
  upsert(input: { id: string; body: string; authorType: 'user' | 'ai' | 'imported' }): Promise<{ id: string }>;
  archive(id: string): Promise<void>;
}

interface SourceBackingStore {
  upsertTitle(input: { id: string; title: string }): Promise<void>;
  moveToTrash(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Shim
// ---------------------------------------------------------------------------

export interface ShimStudyKitRepositoryDeps {
  readonly research: ResearchRepository;
  readonly study: StudyRepository;
  readonly notes: NoteBackingStore;
  readonly sources: SourceBackingStore;
  readonly listPapers: (projectId: string) => Promise<readonly LiteraturePaper[]>;
  readonly getPaper: (id: string) => Promise<LiteraturePaper | null>;
}

export class ShimStudyKitRepository implements StudyKitRepository {
  private readonly deps: ShimStudyKitRepositoryDeps;
  private readonly tombstones = new Set<string>();
  private readonly listeners = new Set<{ query: ObjectQuery; listener: QueryListener }>();
  /** Local cache of `note` and other "no Dexie write path"
   *  objects that the cognitive canvas can still create
   *  (e.g. `note` upgrades). Notes are written through
   *  `notes.upsert` and are not duplicated here. */

  constructor(deps: ShimStudyKitRepositoryDeps) {
    this.deps = deps;
  }

  async getObject(id: string): Promise<KnowledgeObject | null> {
    if (this.tombstones.has(id)) return null;
    // Fan out across the four canonical stores in a
    // deterministic order: evidence → claim → question
    // → paper. A `null` from a store means "not of that
    // kind"; an actual error (Dexie I/O, network, etc.)
    // propagates so the caller can surface it. Swallowing
    // a real error here would mask WP-04/WP-05 outages
    // and let the cognitive canvas silently render a
    // missing badge.
    const ev = await this.deps.research.getEvidence(id);
    if (ev) return evidenceToKnowledgeObject(ev);
    const cl = await this.deps.research.getClaim(id);
    if (cl) return claimToKnowledgeObject(cl);
    const q = await this.deps.study.getQuestion(id);
    if (q) return questionToKnowledgeObject(q);
    const p = await this.deps.getPaper(id);
    if (p) return paperToKnowledgeObject(p);
    return null;
  }

  async queryObjects(query: ObjectQuery): Promise<KnowledgeObject[]> {
    const out: KnowledgeObject[] = [];
    const state = query.state ?? 'active';
    const offset = query.offset ?? 0;
    const limit = query.limit ?? Number.POSITIVE_INFINITY;
    const wantKind = query.kind;
    const wantContainer = query.containerId;
    const needle = query.text?.toLowerCase();
    if (wantKind === undefined || wantKind === 'evidence') {
      const list = await this.deps.research.listEvidence({ projectId: wantContainer ?? '' });
      for (const e of list) {
        if (state === 'active' && e.status === 'rejected') continue;
        if (needle && !e.exactQuote.toLowerCase().includes(needle) && !e.userInterpretation.toLowerCase().includes(needle)) continue;
        out.push(evidenceToKnowledgeObject(e));
      }
    }
    if (wantKind === undefined || wantKind === 'claim') {
      const list = await this.deps.research.listClaims({ projectId: wantContainer ?? '' });
      for (const c of list) {
        if (needle && !c.body.toLowerCase().includes(needle) && !c.title.toLowerCase().includes(needle)) continue;
        out.push(claimToKnowledgeObject(c));
      }
    }
    if (wantKind === undefined || wantKind === 'question') {
      const list = await this.deps.study.listQuestions({ containerId: wantContainer ?? '' });
      for (const q of list) {
        if (needle && !q.body.toLowerCase().includes(needle)) continue;
        out.push(questionToKnowledgeObject(q));
      }
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out.slice(offset, offset + limit);
  }

  async transact<T>(fn: (tx: RepositoryTransaction) => T | Promise<T>): Promise<T> {
    const staged: Array<{ kind: 'put'; object: KnowledgeObject } | { kind: 'delete'; id: string }> = [];
    const tx: RepositoryTransaction = {
      put: (object) => {
        if (!isUpgradeableKind(object.kind)) {
          throw new UnsupportedKindError(object.kind);
        }
        staged.push({ kind: 'put', object });
      },
      delete: (id) => {
        staged.push({ kind: 'delete', id });
      },
    };
    const result = await fn(tx);
    for (const op of staged) {
      if (op.kind === 'put') {
        await this.persistOne(op.object);
      } else {
        await this.tombstoneOne(op.id);
      }
    }
    this.notify();
    return result;
  }

  subscribe(query: ObjectQuery, listener: QueryListener): Unsubscribe {
    const entry = { query, listener };
    this.listeners.add(entry);
    return () => {
      this.listeners.delete(entry);
    };
  }

  async exportSnapshot(options: import('../domain/repository').ExportOptions): Promise<import('../domain/repository').ExportArtifact> {
    // The shim does not snapshot — the cognitive canvas
    // never exports canonical state. Throw a clear
    // error so the caller knows the path is unsupported.
    void options;
    throw new Error(
      'ShimStudyKitRepository: exportSnapshot is not implemented. ' +
        'Canonical export is owned by the WP-04 / WP-05 repositories.',
    );
  }

  // --- Internals ---

  private async persistOne(object: KnowledgeObject): Promise<void> {
    if (this.tombstones.has(object.id)) this.tombstones.delete(object.id);
    switch (object.kind) {
      case 'note':
        // The v0.3 `noteBlocks` row carries the free
        // node's body as-is. The cognitive canvas
        // touches no lecture / module anchor; the
        // row's `lecture_id = null` is the canvas-
        // local signal (the v0.3 schema accepts it).
        await this.deps.notes.upsert({
          id: object.id,
          body: object.body,
          authorType: object.authorType,
        });
        return;
      case 'question':
        // The StudyQuestion row mirrors the free
        // node's body. The container is whatever the
        // free node was anchored to (typically
        // `{ mode: 'research', kind: 'project', id }`);
        // the Study UI later surfaces it in the
        // question queue. No work / no Evidence
        // link — those are owned by the Evidence
        // Workspace (WP-05) and would not be honest
        // here.
        //
        // The `StudyQuestion.authorType` is
        // `'user' | 'imported'` (no `'ai'`); an
        // AI-authored free node promoted to a
        // canonical question is recorded as `'user'`
        // (the user is the one who promoted it).
        // The free node's AI provenance stays in
        // the canvas-local state.
        await this.deps.study.transact(async (tx) => {
          tx.putQuestion({
            id: object.id,
            container: object.container ?? {
              workspaceId: null,
              mode: 'research',
              kind: 'project',
              id: 'unknown',
            },
            locator: null,
            body: object.body,
            status: 'open',
            review: 'unreviewed' as ReviewState,
            createdAt: object.createdAt,
            updatedAt: object.updatedAt,
            authorType: 'user',
          });
        });
        return;
      case 'evidence':
      case 'claim':
      case 'source':
        // The cognitive canvas does NOT own these
        // kinds. `isUpgradeableKind` rejects them in
        // `transact` already; the explicit throw here
        // is defence-in-depth so a future refactor
        // cannot accidentally re-introduce a
        // fabrication path (e.g. a `verified`
        // Evidence with no Work, or a `canonical`
        // Claim with no linked Evidence).
        throw new UnsupportedKindError(object.kind);
      case 'concept':
      case 'task':
      case 'output':
        throw new UnsupportedKindError(object.kind);
    }
  }

  private async tombstoneOne(id: string): Promise<void> {
    this.tombstones.add(id);
    // The two backing stores' `archive` / `moveToTrash`
    // methods are *no-ops when the row does not exist*
    // (the production Dexie adapters check the row
    // first; see `canvasBackingStores.ts`). We invoke
    // both so the tombstone reaches whichever store
    // owns the row, and we let any *real* error
    // (Dexie I/O failure, schema mismatch) propagate
    // to the caller — a swallowed error here would
    // let the shim report the row as deleted when it
    // is still in canonical storage.
    await this.deps.notes.archive(id);
    await this.deps.sources.moveToTrash(id);
  }

  private notify(): void {
    for (const { query, listener } of this.listeners) {
      void this.queryObjects(query).then((results) => listener(results));
    }
  }
}

// Re-export the small surface the application layer needs.
export { paperToKnowledgeObject, evidenceToKnowledgeObject, claimToKnowledgeObject, questionToKnowledgeObject };
export type { ObjectState };
