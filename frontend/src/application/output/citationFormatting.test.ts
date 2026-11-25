import { describe, expect, it } from 'vitest';
import type { CslJsonItem } from '../../domain/citation';
import {
  exportCitationsBibtex,
  exportCitationsRis,
  formatCitationsWithCsl,
} from './citationFormatting';

const item: CslJsonItem = {
  id: 'doe2025sleep',
  type: 'article',
  title: 'Sleep and Memory',
  author: [{ family: 'Doe', given: 'Jane' }],
  issued: { 'date-parts': [[2025]] },
  'container-title': 'Journal of Sleep',
  DOI: '10.1234/example',
};

describe('citation formatting', () => {
  it.each(['apa', 'mla', 'chicago-author-date'] as const)(
    'renders deterministic %s citations and bibliography through CSL',
    async (style) => {
      const result = await formatCitationsWithCsl([item], style);
      expect(result.citations[item.id]).toContain('Doe');
      expect(result.bibliography).toContain('Sleep and Memory');
      expect(result.bibliography).toContain('2025');
    },
  );

  it('exports valid-looking BibTeX and RIS from the same CSL-JSON', async () => {
    const bibtex = await exportCitationsBibtex([item]);
    expect(bibtex).toContain('@article{doe2025sleep');
    expect(bibtex).toContain('doi = {10.1234/example}');
    const ris = await exportCitationsRis([item]);
    expect(ris).toContain('TY  - JOUR');
    expect(ris).toContain('DO  - 10.1234/example');
    expect(ris).toContain('ER  -');
  });
});
