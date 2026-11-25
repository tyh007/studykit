/**
 * StudyKit v0.4 — `platforms/web/canvasPaperLookup`
 *
 * Tiny helper that reads `literaturePapers` from the
 * v0.3 Dexie schema and projects the rows onto the
 * `LiteraturePaper` type the cognitive canvas's shim
 * expects.
 *
 * Lives in `platforms/web/` because the only thing it
 * does is talk to `lib/db.ts`. The shim holds a
 * `(projectId) => LiteraturePaper[]` callback, so
 * tests can substitute an in-memory fixture.
 */

import type { Table } from 'dexie';

import { db } from '../../lib/db';
import type { LiteraturePaper } from '../../types';

interface PaperRow {
  id: string;
  project_id: string | null;
  title: string;
  in_trash: number;
  processing_status: string;
  created_at: string;
  updated_at: string;
  workspace_id: string;
}

function readTable(): Table<PaperRow, string> {
  return (db as unknown as { literaturePapers: Table<PaperRow, string> }).literaturePapers;
}

function toLiteraturePaper(row: PaperRow): LiteraturePaper {
  return {
    id: row.id,
    project_id: row.project_id ?? '',
    workspace_id: row.workspace_id,
    file_name: '',
    file_size: 0,
    file_type: '',
    uploaded_at: row.created_at,
    title: row.title,
    reading_status: 'unread',
    importance: 0,
    processing_status: (row.processing_status === 'ready' ? 'completed' : row.processing_status) as LiteraturePaper['processing_status'],
    in_trash: row.in_trash === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listCanvasPapers(projectId: string): Promise<readonly LiteraturePaper[]> {
  const all = await readTable().toArray();
  return all.filter((p) => (p.project_id ?? '') === projectId).map(toLiteraturePaper);
}

export async function getCanvasPaper(id: string): Promise<LiteraturePaper | null> {
  const row = await readTable().get(id);
  return row ? toLiteraturePaper(row) : null;
}
