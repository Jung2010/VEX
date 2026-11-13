import pg from 'pg';
const { Pool } = pg;

let pool;

export function getPool() {
  // This database is reserved for VEXT Preview. Never connect from Production.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'preview') {
    const error = new Error('VEXT database access is restricted to Preview deployments');
    error.code = 'VEXT_PREVIEW_ONLY';
    throw error;
  }

  // Use the Neon integration variable for the newly connected VEXT database.
  // Never fall back to the legacy shared DATABASE_URL.
  const connectionString = process.env.VEXT_DATABASE_URL;
  if (!connectionString) {
    const error = new Error('VEXT Preview database is not configured');
    error.code = 'VEXT_DB_NOT_CONFIGURED';
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
