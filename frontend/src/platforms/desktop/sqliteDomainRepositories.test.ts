import { describe, expect, it, vi } from 'vitest';
import type { StudyQuestion } from '../../domain/study';
import type { ResearchProject } from '../../domain/research';
import type { CanvasView, UndoLineage } from '../../domain/canvas';
import type {
  OutputDocument,
  OutputSection,
  OutputStatement,
  StatementSupport,
} from '../../domain/output';
import type { StatementCitation } from '../../domain/citation';
import {
  type DomainRecordRow,
  type DomainTransactPayload,
  type KnowledgeObjectRow,
  type TransactPayload,
  type WorkspaceClient,
  WorkspaceIpcError,
} from './workspaceClient';
import { DesktopDomainRecordStore } from './domainRecordStore';
import { createSqliteStudyRepository } from './sqliteStudyRepository';
import { createSqliteResearchRepository } from './sqliteResearchRepository';
import { createSqliteCanvasRepository } from './sqliteCanvasRepository';

const now = '2026-07-30T12:00:00.000Z';

class RecordClient implements WorkspaceClient {
  readonly hasTauriRuntime = true;
  readonly rows = new Map<string, DomainRecordRow>();
  failNextWrite = false;
  readonly transactDomainRecords = vi.fn(
    async (payload: DomainTransactPayload): Promise<void> => {
      if (this.failNextWrite) {
        this.failNextWrite = false;
        throw new WorkspaceIpcError({
          kind: 'STUDYKIT_DB_UNUSABLE',
          message: 'disk full',
        });
      }
      for (const operation of payload.operations) {
        if (operation.op === 'put') {
          const row = operation.row;
          this.rows.set(
            `${row.namespace}/${row.entity_type}/${row.id}`,
            row,
          );
        } else {
          this.rows.delete(
            `${operation.namespace}/${operation.entity_type}/${operation.id}`,
          );
        }
      }
    },
  );
  async readDomainRecords(namespace: string): Promise<readonly DomainRecordRow[]> {
    return [...this.rows.values()].filter((row) => row.namespace === namespace);
  }
  async chooseAndCreateWorkspace(): Promise<never> { throw new Error('unused'); }
  async chooseAndOpenWorkspace(): Promise<never> { throw new Error('unused'); }
  async reopenLastWorkspace(): Promise<never> { throw new Error('unused'); }
  async closeWorkspace(): Promise<void> {}
  async getWorkspaceHealth(): Promise<never> { throw new Error('unused'); }
  async readObject(): Promise<KnowledgeObjectRow | null> { return null; }
  async readAllObjects(): Promise<readonly KnowledgeObjectRow[]> { return []; }
  async transact(_payload: TransactPayload): Promise<void> {}
}

function question(id: string): StudyQuestion {
  return {
    id,
    body: `Question ${id}`,
    locator: null,
    status: 'open',
    review: 'unreviewed',
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
  };
}

function project(id: string): ResearchProject {
  return {
    id,
    container: {
      workspaceId: 'workspace-1',
      mode: 'research',
      kind: 'project',
      id,
    },
    name: `Project ${id}`,
    livingBrief: '',
    kind: 'explore',
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
  };
}

function view(id: string): CanvasView {
  return {
    id,
    container: {
      workspaceId: 'workspace-1',
      mode: 'research',
      kind: 'project',
      id: 'project-1',
    },
    title: 'Ideas',
    mode: 'spatial',
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  };
}

describe('SQLite domain repositories', () => {
  it('round-trips Study records and keeps memory unchanged on IPC failure', async () => {
    const client = new RecordClient();
    const first = createSqliteStudyRepository(new DesktopDomainRecordStore(client));
    await first.transact((tx) => tx.putQuestion(question('q-1')));

    const reopened = createSqliteStudyRepository(new DesktopDomainRecordStore(client));
    expect(await reopened.getQuestion('q-1')).toEqual(question('q-1'));

    client.failNextWrite = true;
    await expect(
      reopened.transact((tx) => tx.putQuestion(question('q-2'))),
    ).rejects.toMatchObject({ kind: 'STUDYKIT_DB_UNUSABLE' });
    expect(await reopened.getQuestion('q-2')).toBeNull();
  });

  it('round-trips a Research project through the shared native store', async () => {
    const client = new RecordClient();
    const first = createSqliteResearchRepository(
      new DesktopDomainRecordStore(client),
    );
    await first.transact((tx) => tx.putProject(project('p-1')));

    const reopened = createSqliteResearchRepository(
      new DesktopDomainRecordStore(client),
    );
    expect(await reopened.getProject('p-1')).toEqual(project('p-1'));
    expect(await reopened.listProjects()).toHaveLength(1);
  });

  it('persists Canvas views and lineage, including pop deletion', async () => {
    const client = new RecordClient();
    const first = createSqliteCanvasRepository(
      new DesktopDomainRecordStore(client),
    );
    const line: UndoLineage = {
      id: 'line-1',
      viewId: 'view-1',
      op: 'set-view-mode',
      previous: 'spatial',
      next: 'outline',
      linked: null,
      createdAt: now,
    };
    await first.transact((tx) => {
      tx.putView(view('view-1'));
      tx.appendLineage(line);
    });

    const reopened = createSqliteCanvasRepository(
      new DesktopDomainRecordStore(client),
    );
    expect(await reopened.getView('view-1')).toEqual(view('view-1'));
    expect(await reopened.listLineage('view-1')).toEqual([line]);
    await reopened.transact((tx) => {
      expect(tx.popLineage('view-1')).toEqual(line);
    });

    const reopenedAgain = createSqliteCanvasRepository(
      new DesktopDomainRecordStore(client),
    );
    expect(await reopenedAgain.listLineage('view-1')).toEqual([]);
  });
});

