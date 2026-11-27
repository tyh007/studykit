/**
 * StudyKit v0.5 P5b — the AI as moderator, not author.
 *
 * Asked about a disagreement, it restates each view neutrally with what
 * its evidence shows, says which views have no evidence yet, and names
 * what evidence would settle the question. It never picks a winner and
 * never writes the outcome: the summary is shown beside the
 * disagreement, labelled, and is not stored in the record.
 */

import type { ProviderRouter } from '../../features/ai/kernel/providerRouter';
import type { DisagreementPosition } from '../../domain/brainstorm';
import type { ResearchRepository } from './researchRepository';

/** Moderator needs at least two views to compare. */
export const MIN_VIEWS_TO_MODERATE = 2;

type Quote = { readonly quote: string; readonly source: string; readonly pageNumber?: number };

function excerptLines(p: DisagreementPosition, quotes: ReadonlyMap<string, Quote>): string {
  const lines = p.evidenceIds
    .map((id): Quote | undefined => quotes.get(id) ?? p.citations?.find((c) => c.evidenceId === id))
    .filter((c): c is Quote => Boolean(c))
    .map((c) => `    - "${c.quote.slice(0, 500)}" (${c.source}${c.pageNumber ? `, p. ${c.pageNumber}` : ''})`);
  return lines.length > 0 ? lines.join('\n') : '    - (no evidence yet)';
}

export async function moderateDisagreement(
  repository: ResearchRepository,
  router: ProviderRouter,
  disagreementId: string,
): Promise<string> {
  const d = await repository.getDisagreement(disagreementId);
  if (!d) throw new Error(`moderateDisagreement: disagreement ${disagreementId} not found.`);
  const positions = await repository.listDisagreementPositions({ disagreementId });
  if (positions.length < MIN_VIEWS_TO_MODERATE) throw new Error('moderateDisagreement: add at least two views first.');
  const [evidence, works] = await Promise.all([repository.listEvidence({ projectId: d.projectId }), repository.listWorks({ projectId: d.projectId })]);
  const titles = new Map(works.map((w) => [w.id, w.title || 'Untitled source']));
  const quotes = new Map<string, Quote>(
    evidence.map((e) => [
      e.id,
      {
        quote: e.exactQuote,
        source: titles.get(e.workId) ?? 'Untitled source',
        ...(e.locator.pageNumber ? { pageNumber: e.locator.pageNumber } : {}),
      },
    ]),
  );
  const claim = d.claimId ? await repository.getClaim(d.claimId) : null;
  const about = claim?.title ?? d.pointTitle;
  const views = positions
    .map((p, i) => `View ${i + 1}${p.holder ? ` (${p.holder})` : ''}: ${p.stance}\n  Evidence:\n${excerptLines(p, quotes)}`)
    .join('\n');
  const response = await router.chat({
    messages: [
      {
        role: 'system',
        content: [
          'You moderate a disagreement in a research group. You are neutral.',
          'Do not say which view is right and do not write a conclusion for them.',
          'In at most 120 words:',
          '1. Restate each view in one line and what its quoted evidence actually shows (or that it has none).',
          '2. Say where the views really differ.',
          '3. Name the one piece of evidence that would most help settle it.',
          'Plain sentences. Use only the evidence given; do not invent sources.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `Question: ${d.question}${about ? `\nAbout the point: ${about}` : ''}\n${views}`,
      },
    ],
  });
  const text = response.content.trim();
  if (!text) throw new Error('moderateDisagreement: the AI returned nothing. Try again.');
  return text;
}
