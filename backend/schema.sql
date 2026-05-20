-- StudyKit Stage One schema
-- Designed for PostgreSQL 16
-- All client-created objects use UUIDv4 (generated client-side)

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===== USERS =====
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===== WORKSPACES =====
CREATE TABLE IF NOT EXISTS workspaces (
  id            UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT 'My StudyKit',
  settings_json JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

-- ===== MODULES =====
CREATE TABLE IF NOT EXISTS modules (
  id            UUID PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  code          TEXT,
  academic_term TEXT,
  colour        TEXT,
  sort_order    DECIMAL NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

-- ===== LECTURES =====
CREATE TABLE IF NOT EXISTS lectures (
  id                        UUID PRIMARY KEY,
  module_id                 UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  title                     TEXT NOT NULL,
  lecture_date              DATE,
  week_label                TEXT,
  sort_order                DECIMAL NOT NULL DEFAULT 0,
  active_source_document_id UUID,
  settings_json             JSONB NOT NULL DEFAULT '{}',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMPTZ
);

-- ===== SOURCE DOCUMENTS =====
CREATE TABLE IF NOT EXISTS source_documents (
  id                UUID PRIMARY KEY,
  lecture_id        UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  type              TEXT NOT NULL DEFAULT 'pdf',
  original_filename TEXT NOT NULL,
  storage_key       TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  file_size_bytes   INTEGER NOT NULL,
  checksum          TEXT,
  page_count        INTEGER,
  processing_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (processing_status IN ('pending','processing','ready','failed')),
  processing_error  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

-- ===== SOURCE PAGES =====
CREATE TABLE IF NOT EXISTS source_pages (
  id                    UUID PRIMARY KEY,
  source_document_id    UUID NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  page_number           INTEGER NOT NULL,
  width                 DOUBLE PRECISION NOT NULL,
  height                DOUBLE PRECISION NOT NULL,
  thumbnail_storage_key TEXT,
  extracted_text        TEXT,
  layout_json           JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_document_id, page_number)
);

-- ===== NOTE BLOCKS =====
CREATE TABLE IF NOT EXISTS note_blocks (
  id                   UUID PRIMARY KEY,
  lecture_id           UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  module_id            UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  parent_block_id      UUID REFERENCES note_blocks(id),
  linked_source_page_id UUID REFERENCES source_pages(id),
  block_type           TEXT NOT NULL
    CHECK (block_type IN ('heading','paragraph','list','callout','equation','image','file','code','cue','summary','placeholder_citation')),
  content_json         JSONB NOT NULL DEFAULT '{}',
  render_json          JSONB,
  source_links_json    JSONB NOT NULL DEFAULT '{}',
  sort_order           DECIMAL NOT NULL DEFAULT 0,
  created_by_device_id UUID NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version              INTEGER NOT NULL DEFAULT 1,
  deleted_at           TIMESTAMPTZ
);

-- ===== ANNOTATIONS =====
CREATE TABLE IF NOT EXISTS annotations (
  id                  UUID PRIMARY KEY,
  lecture_id          UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  source_page_id      UUID NOT NULL REFERENCES source_pages(id) ON DELETE CASCADE,
  annotation_type     TEXT NOT NULL
    CHECK (annotation_type IN ('highlight','ink','shape','comment','underline')),
  geometry_json       JSONB NOT NULL DEFAULT '{}',
  style_json          JSONB NOT NULL DEFAULT '{}',
  text_content        TEXT,
  layer               TEXT NOT NULL DEFAULT 'student',
  created_by_device_id UUID NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version             INTEGER NOT NULL DEFAULT 1,
  deleted_at          TIMESTAMPTZ
);

-- ===== ATTACHMENTS =====
CREATE TABLE IF NOT EXISTS attachments (
  id                UUID PRIMARY KEY,
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  module_id         UUID REFERENCES modules(id),
  lecture_id        UUID REFERENCES lectures(id),
  original_filename TEXT NOT NULL,
  storage_key       TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  file_size_bytes   INTEGER NOT NULL,
  checksum          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

-- ===== BLOCK ATTACHMENTS JUNCTION =====
CREATE TABLE IF NOT EXISTS block_attachments (
  block_id      UUID NOT NULL REFERENCES note_blocks(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'embed'
                CHECK (role IN ('embed','reference','export_asset')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (block_id, attachment_id)
);

-- ===== EXPORT JOBS =====
CREATE TABLE IF NOT EXISTS export_jobs (
  id                 UUID PRIMARY KEY,
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  module_id          UUID REFERENCES modules(id),
  lecture_id         UUID REFERENCES lectures(id),
  export_type        TEXT NOT NULL CHECK (export_type IN ('pdf','markdown')),
  template_id        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','running','succeeded','failed')),
  output_storage_key TEXT,
  report_json        JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ
);

-- ===== DEVICE CLIENTS =====
CREATE TABLE IF NOT EXISTS device_clients (
  id           UUID PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===== SYNC OPERATIONS =====
CREATE TABLE IF NOT EXISTS sync_operations (
  id              UUID PRIMARY KEY,
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  device_id       UUID NOT NULL REFERENCES device_clients(id),
  sequence_number INTEGER NOT NULL,
  target_table    TEXT NOT NULL,
  target_id       UUID NOT NULL,
  operation_type  TEXT NOT NULL
                  CHECK (operation_type IN ('create','update','delete','move','merge','restore')),
  patch_json      JSONB NOT NULL DEFAULT '{}',
  base_version    INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at      TIMESTAMPTZ
);

-- ===== FUTURE RESERVED EXTERNAL REFS =====
CREATE TABLE IF NOT EXISTS future_reserved_external_refs (
  id                  UUID PRIMARY KEY,
  provider            TEXT NOT NULL,
  provider_object_type TEXT NOT NULL,
  provider_object_id  TEXT NOT NULL,
  local_object_type   TEXT NOT NULL,
  local_object_id     UUID NOT NULL,
  metadata_json       JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===== LITERATURE PROJECTS =====
CREATE TABLE IF NOT EXISTS literature_projects (
  id            UUID PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

-- ===== LITERATURE PAPERS =====
CREATE TABLE IF NOT EXISTS literature_papers (
  id                UUID PRIMARY KEY,
  project_id        UUID NOT NULL REFERENCES literature_projects(id) ON DELETE CASCADE,
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_name         TEXT NOT NULL,
  file_size         INTEGER NOT NULL,
  file_type         TEXT NOT NULL DEFAULT 'application/pdf',
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ,
  title             TEXT,
  authors           TEXT,
  year              INTEGER,
  journal           TEXT,
  doi               TEXT,
  abstract          TEXT,
  full_text         TEXT,
  extracted_data    JSONB,
  processing_status TEXT NOT NULL DEFAULT 'completed'
                    CHECK (processing_status IN ('pending','processing','completed','error')),
  error_message     TEXT,
  in_trash          BOOLEAN NOT NULL DEFAULT FALSE,
  trashed_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

-- ===== LITERATURE CUSTOM FIELDS =====
CREATE TABLE IF NOT EXISTS literature_custom_fields (
  id            UUID PRIMARY KEY,
  project_id    UUID NOT NULL REFERENCES literature_projects(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  prompt        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

-- ===== STAGE TWO: EXTERNAL ACCOUNTS =====
CREATE TABLE IF NOT EXISTS external_accounts (
  id                  UUID PRIMARY KEY,
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,
  auth_method         TEXT NOT NULL DEFAULT 'api_key'
                      CHECK (auth_method IN ('oauth','api_key','local_file','manual')),
  auth_status         TEXT NOT NULL DEFAULT 'connected'
                      CHECK (auth_status IN ('connected','expired','revoked','error')),
  granted_scopes_json JSONB NOT NULL DEFAULT '{}',
  provider_user_id    TEXT,
  provider_display_name TEXT,
  credentials_json    JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_accounts_workspace_provider
  ON external_accounts(workspace_id, provider) WHERE disconnected_at IS NULL;

-- ===== STAGE TWO: EXTERNAL OBJECTS =====
CREATE TABLE IF NOT EXISTS external_objects (
  id                    UUID PRIMARY KEY,
  external_account_id   UUID NOT NULL REFERENCES external_accounts(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL,
  provider_object_type  TEXT NOT NULL,
  provider_object_id    TEXT NOT NULL,
  provider_parent_id    TEXT,
  local_object_type     TEXT,
  local_object_id       UUID,
  sync_direction        TEXT NOT NULL DEFAULT 'read_only'
                        CHECK (sync_direction IN ('read_only','import_only','export_only','two_way_manual','two_way_auto')),
  remote_version        TEXT,
  local_version         INTEGER,
  metadata_json         JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,
  UNIQUE(external_account_id, provider_object_id)
);
CREATE INDEX IF NOT EXISTS idx_ext_objects_account
  ON external_objects(external_account_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ext_objects_local
  ON external_objects(local_object_type, local_object_id) WHERE deleted_at IS NULL;

-- ===== STAGE TWO: CONNECTOR SYNC EVENTS =====
CREATE TABLE IF NOT EXISTS connector_sync_events (
  id                  UUID PRIMARY KEY,
  external_account_id UUID NOT NULL REFERENCES external_accounts(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,
  operation_type      TEXT NOT NULL
                      CHECK (operation_type IN ('import','update','skip','conflict','error','disconnect')),
  local_object_type   TEXT,
  local_object_id     UUID,
  provider_object_type TEXT,
  provider_object_id  TEXT,
  status              TEXT NOT NULL
                      CHECK (status IN ('succeeded','failed','skipped','conflict')),
  message             TEXT,
  details_json        JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sync_events_account
  ON connector_sync_events(external_account_id);
CREATE INDEX IF NOT EXISTS idx_sync_events_created
  ON connector_sync_events(created_at);

-- ===== STAGE TWO: CITATION ITEMS =====
CREATE TABLE IF NOT EXISTS citation_items (
  id                UUID PRIMARY KEY,
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL DEFAULT 'manual'
                    CHECK (provider IN ('zotero','manual')),
  external_object_id UUID REFERENCES external_objects(id),
  citekey           TEXT,
  title             TEXT NOT NULL,
  creators_json     JSONB NOT NULL DEFAULT '[]',
  issued_year       INTEGER,
  item_type         TEXT,
  publisher         TEXT,
  doi               TEXT,
  url               TEXT,
  abstract          TEXT,
  tags_json         JSONB NOT NULL DEFAULT '[]',
  csl_json          JSONB NOT NULL DEFAULT '{}',
  bibtex            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_citation_items_workspace
  ON citation_items(workspace_id) WHERE deleted_at IS NULL;

-- ===== STAGE TWO: READING LISTS =====
CREATE TABLE IF NOT EXISTS reading_lists (
  id            UUID PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  module_id     UUID REFERENCES modules(id),
  name          TEXT NOT NULL,
  description   TEXT,
  external_object_id UUID REFERENCES external_objects(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_reading_lists_workspace
  ON reading_lists(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reading_lists_module
  ON reading_lists(module_id) WHERE deleted_at IS NULL;

-- ===== STAGE TWO: READING LIST ITEMS (junction) =====
CREATE TABLE IF NOT EXISTS reading_list_items (
  id              UUID PRIMARY KEY,
  reading_list_id UUID NOT NULL REFERENCES reading_lists(id) ON DELETE CASCADE,
  citation_item_id UUID NOT NULL REFERENCES citation_items(id) ON DELETE CASCADE,
  sort_order      DECIMAL NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(reading_list_id, citation_item_id)
);
CREATE INDEX IF NOT EXISTS idx_reading_list_items_list
  ON reading_list_items(reading_list_id);
CREATE INDEX IF NOT EXISTS idx_reading_list_items_citation
  ON reading_list_items(citation_item_id);

-- ===== INDEXES =====
CREATE INDEX idx_modules_workspace ON modules(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_lectures_module ON lectures(module_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_source_documents_lecture ON source_documents(lecture_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_source_pages_document ON source_pages(source_document_id);
CREATE INDEX idx_note_blocks_lecture ON note_blocks(lecture_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_note_blocks_module ON note_blocks(module_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_note_blocks_page ON note_blocks(linked_source_page_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_annotations_page ON annotations(source_page_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_annotations_lecture ON annotations(lecture_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_sync_operations_workspace ON sync_operations(workspace_id);
CREATE INDEX idx_sync_operations_device ON sync_operations(device_id, sequence_number);

-- Literature indexes
CREATE INDEX idx_lit_projects_workspace ON literature_projects(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_lit_papers_project ON literature_papers(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_lit_papers_workspace ON literature_papers(workspace_id);
CREATE INDEX idx_lit_custom_fields_project ON literature_custom_fields(project_id) WHERE deleted_at IS NULL;