function outputFixture(overrides: Partial<OutputDocument> = {}): OutputDocument {
  return {
    id: 'o-1',
    projectId: 'p-1',
    title: 'My Output',
    status: 'outline',
    authorType: 'user',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function sectionFixture(overrides: Partial<OutputSection> = {}): OutputSection {
  return {
    id: 'sec-1',
    projectId: 'p-1',
    outputId: 'o-1',
    title: 'Intro',
    order: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function statementFixture(overrides: Partial<OutputStatement> = {}): OutputStatement {
  return {
    id: 'st-1',
    projectId: 'p-1',
    outputId: 'o-1',
    sectionId: 'sec-1',
    body: 'A claim.',
    order: 0,
    authorType: 'user',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function supportFixture(overrides: Partial<StatementSupport> = {}): StatementSupport {
  return {
    id: 'sup-1',
    projectId: 'p-1',
    outputId: 'o-1',
    statementId: 'st-1',
    ref: { kind: 'evidence', id: 'e-1' },
    relation: 'supports',
    authorType: 'user',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function citationFixture(overrides: Partial<StatementCitation> = {}): StatementCitation {
  return {
    id: 'cite-1', projectId: 'p-1', outputId: 'o-1', statementId: 'st-1',
    workId: 'work-1', citeKey: 'doe2025sleep-work1', authorType: 'user',
    createdAt: now, updatedAt: now, ...overrides,
  };
}

describe('SQLite Research repository / WP-10 Output (round-trip + IPC failure)', () => {
  it('round-trips OutputDocument + Section + Statement + Support through the SQLite-backed adapter', async () => {
    const client = new RecordClient();
    const repo = createSqliteResearchRepository(new DesktopDomainRecordStore(client));
    await repo.transact((tx) => {
      tx.putOutput(outputFixture({ id: 'o-rt' }));
      tx.putOutputSection(sectionFixture({ id: 'sec-rt', outputId: 'o-rt' }));
      tx.putOutputStatement(statementFixture({ id: 'st-rt', outputId: 'o-rt', sectionId: 'sec-rt' }));
      tx.putStatementSupport(supportFixture({ id: 'sup-rt', outputId: 'o-rt', statementId: 'st-rt' }));
      tx.putStatementCitation(citationFixture({ id: 'cite-rt', outputId: 'o-rt', statementId: 'st-rt' }));
    });
    const reopened = createSqliteResearchRepository(new DesktopDomainRecordStore(client));
    expect((await reopened.getOutput('o-rt'))?.title).toBe('My Output');
    const sections = await reopened.listOutputSections({ outputId: 'o-rt' });
    expect(sections.map((s) => s.id)).toEqual(['sec-rt']);
    const statements = await reopened.listOutputStatements({ outputId: 'o-rt' });
    expect(statements.map((s) => s.id)).toEqual(['st-rt']);
    const supports = await reopened.listStatementSupports({ outputId: 'o-rt' });
    expect(supports.map((s) => s.id)).toEqual(['sup-rt']);
    expect((await reopened.listStatementCitations({ outputId: 'o-rt' })).map((c) => c.id)).toEqual(['cite-rt']);
  });

  it('IPC failure on a WP-10 write leaves the repository unchanged', async () => {
    const client = new RecordClient();
    client.failNextWrite = true;
    const repo = createSqliteResearchRepository(new DesktopDomainRecordStore(client));
    await expect(
      repo.transact((tx) => {
        tx.putOutput(outputFixture({ id: 'o-fail' }));
      }),
    ).rejects.toMatchObject({ kind: 'STUDYKIT_DB_UNUSABLE' });
    expect(await repo.getOutput('o-fail')).toBeNull();
    expect(client.rows.size).toBe(0);
  });
});
