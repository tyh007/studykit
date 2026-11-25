import {
  WorkspaceIpcError,
  type DomainRecordRow,
  type DomainTransactOperation,
  type WorkspaceClient,
} from './workspaceClient';

export type DomainNamespace = 'study' | 'research' | 'canvas' | 'legacy';

export interface DecodedDomainRecord {
  readonly entityType: string;
  readonly id: string;
  readonly value: Record<string, unknown>;
}

function fail(message: string): never {
  throw new WorkspaceIpcError({
    kind: 'STUDYKIT_VALIDATION_FAILED',
    message,
  });
}

function objectId(value: Record<string, unknown>): string {
  return typeof value.id === 'string' && value.id.length > 0
    ? value.id
    : fail('domain record payload must contain a non-empty id');
}

function timestamp(value: Record<string, unknown>): string {
  const candidate =
    typeof value.updatedAt === 'string'
      ? value.updatedAt
      : typeof value.createdAt === 'string'
        ? value.createdAt
        : new Date().toISOString();
  return Number.isNaN(Date.parse(candidate))
    ? fail('domain record requires a valid updatedAt or createdAt')
    : candidate;
}

export function decodeDomainRow(
  expectedNamespace: DomainNamespace,
  row: DomainRecordRow,
): DecodedDomainRecord {
  if (row.namespace !== expectedNamespace) {
    fail(`domain namespace mismatch: expected ${expectedNamespace}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(row.payload);
  } catch {
    fail(`domain record ${row.entity_type}/${row.id} contains invalid JSON`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`domain record ${row.entity_type}/${row.id} is not an object`);
  }
  const record = value as Record<string, unknown>;
  if (objectId(record) !== row.id) {
    fail(`domain record ${row.entity_type}/${row.id} payload id mismatch`);
  }
  return { entityType: row.entity_type, id: row.id, value: record };
}

export function putDomainRecord(
  namespace: DomainNamespace,
  entityType: string,
  value: Record<string, unknown>,
): DomainTransactOperation {
  const id = objectId(value);
  return {
    op: 'put',
    row: {
      namespace,
      entity_type: entityType,
      id,
      payload: JSON.stringify(value),
      updated_at: timestamp(value),
    },
  };
}

export function deleteDomainRecord(
  namespace: DomainNamespace,
  entityType: string,
  id: string,
): DomainTransactOperation {
  if (!id) fail('domain record delete requires a non-empty id');
  return { op: 'delete', namespace, entity_type: entityType, id };
}

export class DesktopDomainRecordStore {
  constructor(private readonly client: WorkspaceClient) {}

  async read(namespace: DomainNamespace): Promise<DecodedDomainRecord[]> {
    const rows = await this.client.readDomainRecords(namespace);
    return rows.map((row) => decodeDomainRow(namespace, row));
  }

  async transact(operations: readonly DomainTransactOperation[]): Promise<void> {
    if (operations.length === 0) return;
    await this.client.transactDomainRecords({ operations });
  }
}
