// ===== Core data types matching PRD schema =====

export interface User {
  id: string;
  email: string;
  display_name?: string;
  created_at: string;
}

export interface Workspace {
  id: string;
  owner_user_id: string;
  name: string;
  settings_json: WorkspaceSettings;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceSettings {
  theme: 'system' | 'light' | 'dark';
  default_cornell_mode: boolean;
  default_export_template: string;
}

export interface Module {
  id: string;
  workspace_id: string;
  title: string;
  code?: string;
  academic_term?: string;
  colour?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface Lecture {
  id: string;
  module_id: string;
  title: string;
  lecture_date?: string;
  week_label?: string;
  sort_order: number;
  active_source_document_id?: string;
  settings_json: LectureSettings;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  // Joined fields
  original_filename?: string;
  processing_status?: string;
}

export interface LectureSettings {
  cornell_mode: boolean;
  layout: 'slide_left_notes_right' | 'slide_top_notes_below';
  export_defaults: {
    include_cornell_cues: boolean;
    include_annotations: boolean;
    include_page_numbers: boolean;
    template: string;
  };
}

export interface SourceDocument {
  id: string;
  lecture_id: string;
  type: 'pdf';
  original_filename: string;
  storage_key: string;
  mime_type: string;
  file_size_bytes: number;
  checksum?: string;
  page_count?: number;
  processing_status: 'pending' | 'processing' | 'ready' | 'failed';
  processing_error?: string;
  created_at: string;
  updated_at: string;
}

export interface SourcePage {
  id: string;
  source_document_id: string;
  page_number: number;
  width: number;
  height: number;
  thumbnail_storage_key?: string;
  extracted_text?: string;
}

export interface NoteBlock {
  id: string;
  lecture_id: string;
  module_id: string;
  parent_block_id?: string;
  linked_source_page_id?: string;
  block_type: BlockType;
  content_json: BlockContent;
  render_json?: any;
  source_links_json: SourceLinks;
  sort_order: number;
  created_by_device_id: string;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at?: string;
}

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'callout'
  | 'equation'
  | 'image'
  | 'file'
  | 'code'
  | 'cue'
  | 'summary'
  | 'annotation'
  | 'placeholder_citation';

export interface BlockContent {
  schema_version: string;
  type: string;
  attrs: Record<string, any>;
  content: any[];
  plain_text: string;
  export_hints: Record<string, any>;
  accessibility: {
    alt_text?: string | null;
    semantic_label?: string | null;
  };
}

export interface SourceLinks {
  citations?: string[];
  external_refs?: string[];
  ai_provenance?: string[];
}

export interface Annotation {
  id: string;
  lecture_id: string;
  source_page_id: string;
  annotation_type: 'highlight' | 'ink' | 'shape' | 'comment' | 'underline';
  geometry_json: HighlightGeometry | InkGeometry;
  style_json: AnnotationStyle;
  text_content?: string;
  layer: string;
  created_by_device_id: string;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at?: string;
}

export interface HighlightGeometry {
  coordinate_space: 'source_page';
  page_width: number;
  page_height: number;
  rects: Array<{ x: number; y: number; width: number; height: number }>;
}

export interface InkGeometry {
  coordinate_space: 'source_page';
  page_width: number;
  page_height: number;
  strokes: Array<{
    points: Array<{ x: number; y: number; pressure?: number; t: number }>;
  }>;
}

export interface AnnotationStyle {
  colour: string;
  thickness?: number;
  opacity?: number;
  semantic_label: SemanticLabel;
}

export type SemanticLabel =
  | 'definition'
  | 'method'
  | 'finding'
  | 'limitation'
  | 'exam_point'
  | 'confusing'
  | 'important'
  | 'question';

export const SEMANTIC_LABELS: Record<SemanticLabel, { label: string; colour: string }> = {
  definition: { label: 'Definition', colour: '#4CAF50' },
  method: { label: 'Method', colour: '#2196F3' },
  finding: { label: 'Finding', colour: '#FF9800' },
  limitation: { label: 'Limitation', colour: '#F44336' },
  exam_point: { label: 'Exam Point', colour: '#9C27B0' },
  confusing: { label: 'Confusing', colour: '#FF5722' },
  important: { label: 'Important', colour: '#E91E63' },
  question: { label: 'Question', colour: '#00BCD4' },
};

export interface Attachment {
  id: string;
  workspace_id: string;
  module_id?: string;
  lecture_id?: string;
  original_filename: string;
  storage_key: string;
  mime_type: string;
  file_size_bytes: number;
  checksum?: string;
  created_at: string;
  updated_at: string;
}

export interface ExportJob {
  id: string;
  workspace_id: string;
  module_id?: string;
  lecture_id?: string;
  export_type: 'pdf' | 'markdown';
  template_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  output_storage_key?: string;
  report_json: Record<string, any>;
  created_at: string;
  completed_at?: string;
}

export interface DeviceClient {
  id: string;
  user_id: string;
  label?: string;
  last_seen_at?: string;
  created_at: string;
}

export interface SyncOperation {
  id: string;
  workspace_id: string;
  device_id: string;
  sequence_number: number;
  target_table: string;
  target_id: string;
  operation_type: 'create' | 'update' | 'delete' | 'move' | 'merge' | 'restore';
  patch_json: any;
  base_version?: number;
  created_at: string;
  applied_at?: string;
}

// ===== Literature (Integrated from PsycScholar) =====

export interface LiteratureProject {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface LiteraturePaper {
  id: string;
  project_id: string;
  workspace_id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  uploaded_at: string;
  processed_at?: string;
  title?: string;
  authors?: string;
  year?: number;
  journal?: string;
  doi?: string;
  abstract?: string;
  full_text?: string;
  extracted_data?: ExtractedData;
  processing_status: 'pending' | 'processing' | 'completed' | 'error';
  error_message?: string;
  in_trash: boolean;
  trashed_at?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface ExtractedData {
  background: string;
  theory: string;
  methodology: string;
  measures: string;
  results: string;
  implications: string;
  limitations: string;
  paperType?: string;
  customFields?: Record<string, string>;
}

export interface LiteratureCustomField {
  id: string;
  project_id: string;
  workspace_id: string;
  name: string;
  description?: string;
  prompt?: string;
  created_at: string;
}

// ===== Local-only types =====

export interface UndoEntry {
  annotation: Annotation;
  previousGeometry: any;
  previousStyle: any;
  action: 'create' | 'delete' | 'modify';
}

// ===== Stage Two: Zotero Integration =====

export interface ExternalAccount {
  id: string;
  workspace_id: string;
  provider: string;
  auth_method: 'oauth' | 'api_key' | 'local_file' | 'manual';
  auth_status: 'connected' | 'expired' | 'revoked' | 'error';
  granted_scopes_json: Record<string, any>;
  provider_user_id?: string;
  provider_display_name?: string;
  created_at: string;
  updated_at: string;
  disconnected_at?: string;
}

export interface ExternalObject {
  id: string;
  external_account_id: string;
  provider: string;
  provider_object_type: string;
  provider_object_id: string;
  provider_parent_id?: string;
  local_object_type?: string;
  local_object_id?: string;
  sync_direction: 'read_only' | 'import_only' | 'export_only' | 'two_way_manual' | 'two_way_auto';
  remote_version?: string;
  local_version?: number;
  metadata_json: Record<string, any>;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface ConnectorSyncEvent {
  id: string;
  external_account_id: string;
  provider: string;
  operation_type: 'import' | 'update' | 'skip' | 'conflict' | 'error' | 'disconnect';
  local_object_type?: string;
  local_object_id?: string;
  provider_object_type?: string;
  provider_object_id?: string;
  status: 'succeeded' | 'failed' | 'skipped' | 'conflict';
  message?: string;
  details_json: Record<string, any>;
  created_at: string;
}

export interface CitationItem {
  id: string;
  workspace_id: string;
  provider: 'zotero' | 'manual';
  external_object_id?: string;
  citekey?: string;
  title: string;
  creators_json: Array<{
    firstName?: string;
    lastName?: string;
    name?: string;
    creatorType: string;
  }>;
  issued_year?: number;
  item_type?: string;
  publisher?: string;
  doi?: string;
  url?: string;
  abstract?: string;
  tags_json: string[];
  csl_json: Record<string, any>;
  bibtex?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface ReadingList {
  id: string;
  workspace_id: string;
  module_id?: string;
  name: string;
  description?: string;
  external_object_id?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface ReadingListItem {
  id: string;
  reading_list_id: string;
  citation_item_id: string;
  sort_order: number;
  notes?: string;
  created_at: string;
}
