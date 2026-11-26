import Dexie, { type EntityTable } from 'dexie';
import type {
  Module,
  Lecture,
  SourceDocument,
  SourcePage,
  NoteBlock,
  Annotation,
  Attachment,
  ExportJob,
  SyncOperation,
  LiteratureProject,
  LiteraturePaper,
  LiteratureCustomField,
} from '../types';
import type {
  StudyAttempt,
  StudyFeedback,
  StudyQuestion,
  StudyRecoveryEntry,
} from '../domain/study';
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
} from '../domain/research';
import type {
  DesignSpec,
  Hypothesis,
  MethodDecision,
  Milestone,
  ResearchQuestion,
  ResearchRisk,
  ResearchTask,
} from '../domain/researchDesign';
import type {
  OutputDocument,
  OutputSection,
  OutputStatement,
  StatementSupport,
} from '../domain/output';
import type { StatementCitation } from '../domain/citation';
import type { AiDraftDecision, AiMessage, AiThread } from '../domain/aiThread';
import type {
  CanvasView,
  FreeNode,
  ObjectPlacement,
  CanvasRelation,
  UndoLineage,
} from '../domain/canvas';
import type {
  Collaborator,
  Comment,
  Activity,
  PrivateScratch,
  PublishDiff,
  Conflict,
} from '../domain/collaboration';
import type { CollabOp, CollabOpKind } from './collab-api';

