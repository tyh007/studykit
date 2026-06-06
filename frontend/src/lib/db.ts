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
  }
}

export const db = new StudyKitDB();
