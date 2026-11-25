import type {
  QuestionQuery,
  StudyQueryListener,
  StudyRepository,
  StudyRepositoryTransaction,
} from '../../application/study/studyRepository';
import { MemoryStudyRepository } from '../../application/study/studyRepository';
import type {
  StudyAttempt,
  StudyFeedback,
  StudyQuestion,
  StudyRecoveryEntry,
} from '../../domain/study';
import type { DomainTransactOperation } from './workspaceClient';
import {
  deleteDomainRecord,
  DesktopDomainRecordStore,
  putDomainRecord,
} from './domainRecordStore';

type StudyEntity =
  | 'question'
  | 'attempt'
  | 'feedback'
  | 'recovery';

function put(entityType: StudyEntity, value: object): DomainTransactOperation {
  return putDomainRecord(
    'study',
    entityType,
    value as Record<string, unknown>,
  );
}

function del(entityType: StudyEntity, id: string): DomainTransactOperation {
  return deleteDomainRecord('study', entityType, id);
}

export class SqliteStudyRepository implements StudyRepository {
  private memory: MemoryStudyRepository | null = null;
  private loading: Promise<MemoryStudyRepository> | null = null;

  constructor(private readonly store: DesktopDomainRecordStore) {}

  private async ready(): Promise<MemoryStudyRepository> {
    if (this.memory) return this.memory;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const rows = await this.store.read('study');
      const memory = new MemoryStudyRepository();
      const recovery: StudyRecoveryEntry[] = [];
      await memory.transact((tx) => {
        for (const row of rows) {
          switch (row.entityType as StudyEntity) {
            case 'question':
              tx.putQuestion(row.value as unknown as StudyQuestion);
              break;
            case 'attempt':
              tx.putAttempt(row.value as unknown as StudyAttempt);
              break;
            case 'feedback':
              tx.putFeedback(row.value as unknown as StudyFeedback);
              break;
            case 'recovery':
              recovery.push(row.value as unknown as StudyRecoveryEntry);
              break;
            default:
              throw new Error(`Unsupported Study entity type: ${row.entityType}`);
          }
        }
      });
      for (const entry of recovery) await memory.putRecovery(entry);
      this.memory = memory;
      return memory;
    })();
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  async getQuestion(id: string): Promise<StudyQuestion | null> {
    return (await this.ready()).getQuestion(id);
  }

  async listQuestions(query: QuestionQuery): Promise<StudyQuestion[]> {
    return (await this.ready()).listQuestions(query);
  }

  async listAttemptsForQuestion(questionId: string): Promise<StudyAttempt[]> {
    return (await this.ready()).listAttemptsForQuestion(questionId);
  }

  async listFeedbackForQuestion(questionId: string): Promise<StudyFeedback[]> {
    return (await this.ready()).listFeedbackForQuestion(questionId);
  }

  async listRecentRecovery(
    containerId: string,
    lectureId: string,
  ): Promise<StudyRecoveryEntry[]> {
    return (await this.ready()).listRecentRecovery(containerId, lectureId);
  }

  async transact<T>(
    fn: (tx: StudyRepositoryTransaction) => T | Promise<T>,
  ): Promise<T> {
    const memory = await this.ready();
    return memory.transact(async (base) => {
      const operations: DomainTransactOperation[] = [];
      const tx: StudyRepositoryTransaction = {
        putQuestion: (value) => {
          base.putQuestion(value);
          operations.push(put('question', value));
        },
        putAttempt: (value) => {
          base.putAttempt(value);
          operations.push(put('attempt', value));
        },
        putFeedback: (value) => {
          base.putFeedback(value);
          operations.push(put('feedback', value));
        },
        deleteQuestion: (id) => {
          base.deleteQuestion(id);
          operations.push(del('question', id));
        },
        deleteAttempt: (id) => {
          base.deleteAttempt(id);
          operations.push(del('attempt', id));
        },
        deleteFeedback: (id) => {
          base.deleteFeedback(id);
          operations.push(del('feedback', id));
        },
      };
      const result = await fn(tx);
      await this.store.transact(operations);
      return result;
    });
  }

  async putRecovery(entry: StudyRecoveryEntry): Promise<void> {
    const memory = await this.ready();
    await this.store.transact([put('recovery', entry)]);
    await memory.putRecovery(entry);
  }

  subscribe(listener: StudyQueryListener): () => void {
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

export function createSqliteStudyRepository(
  store: DesktopDomainRecordStore,
): StudyRepository {
  return new SqliteStudyRepository(store);
}
