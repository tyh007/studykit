import { describe, expect, it } from 'vitest';

import {
  KNOWLEDGE_OBJECT_KINDS,
  MemoryRepository,
  isKnowledgeObjectKind,
  isObjectQuery,
  type KnowledgeObject,
} from './repository';
import {
  FIXED_TS,
  makeContainerRef,
  makeKnowledgeObject,
  makeProjectContainer,
} from './__fixtures__/domain-fixtures';

/**
 * WP-00 contract test suite for `StudyKitRepository`.
 *
 * These tests run against `MemoryRepository` (in-memory) today. The same
 * test scenarios MUST be runnable against the future Dexie adapter and
 * the future Tauri+SQLite adapter without modification — that is the
 * point of the contract (ADR-004 + system design §5.1).
 */

function makeObject(overrides: Partial<KnowledgeObject> = {}): KnowledgeObject {
  return makeKnowledgeObject(overrides);
}

describe('repository contract', () => {
  describe('kind / query type guards', () => {
    it('exposes the eight knowledge object kinds from PRD §4.3', () => {
      expect([...KNOWLEDGE_OBJECT_KINDS].sort()).toEqual([
        'claim',
        'concept',
        'evidence',
        'note',
        'output',
        'question',
        'source',
        'task',
      ]);
    });

    it('isKnowledgeObjectKind accepts only declared kinds', () => {
      for (const kind of KNOWLEDGE_OBJECT_KINDS) {
        expect(isKnowledgeObjectKind(kind)).toBe(true);
      }
      expect(isKnowledgeObjectKind('module')).toBe(false);
      expect(isKnowledgeObjectKind(null)).toBe(false);
    });

    it('isObjectQuery accepts every well-formed query', () => {
      expect(isObjectQuery({})).toBe(true);
      expect(isObjectQuery({ kind: 'note' })).toBe(true);
      expect(isObjectQuery({ kind: 'note', text: 'foo', limit: 10, offset: 0 })).toBe(true);
      expect(isObjectQuery({ state: 'archived' })).toBe(true);
      expect(isObjectQuery({ containerId: 'c-1' })).toBe(true);
    });

    it('isObjectQuery rejects malformed queries', () => {
      expect(isObjectQuery(null)).toBe(false);
      expect(isObjectQuery({ kind: 'mystery' })).toBe(false);
      expect(isObjectQuery({ limit: -1 })).toBe(false);
      expect(isObjectQuery({ offset: -5 })).toBe(false);
      expect(isObjectQuery({ state: 'vanished' })).toBe(false);
      expect(isObjectQuery({ containerId: 1 })).toBe(false);
    });
  });

  describe('MemoryRepository: read paths', () => {
    it('getObject returns null for unknown ids', async () => {
      const repo = new MemoryRepository();
      expect(await repo.getObject('missing')).toBeNull();
    });

    it('getObject returns the stored object after a put', async () => {
      const repo = new MemoryRepository();
      const obj = makeObject();
      await repo.transact(async (tx) => {
        tx.put(obj);
      });
      const got = await repo.getObject(obj.id);
      expect(got).toEqual(obj);
    });

    it('queryObjects filters by kind, container, and text; default state is "active"', async () => {
      const repo = new MemoryRepository();
      const course = makeContainerRef({ id: 'c-1' });
      const project = makeProjectContainer();
      await repo.transact(async (tx) => {
        tx.put(makeObject({ id: 'a', kind: 'note', body: 'alpha bravo', container: course }));
        tx.put(makeObject({ id: 'b', kind: 'note', body: 'charlie delta', container: course }));
        tx.put(makeObject({ id: 'c', kind: 'claim', body: 'echo foxtrot', container: project }));
        tx.put(
          makeObject({
            id: 'd',
            kind: 'note',
            body: 'golf hotel',
            container: course,
            state: 'archived',
          }),
        );
      });

      // Default state filter is "active" — `d` (archived) is hidden unless asked.
      const allNotes = await repo.queryObjects({ kind: 'note' });
      expect(allNotes.map((o) => o.id).sort()).toEqual(['a', 'b']);

      const inCourse = await repo.queryObjects({ containerId: 'c-1' });
      expect(inCourse.map((o) => o.id).sort()).toEqual(['a', 'b']);

      const onlyActive = await repo.queryObjects({ containerId: 'c-1', state: 'active' });
      expect(onlyActive.map((o) => o.id).sort()).toEqual(['a', 'b']);

      const archived = await repo.queryObjects({ state: 'archived' });
      expect(archived.map((o) => o.id)).toEqual(['d']);

      const matchingText = await repo.queryObjects({ text: 'BRAVO' });
      expect(matchingText.map((o) => o.id)).toEqual(['a']);
    });

    it('queryObjects supports limit and offset in stable order', async () => {
      const repo = new MemoryRepository();
      await repo.transact(async (tx) => {
        for (const id of ['c', 'a', 'b', 'e', 'd']) {
          tx.put(makeObject({ id }));
        }
      });
      const page = await repo.queryObjects({ limit: 2, offset: 1 });
      expect(page.map((o) => o.id)).toEqual(['b', 'c']);
    });
  });

  describe('MemoryRepository: write paths', () => {
    it('transact applies puts and deletes atomically', async () => {
      const repo = new MemoryRepository();
      await repo.transact(async (tx) => {
        tx.put(makeObject({ id: 'x' }));
        tx.put(makeObject({ id: 'y' }));
        tx.put(makeObject({ id: 'z' }));
      });
      expect((await repo.queryObjects({})).length).toBe(3);

      await repo.transact(async (tx) => {
        tx.delete('x');
        tx.put(makeObject({ id: 'y', body: 'updated' }));
      });

      const all = await repo.queryObjects({});
      expect(all.length).toBe(2);
      const y = all.find((o) => o.id === 'y');
      expect(y?.body).toBe('updated');
      expect(await repo.getObject('x')).toBeNull();
    });

    it('transact is atomic when the callback throws', async () => {
      const repo = new MemoryRepository();
      await repo.transact(async (tx) => {
        tx.put(makeObject({ id: 'a' }));
        throw new Error('boom');
      }).catch(() => undefined);
      // `a` must NOT have been written because the transaction aborted.
      expect(await repo.getObject('a')).toBeNull();
    });
  });

  describe('MemoryRepository: subscribe', () => {
    it('notifies listeners after a successful transact', async () => {
      const repo = new MemoryRepository();
      const calls: string[][] = [];
      const unsubscribe = repo.subscribe({ kind: 'note' }, (notes) => {
        calls.push(notes.map((n) => n.id));
      });

      await repo.transact(async (tx) => {
        tx.put(makeObject({ id: 'n1', kind: 'note' }));
      });
      await repo.transact(async (tx) => {
        tx.put(makeObject({ id: 'n2', kind: 'note' }));
      });
      unsubscribe();
      await repo.transact(async (tx) => {
        tx.put(makeObject({ id: 'n3', kind: 'note' }));
      });

      // The listener may receive one notification per transact (or per
      // object in the batch, depending on the adapter). MemoryRepository
      // fires once per transact. The key invariants:
      //  - we see at least n1 and n2;
      //  - we never see n3 (we unsubscribed first).
      const allIds = calls.flat();
      expect(allIds).toContain('n1');
      expect(allIds).toContain('n2');
      expect(allIds).not.toContain('n3');
    });

    it('only delivers matching kinds to a kind-filtered subscription', async () => {
      const repo = new MemoryRepository();
      const notes: string[] = [];
      repo.subscribe({ kind: 'note' }, (items) => {
        notes.push(...items.map((i) => i.id));
      });
      await repo.transact(async (tx) => {
        tx.put(makeObject({ id: 'only-note' }));
        tx.put(makeObject({ id: 'a-claim', kind: 'claim' }));
      });
      expect(notes).toContain('only-note');
      expect(notes).not.toContain('a-claim');
    });
  });

  describe('MemoryRepository: exportSnapshot', () => {
    it('exports a stable JSON snapshot with sorted ids', async () => {
      const repo = new MemoryRepository();
      await repo.transact(async (tx) => {
        tx.put(makeObject({ id: 'c' }));
        tx.put(makeObject({ id: 'a' }));
        tx.put(makeObject({ id: 'b' }));
      });
      const artifact = await repo.exportSnapshot({ scope: 'workspace', format: 'json' });
      expect(artifact.schemaVersion).toBe(1);
      expect(artifact.format).toBe('json');
      expect(artifact.objectIds).toEqual(['a', 'b', 'c']);
      // Payload is a JSON string of { objects: [...] }.
      const parsed = JSON.parse(artifact.payload);
      expect(Array.isArray(parsed.objects)).toBe(true);
      expect(parsed.objects.length).toBe(3);
    });

    it('respects scope=container', async () => {
      const repo = new MemoryRepository();
      const course = makeContainerRef({ id: 'c-1' });
      const project = makeProjectContainer();
      await repo.transact(async (tx) => {
        tx.put(makeObject({ id: 'n1', container: course }));
        tx.put(makeObject({ id: 'n2', container: course }));
        tx.put(makeObject({ id: 'p1', container: project }));
      });
      const artifact = await repo.exportSnapshot({
        scope: 'container',
        containerId: 'c-1',
      });
      expect([...artifact.objectIds].sort()).toEqual(['n1', 'n2']);
    });

    it('respects scope=selection with objectIds', async () => {
      const repo = new MemoryRepository();
      await repo.transact(async (tx) => {
        tx.put(makeObject({ id: 'a' }));
        tx.put(makeObject({ id: 'b' }));
        tx.put(makeObject({ id: 'c' }));
      });
      const artifact = await repo.exportSnapshot({
        scope: 'selection',
        objectIds: ['c', 'a'],
      });
      expect(artifact.objectIds).toEqual(['c', 'a']);
    });

    it('throws on scope=container without a containerId (no silent workspace fallback)', async () => {
      const repo = new MemoryRepository();
      await repo.transact(async (tx) => {
        tx.put(makeObject({ id: 'should-not-leak' }));
      });
      await expect(repo.exportSnapshot({ scope: 'container' })).rejects.toThrow(
        /scope="container" requires a non-empty containerId/,
      );
      // An empty string is just as bad as missing.
      await expect(
        repo.exportSnapshot({ scope: 'container', containerId: '' }),
      ).rejects.toThrow(/scope="container"/);
    });

    it('throws on scope=selection without objectIds (no silent workspace fallback)', async () => {
      const repo = new MemoryRepository();
      await repo.transact(async (tx) => {
        tx.put(makeObject({ id: 'should-not-leak' }));
      });
      await expect(repo.exportSnapshot({ scope: 'selection' })).rejects.toThrow(
        /scope="selection" requires non-empty objectIds/,
      );
      await expect(
        repo.exportSnapshot({ scope: 'selection', objectIds: [] }),
      ).rejects.toThrow(/scope="selection"/);
    });

    it('throws on scope=container even when no objects exist (defensive)', async () => {
      // Empty repo — the guard must trip on the missing parameter,
      // not be short-circuited by an empty result.
      const repo = new MemoryRepository();
      await expect(repo.exportSnapshot({ scope: 'container' })).rejects.toThrow();
    });
  });

  describe('round-trip with fixtures', () => {
    it('a knowledge object survives JSON round-trip', () => {
      const original = makeObject({ body: 'mixed "quotes" and \n newlines' });
      const restored: KnowledgeObject = JSON.parse(JSON.stringify(original));
      expect(restored).toEqual(original);
    });

    it('the fixed timestamp stays ISO-8601', () => {
      const obj = makeObject();
      expect(obj.createdAt).toBe(FIXED_TS);
      // Should not lose precision when parsed back.
      expect(new Date(JSON.parse(JSON.stringify(obj)).createdAt).toISOString()).toBe(FIXED_TS);
    });
  });
});
