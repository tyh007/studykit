import type {
  CanvasRelation,
  CanvasView,
  FreeNode,
  ObjectPlacement,
  UndoLineage,
} from '../../domain/canvas';
import type { ContainerRef } from '../../domain/workspace';
import type {
  CanvasListener,
  CanvasRepository,
  CanvasTransaction,
} from '../../repositories/canvas';
import { MemoryCanvasRepository } from '../../repositories/memoryCanvasRepository';
import {
  deleteDomainRecord,
  DesktopDomainRecordStore,
  putDomainRecord,
} from './domainRecordStore';
import type { DomainTransactOperation } from './workspaceClient';

type CanvasEntity =
  | 'view'
  | 'free_node'
  | 'placement'
  | 'relation'
  | 'lineage';

function put(entityType: CanvasEntity, value: object): DomainTransactOperation {
  return putDomainRecord(
    'canvas',
    entityType,
    value as Record<string, unknown>,
  );
}

function del(entityType: CanvasEntity, id: string): DomainTransactOperation {
  return deleteDomainRecord('canvas', entityType, id);
}

export class SqliteCanvasRepository implements CanvasRepository {
  private memory: MemoryCanvasRepository | null = null;
  private loading: Promise<MemoryCanvasRepository> | null = null;

  constructor(private readonly store: DesktopDomainRecordStore) {}

  private async ready(): Promise<MemoryCanvasRepository> {
    if (this.memory) return this.memory;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const rows = await this.store.read('canvas');
      const memory = new MemoryCanvasRepository();
      await memory.transact((tx) => {
        for (const row of rows) {
          switch (row.entityType as CanvasEntity) {
            case 'view':
              tx.putView(row.value as unknown as CanvasView);
              break;
            case 'free_node':
              tx.putFreeNode(row.value as unknown as FreeNode);
              break;
            case 'placement':
              tx.putPlacement(row.value as unknown as ObjectPlacement);
              break;
            case 'relation':
              tx.putRelation(row.value as unknown as CanvasRelation);
              break;
            case 'lineage':
              tx.appendLineage(row.value as unknown as UndoLineage);
              break;
            default:
              throw new Error(`Unsupported Canvas entity type: ${row.entityType}`);
          }
        }
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

  async getView(viewId: string) {
    return (await this.ready()).getView(viewId);
  }

  async listViewsForContainer(container: ContainerRef) {
    return (await this.ready()).listViewsForContainer(container);
  }

  async getViewSnapshot(viewId: string) {
    return (await this.ready()).getViewSnapshot(viewId);
  }

  async listLineage(viewId: string, limit?: number) {
    return (await this.ready()).listLineage(viewId, limit);
  }

  async transact<T>(
    fn: (tx: CanvasTransaction) => T | Promise<T>,
  ): Promise<T> {
    const memory = await this.ready();
    return memory.transact(async (base) => {
      const operations: DomainTransactOperation[] = [];
      const tx: CanvasTransaction = {
        putView: (value) => {
          base.putView(value);
          operations.push(put('view', value));
        },
        putFreeNode: (value) => {
          base.putFreeNode(value);
          operations.push(put('free_node', value));
        },
        deleteFreeNode: (id) => {
          base.deleteFreeNode(id);
          operations.push(del('free_node', id));
        },
        putPlacement: (value) => {
          base.putPlacement(value);
          operations.push(put('placement', value));
        },
        deletePlacement: (id) => {
          base.deletePlacement(id);
          operations.push(del('placement', id));
        },
        putRelation: (value) => {
          base.putRelation(value);
          operations.push(put('relation', value));
        },
        deleteRelation: (id) => {
          base.deleteRelation(id);
          operations.push(del('relation', id));
        },
        appendLineage: (value) => {
          base.appendLineage(value);
          operations.push(put('lineage', value));
        },
        popLineage: (viewId) => {
          const line = base.popLineage(viewId);
          if (line) operations.push(del('lineage', line.id));
          return line;
        },
      };
      const result = await fn(tx);
      await this.store.transact(operations);
      return result;
    });
  }

  subscribeView(viewId: string, listener: CanvasListener): () => void {
    let active = true;
    let unsubscribe = () => {};
    void this.ready().then((memory) => {
      if (active) unsubscribe = memory.subscribeView(viewId, listener);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }
}

export function createSqliteCanvasRepository(
  store: DesktopDomainRecordStore,
): CanvasRepository {
  return new SqliteCanvasRepository(store);
}
