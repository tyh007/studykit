import {
  MemoryResearchRepository,
  type ResearchQueryListener,
  type ResearchRepository,
  type ResearchRepositoryTransaction,
} from '../../application/research/researchRepository';
import type {
  Claim,
  ClaimEvidenceLink,
  Evidence,
  QuerySpec,
  ResearchProject,
  SearchCandidate,
  SearchRun,
  Work,
  WorkAsset,
  WorkConflict,
} from '../../domain/research';
import type {
  DesignSpec,
  Hypothesis,
  MethodDecision,
  Milestone,
  ResearchQuestion,
  ResearchRisk,
  ResearchTask,
} from '../../domain/researchDesign';
import type {
  OutputDocument,
  OutputSection,
  OutputStatement,
  StatementSupport,
} from '../../domain/output';
import type { StatementCitation } from '../../domain/citation';
import {
  deleteDomainRecord,
  DesktopDomainRecordStore,
  putDomainRecord,
} from './domainRecordStore';
import type { DomainTransactOperation } from './workspaceClient';

type ResearchEntity =
  | 'project'
  | 'query_spec'
  | 'run'
  | 'candidate'
  | 'work'
  | 'work_asset'
  | 'evidence'
  | 'claim'
  | 'link'
  | 'conflict'
  | 'question'
  | 'hypothesis'
  | 'design_spec'
  | 'method_decision'
  | 'risk'
  | 'milestone'
  | 'task'
  | 'output'
  | 'output_section'
  | 'output_statement'
  | 'statement_support'
  | 'statement_citation';

function put(
  entityType: ResearchEntity,
  value: object,
): DomainTransactOperation {
  return putDomainRecord(
    'research',
    entityType,
    value as Record<string, unknown>,
  );
}

function del(
  entityType: ResearchEntity,
  id: string,
): DomainTransactOperation {
  return deleteDomainRecord('research', entityType, id);
}

function hydrate(
  tx: ResearchRepositoryTransaction,
  entityType: string,
  value: Record<string, unknown>,
): void {
  switch (entityType as ResearchEntity) {
    case 'project': tx.putProject(value as unknown as ResearchProject); break;
    case 'query_spec': tx.putQuerySpec(value as unknown as QuerySpec); break;
    case 'run': tx.putRun(value as unknown as SearchRun); break;
    case 'candidate': tx.putCandidate(value as unknown as SearchCandidate); break;
    case 'work': tx.putWork(value as unknown as Work); break;
    case 'work_asset': tx.putWorkAsset(value as unknown as WorkAsset); break;
    case 'evidence': tx.putEvidence(value as unknown as Evidence); break;
    case 'claim': tx.putClaim(value as unknown as Claim); break;
    case 'link': tx.putLink(value as unknown as ClaimEvidenceLink); break;
    case 'conflict': tx.putConflict(value as unknown as WorkConflict); break;
    case 'question': tx.putQuestion(value as unknown as ResearchQuestion); break;
    case 'hypothesis': tx.putHypothesis(value as unknown as Hypothesis); break;
    case 'design_spec': tx.putDesignSpec(value as unknown as DesignSpec); break;
    case 'method_decision': tx.putMethodDecision(value as unknown as MethodDecision); break;
    case 'risk': tx.putRisk(value as unknown as ResearchRisk); break;
    case 'milestone': tx.putMilestone(value as unknown as Milestone); break;
    case 'task': tx.putTask(value as unknown as ResearchTask); break;
    case 'output': tx.putOutput(value as unknown as OutputDocument); break;
    case 'output_section': tx.putOutputSection(value as unknown as OutputSection); break;
    case 'output_statement': tx.putOutputStatement(value as unknown as OutputStatement); break;
    case 'statement_support': tx.putStatementSupport(value as unknown as StatementSupport); break;
    case 'statement_citation': tx.putStatementCitation(value as unknown as StatementCitation); break;
    default: throw new Error(`Unsupported Research entity type: ${entityType}`);
  }
}

export class SqliteResearchRepository implements ResearchRepository {
  private memory: MemoryResearchRepository | null = null;
  private loading: Promise<MemoryResearchRepository> | null = null;

  constructor(private readonly store: DesktopDomainRecordStore) {}

