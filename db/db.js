// auth-service/db.js
const { Pool } = require('pg');

// Configure connection string from environment or fallback
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://user:password@postgres:5432/counseling',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('connect', () => {
  console.log('Connected to PostgreSQL in auth-service');
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err);
  process.exit(-1);
});

module.exports = pool;
