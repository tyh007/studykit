import { describe, expect, it } from 'vitest';
import type { UndoLineage } from '../domain/canvas';
import { MemoryCanvasRepository } from './memoryCanvasRepository';

const line: UndoLineage = {
  id: 'line-1',
  viewId: 'view-1',
  op: 'set-view-mode',
  previous: 'spatial',
  next: 'outline',
  linked: null,
  createdAt: '2026-07-30T00:00:00.000Z',
};

describe('MemoryCanvasRepository transaction atomicity', () => {
  it('rolls back staged lineage when the callback throws', async () => {
    const repository = new MemoryCanvasRepository();
    await expect(
      repository.transact((tx) => {
        tx.appendLineage(line);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await repository.listLineage('view-1')).toEqual([]);
  });

  it('stages append and pop in order inside one transaction', async () => {
    const repository = new MemoryCanvasRepository();
    await repository.transact((tx) => {
      tx.appendLineage(line);
      expect(tx.popLineage('view-1')).toEqual(line);
    });
    expect(await repository.listLineage('view-1')).toEqual([]);
  });
});
