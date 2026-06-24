// Auto-initialize database schema on startup
// This runs schema.sql against the database if tables don't exist yet
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function initDatabase() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'studykit',
    user: process.env.DB_USER || 'studykit',
    password: process.env.DB_PASSWORD || 'studykit_dev_pass',
  });

  try {
    // Check if schema already initialized
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'users'
      )
    `);

    if (!result.rows[0].exists) {
      console.log('📦 Initializing database schema...');
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(schema);
      console.log('✅ Database schema initialized successfully');
    } else {
      console.log('✅ Database schema already initialized');
      // Apply incremental migrations for existing databases
      await migrateDatabase(pool);
    }
  } catch (err) {
    console.error('❌ Database initialization failed:', err.message);
    console.log('⚠️  Will retry on next startup...');
  } finally {
    await pool.end();
  }
}

// Incremental migrations for existing databases
async function migrateDatabase(pool) {
  // Check and create Stage Two tables if missing
  const tables = [
    'ai_provider_profiles',
    'ai_task_defaults',
    'external_accounts',
    'external_objects',
    'connector_sync_events',
    'citation_items',
    'reading_lists',
    'reading_list_items',
  ];
  for (const table of tables) {
    const exists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_name = $1
      )
    `, [table]);
    if (!exists.rows[0].exists) {
      console.log(`📦 Creating missing table: ${table}...`);
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      // Extract the CREATE TABLE block for this specific table
      const regex = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\([\\s\\S]+?\\);`, '');
      const match = schema.match(regex);
      if (match) {
        await pool.query(match[0]);
        console.log(`✅ Created table: ${table}`);
      }
    }
  }
  // Check and create Stage Three tables (paper annotations, pdf references)
  const stageThreeTables = [
    'paper_annotations',
    'literature_pdf_references',
  ];
  for (const table of stageThreeTables) {
    const exists = await pool.query(
      'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)',
      [table]
    );
    if (!exists.rows[0].exists) {
      console.log(`📦 Creating missing table: ${table}...`);
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      const regex = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\([\\s\\S]+?\\);`, '');
      const match = schema.match(regex);
      if (match) {
        await pool.query(match[0]);
        console.log(`✅ Created table: ${table}`);
      }
    }
  }

  // Check for new columns on literature_papers
  const newLitColumns = [
    { name: 'storage_key', type: 'TEXT' },
    { name: 'citation_item_id', type: 'UUID' },
  ];
  for (const col of newLitColumns) {
    const exists = await pool.query(
      `SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'literature_papers' AND column_name = $1)`,
      [col.name]
    );
    if (!exists.rows[0].exists) {
      console.log(`📦 Adding column ${col.name} to literature_papers...`);
      const fkClause = col.name === 'citation_item_id' ? ' REFERENCES citation_items(id)' : '';
      await pool.query(`ALTER TABLE literature_papers ADD COLUMN ${col.name} ${col.type}${fkClause};`);
      console.log(`✅ Added column: ${col.name}`);
    }
  }

  // Check and create indexes for paper_annotations and pdf_references
  const newIndexes = [
    'idx_paper_annotations_paper',
    'idx_lit_pdf_refs_paper',
    'idx_lit_pdf_refs_reading_list',
  ];
  for (const idx of newIndexes) {
    const exists = await pool.query(
      'SELECT EXISTS (SELECT FROM pg_indexes WHERE indexname = $1)',
      [idx]
    );
    if (!exists.rows[0].exists) {
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      const regex = new RegExp(`CREATE INDEX IF NOT EXISTS ${idx}[\\s\\S]+?;`, '');
      const match = schema.match(regex);
      if (match) {
        await pool.query(match[0]);
        console.log(`✅ Created index: ${idx}`);
      }
    }
  }

  // Check and create indexes for these tables
  const indexes = [
    'idx_ai_profiles_workspace',
    'idx_ext_accounts_workspace_provider',
    'idx_ext_objects_account',
    'idx_ext_objects_local',
    'idx_sync_events_account',
    'idx_sync_events_created',
    'idx_citation_items_workspace',
    'idx_reading_lists_workspace',
    'idx_reading_lists_module',
    'idx_reading_list_items_list',
    'idx_reading_list_items_citation',
  ];
  for (const idx of indexes) {
    const exists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM pg_indexes WHERE indexname = $1
      )
    `, [idx]);
    if (!exists.rows[0].exists) {
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      const regex = new RegExp(`CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ${idx}[\\s\\S]+?;`, '');
      const match = schema.match(regex);
      if (match) {
        await pool.query(match[0]);
        console.log(`✅ Created index: ${idx}`);
      }
    }
  }

  // Literature Hub v2 migrations
  try {
    await pool.query(`ALTER TABLE literature_papers ADD COLUMN IF NOT EXISTS reading_status TEXT NOT NULL DEFAULT 'unread'`);
    await pool.query(`ALTER TABLE literature_papers ADD COLUMN IF NOT EXISTS importance INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`CREATE TABLE IF NOT EXISTS paper_notes (
      id UUID PRIMARY KEY, paper_id UUID NOT NULL REFERENCES literature_papers(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      content TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS paper_relations (
      id UUID PRIMARY KEY, source_paper_id UUID NOT NULL REFERENCES literature_papers(id) ON DELETE CASCADE,
      target_paper_id UUID NOT NULL REFERENCES literature_papers(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL, description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(source_paper_id, target_paper_id, relation_type)
    )`);
    console.log('✅ Literature Hub v2 migrations applied');
  } catch (migrateErr) {
    console.warn('⚠️ Literature Hub v2 migration warning (non-fatal):', migrateErr.message);
  }
}

// Run if called directly
if (require.main === module) {
  initDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = initDatabase;
