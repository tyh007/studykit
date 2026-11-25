/**
 * StudyKit v0.4 — `application/research/importFromZotero`
 *
 * Use case for "user picked a Zotero collection →
 * canonical Works are materialised in the v0.4
 * Research repository". The shape mirrors
 * `importLocalPdf`:
 *
 *   1. The host calls the v0.3 `zoteroApi` to list
 *      collections and import the chosen one's items.
 *      The Zotero import is *not* a v0.4 concern; we
 *      reuse the existing connector so WP-05 doesn't
 *      ship a second Zotero client.
 *   2. For every imported citation item, we
 *      canonicalise a `Work` (DOI / title / authors /
 *      year) and persist it with a `linked-file`
 *      `WorkAsset` whose `ref` is the v0.3
 *      `LiteraturePaper.id`. That way the same Work
 *      round-trips through the Reader via the legacy
 *      download path until the user imports a local
 *      PDF on top of the same Work.
 *   3. A failed import is reported with a per-item
 *      reason; the user can retry the collection
 *      without losing the items that already landed.
 *
 * The function is the seam — UI never imports
 * `lib/literature-api` directly.
 */

import { zoteroApi } from '../../lib/literature-api';
import {
  canonicaliseDoi,
  makeWorkIdFromIdentifiers,
  nowIso,
  type Work,
  type WorkAsset,
} from '../../domain/research';
import type { ResearchRepository } from './researchRepository';

/** The minimum surface of the v0.3 Zotero client the
 *  use case depends on. Tests pass a fake. */
export interface ZoteroClient {
  importCollectionItems: (data: {
    collectionId?: string;
    readingListId?: string;
    projectId?: string;
  }) => Promise<{
    citationItems?: Array<Record<string, unknown>>;
    importedCount?: number;
    projectId?: string;
    stats?: {
      totalItems?: number;
      importedItems?: number;
      existingItems?: number;
      skippedItems?: number;
      papersCreated?: number;
      pdfsDownloaded?: number;
      pdfsMissing?: number;
      pdfsFailed?: number;
      warnings?: string[];
    };
  }>;
  listCollections: () => Promise<{ collections: Array<{ id: string; name: string }> }>;
}

export interface ImportFromZoteroInput {
  readonly projectId: string;
  readonly collectionId: string;
  /**
   * Override the v0.3 Zotero client. Tests inject a
   * fake so the seam stays the only place that knows
   * about the legacy API.
   */
  readonly zotero?: ZoteroClient;
  readonly idFactory?: () => string;
}

export interface ImportFromZoteroResult {
  readonly works: readonly Work[];
  readonly items: readonly ImportedZoteroItem[];
  readonly stats: {
    readonly papersCreated: number;
    readonly papersExisting: number;
    readonly skipped: number;
    readonly failed: number;
    readonly warnings: readonly string[];
  };
}

export interface ImportedZoteroItem {
  readonly citationItemId: string;
  readonly workId: string | null;
  readonly title: string;
  readonly doi: string | null;
  readonly status: 'created' | 'existing' | 'skipped' | 'failed';
  readonly reason?: string;
}

function makeId(idFactory: (() => string) | undefined, prefix: string): string {
  if (idFactory) return idFactory();
  const rand = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36);
  return `${prefix}_${t}_${rand}`;
}

/**
 * Normalise a Zotero citation item into the fields we
 * need to build a canonical `Work`. The v0.3 Zotero
 * payload is loose (any of DOI, ISBN, title, etc.);
 * we look up the strongest identifier we can find.
 */
function citationToWorkFields(
  item: Record<string, unknown>,
): { title: string; authors: string[]; year?: number; venue?: string; doi: string | null; abstract?: string } | null {
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  if (title.length === 0) return null;
  const authors = Array.isArray(item.creators_json)
    ? (item.creators_json as Array<{ firstName?: string; lastName?: string; name?: string }>)
        .map((c) => {
          if (typeof c.name === 'string' && c.name.trim().length > 0) return c.name.trim();
          const last = typeof c.lastName === 'string' ? c.lastName.trim() : '';
          const first = typeof c.firstName === 'string' ? c.firstName.trim() : '';
          return [last, first].filter((s) => s.length > 0).join(', ');
        })
        .filter((s) => s.length > 0)
    : [];
  const year = typeof item.issued_year === 'number' ? item.issued_year : undefined;
  const venue = typeof item.publisher === 'string' ? item.publisher.trim() : undefined;
  const doi = canonicaliseDoi(typeof item.doi === 'string' ? item.doi : null) ?? null;
  const abstract = typeof item.abstract === 'string' ? item.abstract : undefined;
  return { title, authors, ...(year !== undefined ? { year } : {}), ...(venue ? { venue } : {}), doi, ...(abstract ? { abstract } : {}) };
}

