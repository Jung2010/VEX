import { getPool } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const db = getPool();
    const result = await db.query('SELECT NOW() AS database_time');
    return res.status(200).json({
      ok: true,
      service: 'VEX v2 simulated economy',
      database: true,
      databaseTime: result.rows[0].database_time,
      schemaBootstrap: 'manual',
      databaseScope: 'dedicated-preview'
    });
  } catch (error) {
    if (error?.code === 'VEXT_DB_NOT_CONFIGURED') {
      return res.status(200).json({
        ok: true,
        service: 'VEX v2 simulated economy',
        database: false,
        accountService: 'disabled',
        reason: 'Dedicated Preview database is not configured.',
        schemaBootstrap: 'manual'
      });
    }
    console.error('VEX health check failed:', error?.code || 'unknown');
    return res.status(503).json({ ok: false, service: 'VEX v2 simulated economy', database: false });
  }
}
