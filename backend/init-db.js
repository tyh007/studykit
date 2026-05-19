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
    }
  } catch (err) {
    console.error('❌ Database initialization failed:', err.message);
    console.log('⚠️  Will retry on next startup...');
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  initDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = initDatabase;
