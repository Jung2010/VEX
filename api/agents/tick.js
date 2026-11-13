import { timingSafeEqual } from 'node:crypto';
import { getPool } from '../../lib/db.js';
import { runLiquidityAgent } from './liquidity.js';

const fail = (res, status, error) => res.status(status).json({ error });

function authorized(req) {
  const expected = process.env.VEXT_AGENT_CRON_SECRET || '';
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return fail(res, 405, 'Method not allowed.');
  if (!authorized(req)) return fail(res, 401, 'Agent scheduler authentication required.');

  // This worker is deliberately Preview-only. Vercel Cron itself invokes
  // Production deployments only, so this route is manually/external-triggered
  // until a separately approved production rollout exists.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'preview') {
    return fail(res, 403, 'Autonomous agent ticks are restricted to Preview.');
  }
  if (process.env.VERCEL_GIT_COMMIT_REF && process.env.VERCEL_GIT_COMMIT_REF !== 'rebuild/vex-v2') {
    return fail(res, 403, 'This Preview branch is not authorized to run the agent.');
  }

  let client;
  let lockAcquired = false;
  try {
    const db = getPool();
    client = await db.connect();
    const lock = await client.query(
      "SELECT pg_try_advisory_lock(hashtext('vext_liquidity_tick')) AS acquired"
    );
    lockAcquired = Boolean(lock.rows[0]?.acquired);
    if (!lockAcquired) return res.status(202).json({ skipped: true, reason: 'tick-already-running' });

    const markets = await client.query(
      'SELECT symbol FROM vex2_markets WHERE enabled=true ORDER BY symbol'
    );
    const results = [];
    for (const row of markets.rows) {
      try {
        await client.query('BEGIN');
        const result = await runLiquidityAgent(client, row.symbol);
        await client.query('COMMIT');
        results.push({ market: row.symbol, status: result.status, orders: result.orders.length });
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        results.push({ market: row.symbol, status: 'error', error: error?.message || 'unknown error' });
      }
    }
    return res.status(200).json({
      mode: 'simulation-only',
      worker: 'VEXT Liquidity Desk',
      marketsProcessed: results.length,
      results
    });
  } catch (error) {
    console.error('VEXT agent tick failed:', error?.stack || error?.message || 'unknown');
    return fail(res, 503, 'Agent scheduler temporarily unavailable.');
  } finally {
    if (client && lockAcquired) {
      try { await client.query("SELECT pg_advisory_unlock(hashtext('vext_liquidity_tick'))"); } catch {}
    }
    client?.release();
  }
}
