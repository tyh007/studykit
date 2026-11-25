/**
 * StudyKit v0.4 — `application/research/workReaderSource`
 *
 * Single seam that resolves a canonical `Work`
 * (from the v0.4 Research repository) to a
 * `LiteraturePDFSource` the Reader can render.
 *
 * Three sources, in priority order:
 *
 *   1. A `local-pdf` `WorkAsset`. The Reader asks
 *      `pdfAssetStore.getObjectUrl(assetId)` and
 *      receives a stable `object URL`. The `assetId`
 *      in the returned source is the `WorkAsset.id`
 *      so the Evidence locator round-trips via the
 *      same row the Reader used to open the PDF.
 *
 *   2. A `linked-file` `WorkAsset` whose `ref` is a
 *      v0.3 `LiteraturePaper.id`. The Reader fetches
 *      the legacy `/api/literature/papers/{ref}/download`
 *      PDF. The `assetId` in the returned source is
 *      the `WorkAsset.id` so the locator round-trips
 *      back to the same WorkAsset; the legacy `paperId`
 *      is preserved separately for the actual download.
 *
 *   3. A canonical `Work` whose `identifiers.doi`
 *      matches a v0.3 `LiteraturePaper`. The Reader
 *      falls back to the legacy paper's PDF; the
 *      `assetId` is the legacy `LiteraturePaper.id`
 *      so the locator round-trips even when no
 *      WorkAsset exists yet (the user can
 *      `importLocalPdf` later and the WorkAsset is
 *      created on top of the same Work).
 *
 * Why a single function? The Reader component is
 * simple — it takes a `Work` and asks "what do I
 * show?". Three policies, one seam, one failure mode
 * the UI renders honestly.
 *
 * The function is the SINGLE source of truth for the
 * `source.assetId` field. UI surfaces that build a
 * `paper-page` Evidence locator MUST read this field
 * directly — they MUST NOT derive an `assetId` from
 * the canonical `work.id` (that would always be
 * incomplete for `remote` sources).
 */

import type { LiteraturePDFSource } from '../../components/literature/LiteraturePDFViewer';
import { pdfAssetStore } from '../../platforms/web/pdfAssetStore';
import { getDataApi, type Capability } from '../dataApi';
import type { Work, WorkAsset } from '../../domain/research';
import type { ResearchRepository } from './researchRepository';
import type { SourceAssetBridge } from '../assets/sourceAssetBridge';

export type WorkReaderSourceError =
  | { kind: 'no-asset'; message: string }
  | { kind: 'sync-only'; message: string; capability: Capability }
  | { kind: 'unsupported-flavour'; message: string };

export type WorkReaderSourceResult =
  | { kind: 'ok'; source: LiteraturePDFSource; workAsset?: WorkAsset }
  | { kind: 'error'; error: WorkReaderSourceError };

/**
 * Resolve a Work to a renderable PDF source. Pure
 * function over the repository + the dataApi
 * gateway; the Reader calls this with the current
 * `Work` and renders the result.
 */
export async function resolveWorkReaderSource(
  repository: ResearchRepository,
  work: Work,
  sourceAssets?: Pick<SourceAssetBridge, 'getBlob'>,
): Promise<WorkReaderSourceResult> {
  // 1) Local-pdf asset.
  for (const assetId of work.assetIds) {
    const assets = await repository.listWorkAssetsForWork(work.id);
    const asset = assets.find((a) => a.id === assetId && a.kind === 'local-pdf');
    if (asset) {
      if (sourceAssets) {
        const blob = await sourceAssets.getBlob(asset.id);
        if (blob) {
          return {
            kind: 'ok',
            source: { kind: 'local-blob', blob, assetId: asset.id },
            workAsset: asset,
          };
        }
      } else {
        const url = await pdfAssetStore.getObjectUrl(asset.id);
        if (!url) continue;
        return {
          kind: 'ok',
          source: { kind: 'local-url', url, assetId: asset.id },
          workAsset: asset,
        };
      }
    }
  }

  // 2) linked-file / remote paper — the WorkAsset carries
  //    the legacy `LiteraturePaper.id` as `ref` and
  //    supplies a stable `assetId` for the Evidence
  //    locator.
  for (const assetId of work.assetIds) {
    const assets = await repository.listWorkAssetsForWork(work.id);
    const asset = assets.find((a) => a.id === assetId);
    if (asset && asset.kind === 'linked-file' && asset.ref) {
      return {
        kind: 'ok',
        source: { kind: 'remote', paperId: asset.ref, assetId: asset.id },
        workAsset: asset,
      };
    }
  }

  // 3) DOI match in v0.3 literature papers.
  //    The legacy paper id is reused as the `assetId`
  //    so the locator round-trips: opening the same
  //    Evidence later finds the same legacy paper.
  const dataApi = getDataApi();
  if (dataApi.supports('literaturePapers.list')) {
    try {
      for (const projectId of work.projectIds) {
        const papers = await dataApi.literaturePapers.list(projectId);
        const match = findLegacyPaperMatch(work, papers);
        if (match) {
          return {
            kind: 'ok',
            source: { kind: 'remote', paperId: match.id, assetId: match.id },
          };
        }
      }
    } catch {
      // The DOI lookup is best-effort; the UI shows a
      // clean "import a PDF" notice on failure.
    }
  } else if (work.identifiers.doi) {
    return {
      kind: 'error',
      error: {
        kind: 'sync-only',
        message:
          'This Work has no local PDF. The DOI match needs the sync workspace; import the PDF locally to read it.',
        capability: 'literaturePapers.list',
      },
    };
  }

  return {
    kind: 'error',
    error: {
      kind: 'no-asset',
      message:
        'No PDF attached to this Work yet. Use "Import PDF" below to add a local file.',
    },
  };
}

/**
 * Find the legacy `LiteraturePaper` whose DOI matches
 * the canonical `Work`. The v0.3 table exposes `doi`
 * only; the identifier bridge is therefore a DOI match.
 */
function findLegacyPaperMatch(
  work: Work,
  papers: ReadonlyArray<{ id: string; doi?: string | null }>,
): { id: string } | null {
  const wDoi = (work.identifiers.doi ?? '').toLowerCase();
  if (!wDoi) return null;
  for (const p of papers) {
    const pDoi = (p.doi ?? '').toLowerCase();
    if (pDoi && wDoi === pDoi) return p;
  }
  return null;
}
