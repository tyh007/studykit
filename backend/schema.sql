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