export async function importFromZotero(
  repository: ResearchRepository,
  input: ImportFromZoteroInput,
): Promise<ImportFromZoteroResult> {
  const z = input.zotero ?? zoteroApi;
  // 1) trigger the legacy import. The legacy API
  //    creates v0.3 `LiteraturePaper` rows and returns
  //    the citation items.
  const importRes = await z.importCollectionItems({
    collectionId: input.collectionId,
    projectId: input.projectId,
  });
  const citationItems = (importRes.citationItems ?? []) as Array<Record<string, unknown>>;
  const works: Work[] = [];
  const imported: ImportedZoteroItem[] = [];
  let created = 0;
  let existing = 0;
  let skipped = 0;
  let failed = 0;
  const warnings: string[] = [...((importRes.stats?.warnings ?? []) as string[])];
  for (const item of citationItems) {
    const fields = citationToWorkFields(item);
    if (!fields) {
      failed += 1;
      imported.push({
        citationItemId: typeof item.id === 'string' ? item.id : `zot_${Math.random().toString(36).slice(2, 10)}`,
        workId: null,
        title: '',
        doi: null,
        status: 'failed',
        reason: 'no title',
      });
      continue;
    }
    // The legacy import created a v0.3 LiteraturePaper
    // for this item; we re-use the v0.3 paper id as a
    // back-link so the Reader can fetch the PDF.
    const legacyPaperId =
      (typeof item.literature_paper_id === 'string' && item.literature_paper_id) ||
      (typeof item.paper_id === 'string' && item.paper_id) ||
      (typeof item.id === 'string' && item.id) ||
      null;
    const identifiers = fields.doi ? { doi: fields.doi } : {};
    const workId = makeWorkIdFromIdentifiers(identifiers, fields.title, fields.authors, fields.year);
    // De-dupe: if a Work with the same id is already
    // in the project, just add the project id and skip
    // the create.
    const existingWork = await repository.getWork(workId);
    let work: Work;
    if (existingWork) {
      existing += 1;
      const alreadyOnProject = existingWork.projectIds.includes(input.projectId);
      work = {
        ...existingWork,
        projectIds: alreadyOnProject
          ? existingWork.projectIds
          : [...existingWork.projectIds, input.projectId],
        updatedAt: nowIso(),
      };
    } else {
      created += 1;
      work = {
        id: workId,
        identifiers,
        title: fields.title,
        authors: fields.authors,
        ...(fields.year !== undefined ? { year: fields.year } : {}),
        ...(fields.venue ? { venue: fields.venue } : {}),
        ...(fields.abstract ? { abstract: fields.abstract } : {}),
        metadataProvenance: {
          title: { providerId: 'zotero', at: nowIso() },
          authors: { providerId: 'zotero', at: nowIso() },
          ...(fields.year !== undefined ? { year: { providerId: 'zotero', at: nowIso() } } : {}),
          ...(fields.venue ? { venue: { providerId: 'zotero', at: nowIso() } } : {}),
          ...(fields.doi ? { doi: { providerId: 'zotero', at: nowIso() } } : {}),
        },
        integrity: 'unknown',
        assetIds: legacyPaperId ? [] : [],
        projectIds: [input.projectId],
        readingStatus: 'unread',
        importance: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        authorType: 'imported',
      };
    }
    const nextAssetIds = legacyPaperId && !work.assetIds.includes(`zot_${workId}`) ? [...work.assetIds, `zot_${workId}`] : work.assetIds;
    const nextWork: Work = { ...work, assetIds: nextAssetIds };
    const asset: WorkAsset | null = legacyPaperId
      ? {
          id: `zot_${workId}`,
          workId: nextWork.id,
          kind: 'linked-file',
          ref: legacyPaperId,
          createdAt: nowIso(),
        }
      : null;
    await repository.transact(async (tx) => {
      tx.putWork(nextWork);
      if (asset) tx.putWorkAsset(asset);
    });
    works.push(nextWork);
    imported.push({
      citationItemId: typeof item.id === 'string' ? item.id : workId,
      workId: nextWork.id,
      title: fields.title,
      doi: fields.doi,
      status: existingWork ? 'existing' : 'created',
    });
  }
  skipped = citationItems.length - works.length - failed;
  return {
    works,
    items: imported,
    stats: {
      papersCreated: created,
      papersExisting: existing,
      skipped,
      failed,
      warnings,
    },
  };
}
