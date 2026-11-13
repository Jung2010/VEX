import { timingSafeEqual } from 'node:crypto';
import { getPool } from '../../lib/db.js';

const AGENT_NAME = 'VEXT Liquidity Desk';
const AGENT_HANDLE = 'system_vext_liquidity_desk';
const fail = (res, status, error) => res.status(status).json({ error });

function authorized(req) {
  const expected = process.env.VEXT_SUPERUSER_KEY || '';
  const supplied = String(req.headers['x-vext-admin-key'] || '');
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!authorized(req)) return fail(res, 401, 'Superuser authentication required.');
  if (!['GET', 'POST'].includes(req.method)) return fail(res, 405, 'Method not allowed.');
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'preview') {
    return fail(res, 403, 'Agent controls are restricted to Preview.');
  }
  if (process.env.VERCEL_GIT_COMMIT_REF && process.env.VERCEL_GIT_COMMIT_REF !== 'rebuild/vex-v2') {
    return fail(res, 403, 'This Preview branch is not authorized.');
  }

  const db = getPool();
  let client;
  try {
    client = await db.connect();
    if (req.method === 'GET') {
      const result = await client.query(
        'SELECT agent,enabled,updated_at,updated_by FROM vex2_agent_config WHERE agent=$1',
        [AGENT_NAME]
      );
      const row = result.rows[0] || { agent: AGENT_NAME, enabled: true, updated_at: null, updated_by: 'default' };
      return res.status(200).json({ mode: 'simulation-only', control: row });
    }

    if (typeof req.body?.enabled !== 'boolean') return fail(res, 400, 'enabled must be a boolean.');
    const enabled = req.body.enabled;
    await client.query('BEGIN');
    const account = await client.query('SELECT id FROM vex2_accounts WHERE handle=$1 FOR UPDATE', [AGENT_HANDLE]);
    if (!account.rowCount) throw new Error('Liquidity agent account does not exist.');
    const accountId = account.rows[0].id;
    let cancelled = 0;
    if (!enabled) {
      const orders = await client.query(
        "SELECT o.id,o.market,o.side,o.price,o.remaining,(o.price*o.remaining)::text AS reserve_amount,m.base_asset,m.quote_asset FROM vex2_orders o JOIN vex2_markets m ON m.symbol=o.market WHERE o.account_id=$1 AND o.status IN ('open','partially_filled') AND o.remaining>0 FOR UPDATE OF o",
        [accountId]
      );
      for (const order of orders.rows) {
        const asset = order.side === 'buy' ? order.quote_asset : order.base_asset;
        const amount = order.side === 'buy'
          ? String(order.reserve_amount)
          : String(order.remaining);
        await client.query(
          'UPDATE vex2_balances SET available=available+$3::numeric,locked=locked-$3::numeric WHERE account_id=$1 AND asset=$2',
          [accountId, asset, amount]
        );
        await client.query("UPDATE vex2_orders SET status='cancelled',remaining=0 WHERE id=$1", [order.id]);
        cancelled++;
      }
    }
    const updated = await client.query(
      'INSERT INTO vex2_agent_config(agent,enabled,updated_at,updated_by) VALUES($1,$2,NOW(),$3) ON CONFLICT(agent) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=NOW(),updated_by=EXCLUDED.updated_by RETURNING agent,enabled,updated_at,updated_by',
      [AGENT_NAME, enabled, 'superuser']
    );
    await client.query(
      'INSERT INTO vex2_admin_audit(action,actor,details) VALUES($1,$2,$3::jsonb)',
      [enabled ? 'liquidity_agent_resumed' : 'liquidity_agent_paused', 'superuser', JSON.stringify({ cancelledOpenOrders: cancelled })]
    );
    await client.query('COMMIT');
    return res.status(200).json({
      mode: 'simulation-only',
      control: updated.rows[0],
      cancelledOpenOrders: cancelled,
      note: enabled ? 'Agent will quote on its next tick.' : 'Open agent quotes were cancelled and reserved virtual balances released.'
    });
  } catch (error) {
    if (client) try { await client.query('ROLLBACK'); } catch {}
    if (error?.code === '42P01') return fail(res, 503, 'Apply VEXT migration 006 on the isolated Preview database.');
    console.error('VEXT agent control failed:', error?.stack || error?.message || 'unknown');
    return fail(res, 503, 'Agent control temporarily unavailable.');
  } finally {
    client?.release();
  }
}