  private async ready(): Promise<MemoryResearchRepository> {
    if (this.memory) return this.memory;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const rows = await this.store.read('research');
      const memory = new MemoryResearchRepository();
      await memory.transact((tx) => {
        for (const row of rows) hydrate(tx, row.entityType, row.value);
      });
      this.memory = memory;
      return memory;
    })();
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  async getProject(...args: Parameters<ResearchRepository['getProject']>) {
    return (await this.ready()).getProject(...args);
  }
  async listProjects(...args: Parameters<ResearchRepository['listProjects']>) {
    return (await this.ready()).listProjects(...args);
  }
  async getQuerySpec(...args: Parameters<ResearchRepository['getQuerySpec']>) {
    return (await this.ready()).getQuerySpec(...args);
  }
  async listQuerySpecsForProject(...args: Parameters<ResearchRepository['listQuerySpecsForProject']>) {
    return (await this.ready()).listQuerySpecsForProject(...args);
  }
  async getRun(...args: Parameters<ResearchRepository['getRun']>) {
    return (await this.ready()).getRun(...args);
  }
  async listRuns(...args: Parameters<ResearchRepository['listRuns']>) {
    return (await this.ready()).listRuns(...args);
  }
  async listCandidates(...args: Parameters<ResearchRepository['listCandidates']>) {
    return (await this.ready()).listCandidates(...args);
  }
  async getCandidate(...args: Parameters<ResearchRepository['getCandidate']>) {
    return (await this.ready()).getCandidate(...args);
  }
  async getWork(...args: Parameters<ResearchRepository['getWork']>) {
    return (await this.ready()).getWork(...args);
  }
  async listWorks(...args: Parameters<ResearchRepository['listWorks']>) {
    return (await this.ready()).listWorks(...args);
  }
  async listWorkAssetsForWork(...args: Parameters<ResearchRepository['listWorkAssetsForWork']>) {
    return (await this.ready()).listWorkAssetsForWork(...args);
  }
  async findWorkByAssetRef(...args: Parameters<ResearchRepository['findWorkByAssetRef']>) {
    return (await this.ready()).findWorkByAssetRef(...args);
  }
  async listEvidence(...args: Parameters<ResearchRepository['listEvidence']>) {
    return (await this.ready()).listEvidence(...args);
  }
  async getEvidence(...args: Parameters<ResearchRepository['getEvidence']>) {
    return (await this.ready()).getEvidence(...args);
  }
  async listClaims(...args: Parameters<ResearchRepository['listClaims']>) {
    return (await this.ready()).listClaims(...args);
  }
  async getClaim(...args: Parameters<ResearchRepository['getClaim']>) {
    return (await this.ready()).getClaim(...args);
  }
  async listLinks(...args: Parameters<ResearchRepository['listLinks']>) {
    return (await this.ready()).listLinks(...args);
  }
  async listConflicts(...args: Parameters<ResearchRepository['listConflicts']>) {
    return (await this.ready()).listConflicts(...args);
  }
  async getConflict(...args: Parameters<ResearchRepository['getConflict']>) {
    return (await this.ready()).getConflict(...args);
  }
  async listQuestions(...args: Parameters<ResearchRepository['listQuestions']>) {
    return (await this.ready()).listQuestions(...args);
  }
  async getQuestion(...args: Parameters<ResearchRepository['getQuestion']>) {
    return (await this.ready()).getQuestion(...args);
  }
  async listHypotheses(...args: Parameters<ResearchRepository['listHypotheses']>) {
    return (await this.ready()).listHypotheses(...args);
  }
  async listDesignSpecs(...args: Parameters<ResearchRepository['listDesignSpecs']>) {
    return (await this.ready()).listDesignSpecs(...args);
  }
  async getDesignSpec(...args: Parameters<ResearchRepository['getDesignSpec']>) {
    return (await this.ready()).getDesignSpec(...args);
  }
  async listMethodDecisions(...args: Parameters<ResearchRepository['listMethodDecisions']>) {
    return (await this.ready()).listMethodDecisions(...args);
  }
  async getMethodDecision(...args: Parameters<ResearchRepository['getMethodDecision']>) {
    return (await this.ready()).getMethodDecision(...args);
  }
  async listRisks(...args: Parameters<ResearchRepository['listRisks']>) {
    return (await this.ready()).listRisks(...args);
  }
  async listMilestones(...args: Parameters<ResearchRepository['listMilestones']>) {
    return (await this.ready()).listMilestones(...args);
  }
  async listTasks(...args: Parameters<ResearchRepository['listTasks']>) {
    return (await this.ready()).listTasks(...args);
  }
  async getTask(...args: Parameters<ResearchRepository['getTask']>) {
    return (await this.ready()).getTask(...args);
  }

  // --- WP-10 Round 1: Output reads

  async getOutput(...args: Parameters<ResearchRepository['getOutput']>) {
    return (await this.ready()).getOutput(...args);
  }
  async listOutputs(...args: Parameters<ResearchRepository['listOutputs']>) {
    return (await this.ready()).listOutputs(...args);
  }
  async getOutputSection(...args: Parameters<ResearchRepository['getOutputSection']>) {
    return (await this.ready()).getOutputSection(...args);
  }
  async listOutputSections(...args: Parameters<ResearchRepository['listOutputSections']>) {
    return (await this.ready()).listOutputSections(...args);
  }
  async getOutputStatement(...args: Parameters<ResearchRepository['getOutputStatement']>) {
    return (await this.ready()).getOutputStatement(...args);
  }
  async listOutputStatements(...args: Parameters<ResearchRepository['listOutputStatements']>) {
    return (await this.ready()).listOutputStatements(...args);
  }
  async listStatementSupports(...args: Parameters<ResearchRepository['listStatementSupports']>) {
    return (await this.ready()).listStatementSupports(...args);
  }

  async getStatementCitation(...args: Parameters<ResearchRepository['getStatementCitation']>) {
    return (await this.ready()).getStatementCitation(...args);
  }

  async listStatementCitations(...args: Parameters<ResearchRepository['listStatementCitations']>) {
    return (await this.ready()).listStatementCitations(...args);
  }

  async transact<T>(
    fn: (tx: ResearchRepositoryTransaction) => T | Promise<T>,
  ): Promise<T> {
    const memory = await this.ready();
    return memory.transact(async (base) => {
      const operations: DomainTransactOperation[] = [];
      const tx = {} as ResearchRepositoryTransaction;
      const putMethod = <T extends object>(
        name: keyof ResearchRepositoryTransaction,
        entity: ResearchEntity,
      ) => (value: T): void => {
        (base[name] as (item: T) => void)(value);
        operations.push(put(entity, value));
      };
      const deleteMethod = (
        name: keyof ResearchRepositoryTransaction,
        entity: ResearchEntity,
      ) => (id: string): void => {
        (base[name] as (itemId: string) => void)(id);
        operations.push(del(entity, id));
      };
      Object.assign(tx, {
        putProject: putMethod<ResearchProject>('putProject', 'project'),
        deleteProject: deleteMethod('deleteProject', 'project'),
        putQuerySpec: putMethod<QuerySpec>('putQuerySpec', 'query_spec'),
        deleteQuerySpec: deleteMethod('deleteQuerySpec', 'query_spec'),
        putRun: putMethod<SearchRun>('putRun', 'run'),
        deleteRun: deleteMethod('deleteRun', 'run'),
        putCandidate: putMethod<SearchCandidate>('putCandidate', 'candidate'),
        deleteCandidate: deleteMethod('deleteCandidate', 'candidate'),
        putWork: putMethod<Work>('putWork', 'work'),
        deleteWork: deleteMethod('deleteWork', 'work'),
        putWorkAsset: putMethod<WorkAsset>('putWorkAsset', 'work_asset'),
        deleteWorkAsset: deleteMethod('deleteWorkAsset', 'work_asset'),
        putEvidence: putMethod<Evidence>('putEvidence', 'evidence'),
        deleteEvidence: deleteMethod('deleteEvidence', 'evidence'),
        putClaim: putMethod<Claim>('putClaim', 'claim'),
        deleteClaim: deleteMethod('deleteClaim', 'claim'),
        putLink: putMethod<ClaimEvidenceLink>('putLink', 'link'),
        deleteLink: deleteMethod('deleteLink', 'link'),
        putConflict: putMethod<WorkConflict>('putConflict', 'conflict'),
        deleteConflict: deleteMethod('deleteConflict', 'conflict'),
        putQuestion: putMethod<ResearchQuestion>('putQuestion', 'question'),
        deleteQuestion: deleteMethod('deleteQuestion', 'question'),
        putHypothesis: putMethod<Hypothesis>('putHypothesis', 'hypothesis'),
        deleteHypothesis: deleteMethod('deleteHypothesis', 'hypothesis'),
        putDesignSpec: putMethod<DesignSpec>('putDesignSpec', 'design_spec'),
        deleteDesignSpec: deleteMethod('deleteDesignSpec', 'design_spec'),
        putMethodDecision: putMethod<MethodDecision>('putMethodDecision', 'method_decision'),
        deleteMethodDecision: deleteMethod('deleteMethodDecision', 'method_decision'),
        putRisk: putMethod<ResearchRisk>('putRisk', 'risk'),
        deleteRisk: deleteMethod('deleteRisk', 'risk'),
        putMilestone: putMethod<Milestone>('putMilestone', 'milestone'),
        deleteMilestone: deleteMethod('deleteMilestone', 'milestone'),
        putTask: putMethod<ResearchTask>('putTask', 'task'),
        deleteTask: deleteMethod('deleteTask', 'task'),
        putOutput: putMethod<OutputDocument>('putOutput', 'output'),
        deleteOutput: deleteMethod('deleteOutput', 'output'),
        putOutputSection: putMethod<OutputSection>('putOutputSection', 'output_section'),
        deleteOutputSection: deleteMethod('deleteOutputSection', 'output_section'),
        putOutputStatement: putMethod<OutputStatement>('putOutputStatement', 'output_statement'),
        deleteOutputStatement: deleteMethod('deleteOutputStatement', 'output_statement'),
        putStatementSupport: putMethod<StatementSupport>('putStatementSupport', 'statement_support'),
        deleteStatementSupport: deleteMethod('deleteStatementSupport', 'statement_support'),
        putStatementCitation: putMethod<StatementCitation>('putStatementCitation', 'statement_citation'),
        deleteStatementCitation: deleteMethod('deleteStatementCitation', 'statement_citation'),
      });
      const result = await fn(tx);
      await this.store.transact(operations);
      return result;
    });
  }

  subscribe(listener: ResearchQueryListener): () => void {
    let active = true;
    let unsubscribe = () => {};
    void this.ready().then((memory) => {
      if (active) unsubscribe = memory.subscribe(listener);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }
}

export function createSqliteResearchRepository(
  store: DesktopDomainRecordStore,
): ResearchRepository {
  return new SqliteResearchRepository(store);
}