export class StudyKitDB extends Dexie {
  modules!: EntityTable<Module, 'id'>;
  lectures!: EntityTable<Lecture, 'id'>;
  sourceDocuments!: EntityTable<SourceDocument, 'id'>;
  sourcePages!: EntityTable<SourcePage, 'id'>;
  noteBlocks!: EntityTable<NoteBlock, 'id'>;
  annotations!: EntityTable<Annotation, 'id'>;
  attachments!: EntityTable<Attachment, 'id'>;
  exportJobs!: EntityTable<ExportJob, 'id'>;
  syncOperations!: EntityTable<SyncOperation, 'id'>;
  literatureProjects!: EntityTable<LiteratureProject, 'id'>;
  literaturePapers!: EntityTable<LiteraturePaper, 'id'>;
  literatureCustomFields!: EntityTable<LiteratureCustomField, 'id'>;
  // WP-04 Study tables (added at v4, additive only — v1..v3
  // schemas are unchanged on databases that have not yet
  // been migrated). The v0.3 product never reads or writes
  // these; only the `StudyRepository` adapter does.
  studyQuestions!: EntityTable<StudyQuestion, 'id'>;
  studyAttempts!: EntityTable<StudyAttempt, 'id'>;
  studyFeedback!: EntityTable<StudyFeedback, 'id'>;
  studyRecovery!: EntityTable<StudyRecoveryEntry, 'id'>;
  // WP-05 Research tables (added at v5, additive only). The
  // v0.3 product and the v0.4 study surface never read or
  // write these; only the `ResearchRepository` adapter does,
  // and only when the `v04Research` flag is on.
  researchProjects!: EntityTable<ResearchProject, 'id'>;
  researchQuerySpecs!: EntityTable<QuerySpec, 'id'>;
  researchRuns!: EntityTable<SearchRun, 'id'>;
  researchCandidates!: EntityTable<SearchCandidate, 'id'>;
  researchWorks!: EntityTable<Work, 'id'>;
  researchWorkAssets!: EntityTable<WorkAsset, 'id'>;
  researchEvidence!: EntityTable<Evidence, 'id'>;
  researchClaims!: EntityTable<Claim, 'id'>;
  researchLinks!: EntityTable<ClaimEvidenceLink, 'id'>;
  researchConflicts!: EntityTable<WorkConflict, 'id'>;
  // WP-06 Cognitive Canvas tables (added at v6, additive
  // only). The v0.3 product and the v0.4 study/research
  // surfaces never read or write these; only the
  // `CanvasRepository` adapter does, and only when the
  // `v04Canvas` flag is on. The four tables are kept
  // independent so the canvas can ship, be tested in
  // isolation, and be removed in a future cleanup window
  // without affecting anything else.
  canvasViews!: EntityTable<CanvasView, 'id'>;
  canvasFreeNodes!: EntityTable<FreeNode, 'id'>;
  canvasPlacements!: EntityTable<ObjectPlacement, 'id'>;
  canvasRelations!: EntityTable<CanvasRelation, 'id'>;
  canvasUndoLineage!: EntityTable<UndoLineage, 'id'>;
  // WP-07 Research Design + Project Management tables
  // (added at v7, additive only). The v0.3 product and
  // the WP-04 / WP-05 / WP-06 slices never read or write
  // these; only the `ResearchRepository` adapter does.
  // Each table is independent so the slice can ship, be
  // tested in isolation, and be removed in a future
  // cleanup window without affecting anything else.
  researchQuestions!: EntityTable<ResearchQuestion, 'id'>;
  researchHypotheses!: EntityTable<Hypothesis, 'id'>;
  researchDesignSpecs!: EntityTable<DesignSpec, 'id'>;
  researchMethodDecisions!: EntityTable<MethodDecision, 'id'>;
  researchRisks!: EntityTable<ResearchRisk, 'id'>;
  researchMilestones!: EntityTable<Milestone, 'id'>;
  researchTasks!: EntityTable<ResearchTask, 'id'>;
  // WP-08 Collaboration Foundation tables (added at
  // v8, additive only). The v0.3 product and the
  // WP-04 / WP-05 / WP-06 / WP-07 slices never read
  // or write these; only the
  // `CollaborationRepository` adapter does, and
  // only when the `v04Collaboration` flag is on.
  // Each table is independent so the slice can ship,
  // be tested in isolation, and be removed in a
  // future cleanup window without affecting
  // anything else.
  collabCollaborators!: EntityTable<Collaborator, 'id'>;
  collabComments!: EntityTable<Comment, 'id'>;
  collabActivities!: EntityTable<Activity, 'id'>;
  collabScratches!: EntityTable<PrivateScratch, 'id'>;
  collabPublishDiffs!: EntityTable<PublishDiff, 'id'>;
  collabConflicts!: EntityTable<Conflict, 'id'>;
  // WP-08 Round 2: collab outbox (added at v9).
  // Each row is a `CollabOp` we wrote locally but
  // have not yet acked from the server. The drain
  // loop POSTs unsynced rows and marks them
  // `syncedAt`. The inbox apply step is responsible
  // for upserting remote ops to the local tables
  // above.
  collabOutbox!: EntityTable<CollabOutboxRecord, 'id'>;
  // WP-10 Round 1: Evidence-backed Output tables
  // (added at v10, additive only). The v0.3 product
  // and the WP-04 / WP-05 / WP-06 / WP-07 / WP-08
  // slices never read or write these; only the
  // `ResearchRepository` adapter does, and only when
  // the `v04Research` flag is on (Output belongs to
  // the same Research vertical — no new flag).
  researchOutputs!: EntityTable<OutputDocument, 'id'>;
  researchOutputSections!: EntityTable<OutputSection, 'id'>;
  researchOutputStatements!: EntityTable<OutputStatement, 'id'>;
  researchStatementSupports!: EntityTable<StatementSupport, 'id'>;
  researchStatementCitations!: EntityTable<StatementCitation, 'id'>;
  researchAiThreads!: EntityTable<AiThread, 'id'>;
  researchAiMessages!: EntityTable<AiMessage, 'id'>;
  researchAiDraftDecisions!: EntityTable<AiDraftDecision, 'id'>;

