import { getPool } from '../lib/db.js';
export default async function handler(req, res) {
  try {
    const r = await getPool().query('SELECT NOW() AS database_time');
    res.status(200).json({ ok: true, service: 'VEX v2 simulated economy', database: true, databaseTime: r.rows[0].database_time, schemaBootstrap: 'manual' });
  } catch (e) {
    res.status(503).json({ ok: false, service: 'VEX v2 simulated economy', database: false, error: process.env.NODE_ENV === 'production' ? 'Database unavailable' : e.message });
  }
}
