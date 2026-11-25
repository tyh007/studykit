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

-- ===== PAPER ANNOTATIONS (server-persisted, user-scoped) =====
CREATE TABLE IF NOT EXISTS paper_annotations (
  id                  UUID PRIMARY KEY,
  paper_id            UUID NOT NULL REFERENCES literature_papers(id) ON DELETE CASCADE,
  page_number         INTEGER NOT NULL,
  annotation_type     TEXT NOT NULL
    CHECK (annotation_type IN ('highlight','ink','underline')),
  geometry_json       JSONB NOT NULL DEFAULT '{}',
  style_json          JSONB NOT NULL DEFAULT '{}',
  text_content        TEXT,
  created_by_user_id  UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_paper_annotations_paper
  ON paper_annotations(paper_id) WHERE deleted_at IS NULL;

-- ===== LITERATURE PDF REFERENCES (links papers to reading lists) =====
CREATE TABLE IF NOT EXISTS literature_pdf_references (
  id                UUID PRIMARY KEY,
  paper_id          UUID NOT NULL REFERENCES literature_papers(id) ON DELETE CASCADE,
  reading_list_id   UUID REFERENCES reading_lists(id) ON DELETE SET NULL,
  citation_item_id  UUID REFERENCES citation_items(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lit_pdf_refs_paper
  ON literature_pdf_references(paper_id);
CREATE INDEX IF NOT EXISTS idx_lit_pdf_refs_reading_list
  ON literature_pdf_references(reading_list_id);

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
  reading_status    TEXT NOT NULL DEFAULT 'unread'
                    CHECK (reading_status IN ('unread','reading','read','reviewed')),
  importance        INTEGER NOT NULL DEFAULT 0
                    CHECK (importance >= 0 AND importance <= 5),
  processing_status TEXT NOT NULL DEFAULT 'completed'
                    CHECK (processing_status IN ('pending','processing','completed','error')),
  error_message     TEXT,
  storage_key         TEXT,
  citation_item_id    UUID REFERENCES citation_items(id),
  in_trash            BOOLEAN NOT NULL DEFAULT FALSE,
  trashed_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
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

-- ===== PAPER NOTES =====
CREATE TABLE IF NOT EXISTS paper_notes (
  id            UUID PRIMARY KEY,
  paper_id      UUID NOT NULL REFERENCES literature_papers(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_paper_notes_paper ON paper_notes(paper_id);

-- ===== PAPER RELATIONS =====
CREATE TABLE IF NOT EXISTS paper_relations (
  id                UUID PRIMARY KEY,
  source_paper_id   UUID NOT NULL REFERENCES literature_papers(id) ON DELETE CASCADE,
  target_paper_id   UUID NOT NULL REFERENCES literature_papers(id) ON DELETE CASCADE,
  relation_type     TEXT NOT NULL CHECK (relation_type IN ('cites','extends','contradicts','supports','related','method','dataset')),
  description       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_paper_id, target_paper_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_paper_relations_source ON paper_relations(source_paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_relations_target ON paper_relations(target_paper_id);

-- ===== LITERATURE CANVASES =====
CREATE TABLE IF NOT EXISTS literature_canvases (
  id            UUID PRIMARY KEY,
  project_id    UUID NOT NULL REFERENCES literature_projects(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT 'Canvas',
  viewport_json JSONB NOT NULL DEFAULT '{}',
  settings_json JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lit_canvases_project
  ON literature_canvases(project_id) WHERE deleted_at IS NULL;

-- ===== LITERATURE CANVAS NODES =====
CREATE TABLE IF NOT EXISTS literature_canvas_nodes (
  id           UUID PRIMARY KEY,
  canvas_id    UUID NOT NULL REFERENCES literature_canvases(id) ON DELETE CASCADE,
  node_type    TEXT NOT NULL
               CHECK (node_type IN ('paper','note','text','question','group','shape')),
  ref_type     TEXT,
  ref_id       UUID,
  x            DOUBLE PRECISION NOT NULL,
  y            DOUBLE PRECISION NOT NULL,
  width        DOUBLE PRECISION NOT NULL DEFAULT 260,
  height       DOUBLE PRECISION NOT NULL DEFAULT 160,
  z_index      INTEGER NOT NULL DEFAULT 0,
  content_json JSONB NOT NULL DEFAULT '{}',
  style_json   JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lit_canvas_nodes_canvas
  ON literature_canvas_nodes(canvas_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lit_canvas_nodes_ref
  ON literature_canvas_nodes(ref_type, ref_id) WHERE deleted_at IS NULL;

-- ===== LITERATURE CANVAS EDGES =====
CREATE TABLE IF NOT EXISTS literature_canvas_edges (
  id             UUID PRIMARY KEY,
  canvas_id      UUID NOT NULL REFERENCES literature_canvases(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES literature_canvas_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES literature_canvas_nodes(id) ON DELETE CASCADE,
  relation_id    UUID REFERENCES paper_relations(id) ON DELETE SET NULL,
  edge_type      TEXT NOT NULL DEFAULT 'canvas'
                 CHECK (edge_type IN ('canvas','paper_relation')),
  label          TEXT,
  content_json   JSONB NOT NULL DEFAULT '{}',
  style_json     JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lit_canvas_edges_canvas
  ON literature_canvas_edges(canvas_id) WHERE deleted_at IS NULL;

-- ===== LITERATURE CANVAS SCENES =====
CREATE TABLE IF NOT EXISTS literature_canvas_scenes (
  id            UUID PRIMARY KEY,
  canvas_id     UUID NOT NULL REFERENCES literature_canvases(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  viewport_json JSONB NOT NULL DEFAULT '{}',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lit_canvas_scenes_canvas
  ON literature_canvas_scenes(canvas_id, sort_order) WHERE deleted_at IS NULL;

-- ===== LITERATURE AI PROVIDER PROFILES =====
CREATE TABLE IF NOT EXISTS ai_provider_profiles (
  id                    UUID PRIMARY KEY,
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  provider              TEXT NOT NULL,
  base_url              TEXT,
  model                 TEXT,
  credential_encrypted  TEXT,
  credential_mask       TEXT,
  options_json          JSONB NOT NULL DEFAULT '{}',
  capabilities_json     JSONB NOT NULL DEFAULT '{}',
  last_test_status      TEXT NOT NULL DEFAULT 'untested'
                        CHECK (last_test_status IN ('untested','success','error')),
  last_test_error       TEXT,
  last_tested_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ai_profiles_workspace
  ON ai_provider_profiles(workspace_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ai_task_defaults (
  workspace_id          UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  summary_profile_id    UUID REFERENCES ai_provider_profiles(id) ON DELETE SET NULL,
  vision_profile_id     UUID REFERENCES ai_provider_profiles(id) ON DELETE SET NULL,
  chat_profile_id       UUID REFERENCES ai_provider_profiles(id) ON DELETE SET NULL,
  summary_options_json  JSONB NOT NULL DEFAULT '{}',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

-- ===== COLLAB TABLES (WP-08 Round 3) =====
-- Cross-user collaboration. The collab slice is
-- project-scoped: every project has a set of
-- memberships + a shared activity log + an op
-- log the client uses for cross-device sync.
-- The `id` columns use the projectId format the
-- client generates (no server-side generation)
-- so the client can write rows before the server
-- has acked the id. The server enforces FK +
-- uniqueness.

CREATE TABLE IF NOT EXISTS collab_projects (
  -- The project's client-generated id. The
  -- collab_projects row is created atomically
  -- with the research_projects row (the
  -- createProject use case writes both inside
  -- one transaction). The id is the same
  -- id the client uses in Dexie.
  id              TEXT PRIMARY KEY,
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- The minimal project metadata that other
  -- members need to discover and navigate the
  -- project. Private columns (livingBrief,
  -- private scratch, etc.) live in the
  -- research_projects / collab_scratches
  -- tables and are NOT mirrored here.
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'empirical',
  -- The user that created the project. The
  -- initial membership row grants this user
  -- the `owner` role in the same transaction.
  owner_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- A row per (project, user). The (projectId,
-- userId) pair is unique. The server is the
-- single source of truth for membership; the
-- client may only add a membership through the
-- invite endpoint, which is a no-op when the
-- pair already exists.
CREATE TABLE IF NOT EXISTS collab_memberships (
  project_id   TEXT NOT NULL REFERENCES collab_projects(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner','editor','commenter','viewer')),
  -- The user that added this membership. The
  -- `owner` role is only assigned by the project
  -- creator at create time; every later invite
  -- uses a non-owner role.
  added_by     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Snapshot of the display name at add time;
  -- the client uses this for the member list
  -- before the user record is queried.
  display_name TEXT NOT NULL,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_collab_memberships_user
  ON collab_memberships(user_id);

-- The cross-user activity log. Every cross-user
-- event the client emits (member-added, comment-
-- posted, task-shared, task-assigned, ...) is
-- recorded here. The client uses the row's
-- `created_at` + `id` tuple as the cursor.
CREATE TABLE IF NOT EXISTS collab_activities (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES collab_projects(id) ON DELETE CASCADE,
  -- The user that triggered the event.
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_name    TEXT NOT NULL,
  -- Canonical shared activity is always attributed
  -- to the authenticated user. AI suggestions must
  -- pass through the Draft Layer and explicit accept.
  actor_type    TEXT NOT NULL CHECK (actor_type = 'user'),
  kind          TEXT NOT NULL,
  -- Optional structured target. The shape
  -- depends on `kind` (e.g. `task` for an
  -- `task-shared` event). `null` for events
  -- that are not attached to a single object.
  target_kind   TEXT,
  target_id     TEXT,
  -- Short, human-readable summary (<= 140 chars).
  summary       TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  -- JSON snapshot of the payload, used for
  -- the inbox apply step on the receiving
  -- side. The shape mirrors the canonical
  -- domain row.
  payload_json  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collab_activities_project_created
  ON collab_activities(project_id, created_at);

-- The durable cross-user op log. Every
-- successful use case write appends a row
-- here in the same transaction that writes
-- the canonical row + the outbox row. The
-- `client_op_id` is the client's outbox row
-- id; the unique constraint makes the push
-- idempotent (re-sending the same op is a
-- no-op). The `(created_at, id)` cursor is
-- what the client pulls in `?since=...`.
CREATE TABLE IF NOT EXISTS collab_op_log (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES collab_projects(id) ON DELETE CASCADE,
  -- The originating device's client id (the
  -- outbox row's `clientId`). Used by the
  -- server to skip the writer's own pulls.
  client_id    TEXT NOT NULL,
  kind         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  base_version TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, id)
);

CREATE INDEX IF NOT EXISTS idx_collab_op_log_project_cursor
  ON collab_op_log(project_id, created_at, id);

-- Per-(project, client) cursor. The client
-- stores the last applied op id; the next
-- pull returns ops with `(created_at, id) >
-- cursor`. The cursor is a per-client opaque
-- string (the client encodes the tuple as
-- `<ms>:<id>`); the server only uses it as
-- a value to filter by.
CREATE TABLE IF NOT EXISTS collab_cursors (
  project_id   TEXT NOT NULL REFERENCES collab_projects(id) ON DELETE CASCADE,
  client_id    TEXT NOT NULL,
  cursor_ms    BIGINT NOT NULL DEFAULT 0,
  cursor_id    TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, client_id)
);
