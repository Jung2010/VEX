import pg from 'pg';
const { Pool } = pg;

let pool;

export function getPool() {
  // Deliberately do not fall back to DATABASE_URL: Preview must have its own isolated DB.
  const connectionString = process.env.VEX_PREVIEW_DATABASE_URL;
  if (!connectionString) {
    const error = new Error('VEX Preview database is not configured');
    error.code = 'VEX_PREVIEW_DB_NOT_CONFIGURED';
    throw error;
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000
    });
  }
  return pool;
}