  constructor() {
    super('StudyKit');

    this.version(3).stores({
      modules: 'id, workspace_id, title, sort_order',
      lectures: 'id, module_id, title, sort_order, lecture_date',
      sourceDocuments: 'id, lecture_id, processing_status',
      sourcePages: 'id, source_document_id, page_number',
      noteBlocks: 'id, lecture_id, module_id, linked_source_page_id, block_type, sort_order',
      annotations: 'id, lecture_id, source_page_id, annotation_type, deleted_at, [source_page_id+lecture_id]',
      attachments: 'id, workspace_id, module_id, lecture_id',
      exportJobs: 'id, workspace_id, lecture_id, status',
      syncOperations: 'id, workspace_id, device_id, sequence_number, target_table, created_at',
      literatureProjects: 'id, workspace_id',
      literaturePapers: 'id, project_id, workspace_id, processing_status, in_trash',
      literatureCustomFields: 'id, project_id',
    });

    // WP-04 additive migration. The four new tables are
    // declared at v4. Existing v1..v3 databases open
    // unchanged; Dexie performs an in-place upgrade the first
    // time the v4 declaration is seen. The migration is
    // idempotent: re-running `version(4).stores(...)` is a
    // no-op once the schema is at v4.
    this.version(4).stores({
      studyQuestions:
        'id, lectureId, status, review, updatedAt, [lectureId+updatedAt]',
      studyAttempts:
        'id, questionId, updatedAt, [questionId+createdAt]',
      studyFeedback:
        'id, questionId, authorType, updatedAt, [questionId+createdAt]',
      studyRecovery:
        'id, containerId, lectureId, key, updatedAt, [containerId+lectureId+updatedAt]',
    });

    // WP-05 additive migration. The ten new tables are
    // declared at v5. v1..v4 databases open unchanged;
    // Dexie performs an in-place upgrade the first time
    // the v5 declaration is seen. The migration is
    // idempotent: re-running `version(5).stores(...)` is
    // a no-op once the schema is at v5. No existing
    // table is touched.
    this.version(5).stores({
      researchProjects: 'id, [container.id+kind], kind, updatedAt',
      researchQuerySpecs: 'id, projectId, updatedAt, [projectId+updatedAt]',
      researchRuns: 'id, projectId, status, runNumber, [projectId+runNumber]',
      researchCandidates: 'id, runId, projectId, verdict, workId, [runId+verdict]',
      researchWorks: 'id, [projectIds], readingStatus',
      researchWorkAssets: 'id, workId, kind, [workId+kind]',
      researchEvidence: 'id, projectId, workId, status, [projectId+workId], [projectId+status]',
      researchClaims: 'id, projectId, status, [projectId+status]',
      researchLinks: 'id, projectId, claimId, evidenceId, relation, [claimId+relation]',
      researchConflicts: 'id, projectId, candidateWorkId, existingWorkId',
    });

    // WP-06 additive migration. Four new tables for the
    // cognitive canvas (one row per object, primary key
    // is the canvas-internal id). v1..v5 databases open
    // unchanged; Dexie performs an in-place upgrade the
    // first time the v6 declaration is seen. The
    // migration is idempotent: re-running
    // `version(6).stores(...)` is a no-op once the schema
    // is at v6. No existing table is touched.
    //
    // Indexes:
    //   canvasViews      by container.mode+container.kind for
    //                    "list canvas views of this course/project"
    //                    plus updatedAt for "most recent".
    //   canvasFreeNodes  by (viewId, id) so undo can
    //                    stream a view's free nodes in one
    //                    query.
    //   canvasPlacements by (viewId, ref.kind+ref.id) so the
    //                    UI can resolve a placement without
    //                    touching the engine.
    //   canvasRelations  by (viewId, from.refKey,
    //                    to.refKey, status) so the engine
    //                    can stream only the relations it
    //                    needs to render and the use case
    //                    can find a `preview` edge in O(1).
    //   canvasUndoLineage by (viewId, createdAt) for an
    //                    "undo stack per view" replay.
    this.version(6).stores({
      canvasViews: 'id, [container.mode+container.kind+container.id], updatedAt',
      canvasFreeNodes: 'id, viewId, [viewId+id]',
      canvasPlacements:
        'id, viewId, [viewId+ref.kind+ref.id]',
      canvasRelations:
        'id, viewId, status, [viewId+status], [viewId+from.kind+from.id], [viewId+to.kind+to.id]',
      canvasUndoLineage: 'id, viewId, op, [viewId+createdAt]',
    });

    // WP-07 additive migration. Seven new tables for the
    // Research Design + Project Management slice (WP-07).
    // v1..v6 databases open unchanged; Dexie performs an
    // in-place upgrade the first time the v7 declaration is
    // seen. The migration is idempotent: re-running
    // `version(7).stores(...)` is a no-op once the schema is
    // at v7. No existing table is touched.
    //
    // Indexes:
    //   researchQuestions        by (projectId, status) so the
    //                            Project Home "open questions"
    //                            list is one query.
    //   researchHypotheses       by (projectId, questionId)
    //                            for the design workspace's
    //                            "hypotheses for this question".
    //   researchDesignSpecs      by (projectId, questionId)
    //                            for "designs that answer
    //                            question X".
    //   researchMethodDecisions  by (projectId, specId,
    //                            sectionKind, superseded) so
    //                            the head of a decision chain
    //                            and the full history are
    //                            both O(1) reads.
    //   researchRisks            by (projectId, kind, status).
    //   researchMilestones       by (projectId, status,
    //                            targetDate).
    //   researchTasks            by (projectId, status,
    //                            milestoneId) so the Project
    //                            Home "blocked / next / waiting"
    //                            sections are one query.
    this.version(7).stores({
      researchQuestions: 'id, projectId, status, [projectId+status]',
      researchHypotheses: 'id, projectId, questionId, [projectId+questionId]',
      researchDesignSpecs: 'id, projectId, questionId, [projectId+questionId]',
      researchMethodDecisions:
        'id, projectId, specId, sectionKind, superseded, [projectId+specId], [projectId+specId+sectionKind]',
      researchRisks: 'id, projectId, kind, status, [projectId+kind+status]',
      researchMilestones: 'id, projectId, status, [projectId+status]',
      researchTasks:
        'id, projectId, status, milestoneId, [projectId+status], [projectId+milestoneId]',
    });

    // WP-08 additive migration. Six new tables for
    // the Collaboration Foundation slice (WP-08).
    // v1..v7 databases open unchanged; Dexie
    // performs an in-place upgrade the first time
    // the v8 declaration is seen. The migration is
    // idempotent: re-running `version(8).stores(...)`
    // is a no-op once the schema is at v8. No
    // existing table is touched.
    //
    // Indexes:
    //   collabCollaborators  by (projectId, role) and
    //                        (projectId, userId) so the
    //                        "is this user a member?"
    //                        check is one query.
    //   collabComments       by (projectId, targetKind,
    //                        targetId) so the comment
    //                        thread is one query; by
    //                        (projectId, authorId) for
    //                        "my comments"; and by
    //                        threadId so replies group
    //                        cheaply.
    //   collabActivities     by (projectId, createdAt)
    //                        for the project feed; by
    //                        (projectId, kind) for
    //                        filter by event type.
    //   collabScratches      by (projectId, ownerId,
    //                        status) so the private
    //                        scratch list is one
    //                        query.
    //   collabPublishDiffs   by (projectId, scratchId)
    //                        and (projectId,
    //                        confirmedAt, cancelledAt)
    //                        for the "open previews"
    //                        view.
    //   collabConflicts      by (projectId, kind,
    //                        objectId) and by resolution
    //                        so the "open conflicts"
    //                        banner is one query.
    this.version(8).stores({
      collabCollaborators: 'id, projectId, role, userId, [projectId+role], [projectId+userId]',
      collabComments:
        'id, projectId, targetKind, targetId, authorId, threadId, resolvedAt, [projectId+targetKind+targetId], [projectId+authorId], [projectId+threadId]',
      collabActivities:
        'id, projectId, kind, actorId, targetKind, targetId, createdAt, ephemeral, [projectId+createdAt], [projectId+kind]',
      collabScratches:
        'id, projectId, ownerId, kind, status, [projectId+ownerId], [projectId+ownerId+status]',
      collabPublishDiffs:
        'id, projectId, scratchId, confirmedAt, cancelledAt, [projectId+scratchId]',
      collabConflicts:
        'id, projectId, kind, objectId, resolution, [projectId+kind+objectId], [projectId+resolution]',
    });

    // WP-08 Round 2 additive migration. The outbox is
    // the durable record of "what we wrote but have not
    // yet acked" — every successful use case write
    // appends a `CollabOp` here, and the drain loop
    // POSTs unsynced ops to the gateway. The `v9` step
    // is purely additive; v1..v8 databases open
    // unchanged.
    //
    // Indexes:
    //   collabOutbox  by (projectId, syncedAt) so the
    //                 drain loop is one query.
    //                 by (clientId, createdAt) for
    //                 debugging; by op id (primary key)
    //                 for the idempotent dedupe.
    this.version(9).stores({
      collabOutbox:
        'id, projectId, clientId, kind, syncedAt, createdAt, [projectId+syncedAt], [clientId+createdAt]',
    });

    // WP-10 Round 1 additive migration. Four new
    // tables for the Evidence-backed Output slice. The
    // `v10` step is purely additive; v1..v9 databases
    // open unchanged. No existing table is touched.
    //
    // Indexes:
    //   researchOutputs           by (projectId, status)
    //                             for the Project Home
    //                             "Outputs" list and the
    //                             `final` filter used by
    //                             `completeTask`. By
    //                             `updatedAt` for
    //                             "most-recent" sorts.
    //   researchOutputSections    by (outputId, order)
    //                             so the workspace can
    //                             stream sections in the
    //                             stable order in a single
    //                             query.
    //   researchOutputStatements  by (outputId, sectionId,
    //                             order) so the workspace
    //                             can render one section's
    //                             body in stable order,
    //                             and by (projectId,
    //                             status) for any future
    //                             "statements across
    //                             outputs" view.
    //   researchStatementSupports by (statementId,
    //                             relation) for the
    //                             audit's per-statement
    //                             lookup; by
    //                             (projectId, statementId)
    //                             for the
    //                             audit-by-output view.
    this.version(10).stores({
      researchOutputs:
        'id, projectId, status, updatedAt, [projectId+status], [projectId+updatedAt]',
      researchOutputSections:
        'id, projectId, outputId, order, [outputId+order], [projectId+order]',
      researchOutputStatements:
        'id, projectId, outputId, sectionId, status, order, [outputId+sectionId+order], [projectId+status]',
      researchStatementSupports:
        'id, projectId, outputId, statementId, [statementId+relation], [projectId+statementId]',
    });

    // WP-10 Round 2: a citation is a typed link from an
    // Output Statement to an existing canonical Work.
    // Bibliographic metadata remains on Work; this table
    // never duplicates or invents citation text.
    this.version(11).stores({
      researchStatementCitations:
        'id, projectId, outputId, statementId, workId, citeKey, [statementId+workId], [outputId+statementId]',
    });

    // v0.5 P4: project AI threads (ADR-003 §4). Messages and draft
    // decisions are append-only; both are read per thread.
    this.version(12).stores({
      researchAiThreads: 'id, projectId, updatedAt, [projectId+updatedAt]',
      researchAiMessages: 'id, projectId, threadId, createdAt, [threadId+createdAt]',
      researchAiDraftDecisions: 'id, projectId, threadId, messageId, draftId',
    });

    // Defensive: Dexie `EntityTable<FreeNode, 'id'>` typing
    // requires a single-string primary key. The `id` field
    // is already the primary key on the FreeNode interface,
    // so we don't add anything here. (The annotation lives
    // here so the v6 declaration above is self-documenting.)
  }
}

