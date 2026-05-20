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
  // Check and create indexes for these tables
  const indexes = [
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
}

// Run if called directly
if (require.main === module) {
  initDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = initDatabase;
