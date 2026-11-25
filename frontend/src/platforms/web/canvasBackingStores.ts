/**
 * StudyKit v0.4 — `platforms/web/canvasBackingStores`
 *
 * The *production* backing-store adapters the cognitive
 * canvas's `ShimStudyKitRepository` writes through for
 * the `note` and `source` kinds.
 *
 * Why these live in `platforms/web/` and not
 * `application/`: they talk to the v0.3 `lib/db.ts`
 * Dexie schema directly. The shim holds an interface
 * to them, so tests can substitute in-memory fakes.
 *
 * The `note` path uses the v0.3 `noteBlocks` table.
 * The cognitive canvas writes a *single* `note` row
 * with `block_type = 'free'` and the upgrade's body
 * as the `content`. The original v0.3 lecture-anchored
 * notes are untouched; the cognitive-canvas `note`
 * lives in a *new* `lecture_id = null` row, which the
 * v0.3 schema accepts.
 *
 * The `source` path uses the v0.3 `literaturePapers`
 * table. `upsertTitle` creates a new paper row with a
 * `title`; `moveToTrash` flips `in_trash = 1`.
 */

import type { Table } from 'dexie';

import { db } from '../../lib/db';
import type { NotesBackingStore, SourcesBackingStore } from '../../app/canvas/canvasWiring';

// ---------------------------------------------------------------------------
// Notes (noteBlocks)
// ---------------------------------------------------------------------------

interface NoteBlockRow {
  id: string;
  lecture_id: string | null;
  module_id: string | null;
  block_type: string;
  content: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  workspace_id: string;
}

class DexieNotesBackingStore implements NotesBackingStore {
  private table(): Table<NoteBlockRow, string> {
    return (db as unknown as { noteBlocks: Table<NoteBlockRow, string> }).noteBlocks;
  }

  async upsert(input: { id: string; body: string; authorType: 'user' | 'ai' | 'imported' }): Promise<{ id: string }> {
    const now = new Date().toISOString();
    const existing = await this.table().get(input.id);
    const row: NoteBlockRow = {
      id: input.id,
      lecture_id: null,
      module_id: null,
      block_type: 'free',
      content: input.body,
      sort_order: existing?.sort_order ?? Math.floor(Date.now() / 1000),
      created_at: existing?.created_at ?? now,
      updated_at: now,
      workspace_id: 'local',
    };
    await this.table().put(row);
    return { id: input.id };
  }

  async archive(id: string): Promise<void> {
    const existing = await this.table().get(id);
    if (!existing) return;
    // We "archive" by writing an empty content row
    // rather than deleting — the v0.3 schema does not
    // expose a `delete` for noteBlocks through the
    // public dataApi, and an empty body keeps the
    // row's history intact.
    await this.table().put({ ...existing, content: '', updated_at: new Date().toISOString() });
  }
}

// ---------------------------------------------------------------------------
// Sources (literaturePapers)
// ---------------------------------------------------------------------------

interface PaperRow {
  id: string;
  project_id: string | null;
  title: string;
  in_trash: number;
  processing_status: 'pending' | 'processing' | 'ready' | 'error';
  created_at: string;
  updated_at: string;
  workspace_id: string;
}

class DexieSourcesBackingStore implements SourcesBackingStore {
  private table(): Table<PaperRow, string> {
    return (db as unknown as { literaturePapers: Table<PaperRow, string> }).literaturePapers;
  }

  async upsertTitle(input: { id: string; title: string }): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.table().get(input.id);
    const row: PaperRow = {
      id: input.id,
      project_id: existing?.project_id ?? null,
      title: input.title,
      in_trash: existing?.in_trash ?? 0,
      processing_status: existing?.processing_status ?? 'ready',
      created_at: existing?.created_at ?? now,
      updated_at: now,
      workspace_id: 'local',
    };
    await this.table().put(row);
  }

  async moveToTrash(id: string): Promise<void> {
    const existing = await this.table().get(id);
    if (!existing) return;
    await this.table().put({ ...existing, in_trash: 1, updated_at: new Date().toISOString() });
  }
}

// ---------------------------------------------------------------------------
// Lazy singletons
// ---------------------------------------------------------------------------

let notesSingleton: NotesBackingStore | null = null;
let sourcesSingleton: SourcesBackingStore | null = null;

export function getCanvasNotesBackingStore(): NotesBackingStore {
  if (!notesSingleton) notesSingleton = new DexieNotesBackingStore();
  return notesSingleton;
}

export function getCanvasSourcesBackingStore(): SourcesBackingStore {
  if (!sourcesSingleton) sourcesSingleton = new DexieSourcesBackingStore();
  return sourcesSingleton;
}

/** @internal */
export function __resetCanvasBackingStoresForTests(): void {
  notesSingleton = null;
  sourcesSingleton = null;
}
