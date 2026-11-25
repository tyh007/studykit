import type { Work } from '../../domain/research';
import {
  auditCitation as auditCitationDomain,
  citeKeyForWork,
  type CitationAudit,
  type StatementCitation,
} from '../../domain/citation';
import type { ResearchRepository } from '../research/researchRepository';

function makeId(factory?: (prefix: string) => string): string {
  return factory?.('cite') ?? `cite_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function hasIdentifier(work: Work): boolean {
  return Object.values(work.identifiers).some(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
}

export async function insertStatementCitation(
  repository: ResearchRepository,
  input: {
    readonly statementId: string;
    readonly workId: string;
    readonly clock?: () => string;
    readonly idFactory?: (prefix: string) => string;
  },
): Promise<StatementCitation> {
  const statement = await repository.getOutputStatement(input.statementId);
  if (!statement) throw new Error(`insertStatementCitation: statement ${input.statementId} not found.`);
  const work = await repository.getWork(input.workId);
  if (!work || !work.projectIds.includes(statement.projectId)) {
    throw new Error(`insertStatementCitation: Work ${input.workId} is not canonical in this project.`);
  }
  if (!hasIdentifier(work)) {
    throw new Error('insertStatementCitation: Work has no verifiable identifier; create a citation-needed item instead.');
  }
  if (!work.title.trim() || work.authors.length === 0 || !work.year) {
    throw new Error('insertStatementCitation: Work metadata is incomplete.');
  }
  if (work.integrity === 'retracted') {
    throw new Error('insertStatementCitation: retracted Works cannot be inserted as citations.');
  }
  const timestamp = input.clock?.() ?? new Date().toISOString();
  const citation: StatementCitation = {
    id: makeId(input.idFactory),
    projectId: statement.projectId,
    outputId: statement.outputId,
    statementId: statement.id,
    workId: work.id,
    citeKey: citeKeyForWork(work),
    authorType: 'user',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await repository.transact((tx) => tx.putStatementCitation(citation));
  return citation;
}

export async function removeStatementCitation(
  repository: ResearchRepository,
  citationId: string,
): Promise<void> {
  const citation = await repository.getStatementCitation(citationId);
  if (!citation) throw new Error(`removeStatementCitation: citation ${citationId} not found.`);
  await repository.transact((tx) => tx.deleteStatementCitation(citation.id));
}

export async function auditStatementCitation(
  repository: ResearchRepository,
  citationId: string,
): Promise<CitationAudit> {
  const citation = await repository.getStatementCitation(citationId);
  if (!citation) throw new Error(`auditStatementCitation: citation ${citationId} not found.`);
  const [statement, work, evidence, supports] = await Promise.all([
    repository.getOutputStatement(citation.statementId),
    repository.getWork(citation.workId),
    repository.listEvidence({ projectId: citation.projectId }),
    repository.listStatementSupports({ statementId: citation.statementId }),
  ]);
  return auditCitationDomain({ citation, statement, work, evidence, supports });
}

export async function auditOutputCitations(
  repository: ResearchRepository,
  outputId: string,
): Promise<readonly CitationAudit[]> {
  const citations = await repository.listStatementCitations({ outputId });
  return Promise.all(citations.map((citation) => auditStatementCitation(repository, citation.id)));
}
