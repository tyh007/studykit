import { db } from '../../lib/db';
import type { DomainRecordRow, MigrationSummary, WorkspaceClient } from './workspaceClient';

const TABLE_MAP = {
  modules: ['legacy', 'module'],
  lectures: ['legacy', 'lecture'],
  literatureProjects: ['legacy', 'literature_project'],
  literaturePapers: ['legacy', 'literature_paper'],
  studyQuestions: ['study', 'question'],
  studyAttempts: ['study', 'attempt'],
  studyFeedback: ['study', 'feedback'],
  studyRecovery: ['study', 'recovery'],
  researchProjects: ['research', 'project'],
  researchQuerySpecs: ['research', 'query_spec'],
  researchRuns: ['research', 'run'],
  researchCandidates: ['research', 'candidate'],
  researchWorks: ['research', 'work'],
  researchWorkAssets: ['research', 'work_asset'],
  researchEvidence: ['research', 'evidence'],
  researchClaims: ['research', 'claim'],
  researchLinks: ['research', 'link'],
  researchConflicts: ['research', 'conflict'],
  researchQuestions: ['research', 'question'],
  researchHypotheses: ['research', 'hypothesis'],
  researchDesignSpecs: ['research', 'design_spec'],
  researchMethodDecisions: ['research', 'method_decision'],
  researchRisks: ['research', 'risk'],
  researchMilestones: ['research', 'milestone'],
  researchTasks: ['research', 'task'],
  canvasViews: ['canvas', 'view'],
  canvasFreeNodes: ['canvas', 'free_node'],
  canvasPlacements: ['canvas', 'placement'],
  canvasRelations: ['canvas', 'relation'],
  canvasUndoLineage: ['canvas', 'lineage'],
} as const;

export interface LegacyMigrationPreview {
  readonly count: number;
  readonly tableCounts: Readonly<Record<string, number>>;
}

interface PreparedMigration extends LegacyMigrationPreview {
  readonly snapshotJson: string;
  readonly sourceHash: string;
  readonly records: readonly DomainRecordRow[];
}

function timestamp(row: Record<string, unknown>): string {
  for (const key of ['updatedAt', 'createdAt', 'updated_at', 'created_at']) {
    const value = row[key];
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  }
  return new Date(0).toISOString();
}

async function prepare(): Promise<PreparedMigration> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const records: DomainRecordRow[] = [];
  const tableCounts: Record<string, number> = {};
  for (const [tableName, [namespace, entityType]] of Object.entries(TABLE_MAP)) {
    const table = db.table<Record<string, unknown>, string>(tableName);
    const rows = (await table.toArray())
      .filter((row) => typeof row.id === 'string' && row.id.length > 0)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (rows.length === 0) continue;
    tables[tableName] = rows;
    tableCounts[tableName] = rows.length;
    for (const row of rows) {
      records.push({
        namespace,
        entity_type: entityType,
        id: String(row.id),
        payload: JSON.stringify(row),
        updated_at: timestamp(row),
      });
    }
  }
  const snapshotJson = JSON.stringify({
    schema: 'studykit.dexie-migration/1',
    tables,
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(snapshotJson),
  );
  const sourceHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return {
    count: records.length,
    tableCounts,
    snapshotJson,
    sourceHash,
    records,
  };
}

export async function inspectLegacyData(): Promise<LegacyMigrationPreview> {
  const { count, tableCounts } = await prepare();
  return { count, tableCounts };
}

export async function migrateLegacyData(
  client: WorkspaceClient,
): Promise<MigrationSummary> {
  if (!client.importLegacySnapshot) {
    throw new Error('This desktop build does not support legacy migration.');
  }
  const prepared = await prepare();
  if (prepared.count === 0) throw new Error('No browser-era data was found.');
  return client.importLegacySnapshot(
    crypto.randomUUID(),
    prepared.snapshotJson,
    prepared.sourceHash,
    prepared.records,
  );
}
