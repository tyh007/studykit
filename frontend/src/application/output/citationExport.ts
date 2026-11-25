import type { Work } from '../../domain/research';
import type { OutputDocument, OutputSection, OutputStatement } from '../../domain/output';
import { stableSectionOrder, stableStatementOrder } from '../../domain/output';
import type { StatementCitation } from '../../domain/citation';
import { workToCslJson, type CslJsonItem } from '../../domain/citation';

export function exportOutputCslJson(input: {
  readonly citations: readonly StatementCitation[];
  readonly works: readonly Work[];
}): readonly CslJsonItem[] {
  const workById = new Map(input.works.map((work) => [work.id, work]));
  const seen = new Set<string>();
  const result: CslJsonItem[] = [];
  for (const citation of input.citations) {
    if (seen.has(citation.workId)) continue;
    const work = workById.get(citation.workId);
    if (!work) throw new Error(`Cannot export missing canonical Work ${citation.workId}.`);
    seen.add(citation.workId);
    result.push(workToCslJson(work, citation.citeKey));
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export function exportOutputMarkdown(input: {
  readonly output: OutputDocument;
  readonly sections: readonly OutputSection[];
  readonly statements: readonly OutputStatement[];
  readonly citations: readonly StatementCitation[];
  readonly works: readonly Work[];
}): string {
  const citationByStatement = new Map<string, StatementCitation[]>();
  for (const citation of input.citations) {
    const current = citationByStatement.get(citation.statementId) ?? [];
    current.push(citation);
    citationByStatement.set(citation.statementId, current);
  }
  const lines = [`# ${input.output.title}`, ''];
  for (const section of stableSectionOrder(input.sections)) {
    lines.push(`## ${section.title}`, '');
    for (const statement of stableStatementOrder(
      input.statements.filter((item) => item.sectionId === section.id),
    )) {
      const cites = (citationByStatement.get(statement.id) ?? [])
        .map((citation) => `[@${citation.citeKey}]`)
        .join(' ');
      lines.push(cites ? `${statement.body} ${cites}` : statement.body, '');
    }
  }
  const csl = exportOutputCslJson({ citations: input.citations, works: input.works });
  if (csl.length > 0) {
    lines.push('## References', '');
    for (const item of csl) lines.push(`- [@${item.id}] ${item.title}`);
    lines.push('');
  }
  return lines.join('\n');
}