export const db = new StudyKitDB();

/**
 * The Dexie row for the collab outbox. The shape
 * carries everything a `CollabOp` needs to be
 * resent (the op id is the primary key) plus the
 * drain metadata (`attempts`, `lastError`,
 * `syncedAt`).
 *
 * The inbox apply step is responsible for filtering
 * self-writes (ops with `clientId === self`) so
 * a client never re-applies its own push.
 */
export interface CollabOutboxRecord {
  readonly id: string;
  readonly clientId: string;
  readonly projectId: string;
  readonly kind: CollabOpKind;
  readonly payload: string;
  readonly baseVersion?: number | string;
  readonly createdAt: string;
  /** Number of drain attempts that have failed
   *  for this op. The next drain uses this to
   *  decide whether to retry; the future production
   *  server will surface persistent failures in
   *  the UI. */
  readonly attempts: number;
  /** Last error message from a failed push. */
   readonly lastError: string | null;
  /** ISO timestamp of the most recent successful
   *  server ack. `null` while the op is still
   *  in-flight. */
  readonly syncedAt: string | null;
}

/**
 * Convert an outbox row to a `CollabOp` for
 * transport. Pure helper.
 */
export function outboxToOp(record: CollabOutboxRecord): CollabOp {
  return {
    id: record.id,
    clientId: record.clientId,
    projectId: record.projectId,
    kind: record.kind,
    payload: record.payload,
    ...(record.baseVersion !== undefined ? { baseVersion: record.baseVersion } : {}),
    createdAt: record.createdAt,
  };
}
