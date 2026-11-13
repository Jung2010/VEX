import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getPool } from '../lib/db.js';

const STARTING_BALANCES = { KRW: '10000000', CCC: '1000', TOLR: '2500', SECX: '250' };
const SESSION_DAYS = 30;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
function sendUnavailable(res, error) {
  if (error?.code === 'VEX_PREVIEW_DB_NOT_CONFIGURED') {
    return res.status(503).json({ error: 'Preview account service is not enabled until an isolated Preview database is configured.', code: error.code });
  }
  if (error?.code === '42P01') {
    return res.status(503).json({ error: 'Preview schema is not initialized. Apply the reviewed VEX v2 migrations to the isolated Preview database.' });
  }
  console.error('VEX account API failed:', error?.code || error?.message || 'unknown');
  return res.status(503).json({ error: 'Account service temporarily unavailable.' });
}
function bearer(req) {
  const value = req.headers.authorization || '';
  const match = value.match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
  return match?.[1] || null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  let db;
  try {
    db = getPool();
    if (req.method === 'POST') {
      const token = randomBytes(32).toString('base64url');
      const tokenHash = hashToken(token);
      const handle = 'guest_' + randomUUID().replaceAll('-', '').slice(0, 20);
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const created = await client.query(
          'INSERT INTO vex2_accounts(handle) VALUES ($1) RETURNING id, handle, created_at',
          [handle]
        );
        const account = created.rows[0];
        for (const [asset, amount] of Object.entries(STARTING_BALANCES)) {
          await client.query(
            'INSERT INTO vex2_balances(account_id, asset, available, locked) VALUES ($1,$2,$3,0)',
            [account.id, asset, amount]
          );
        }
        await client.query(
          "INSERT INTO vex2_account_sessions(account_id, token_hash, expires_at) VALUES ($1,$2,NOW() + ($3 * INTERVAL '1 day'))",
          [account.id, tokenHash, SESSION_DAYS]
        );
        await client.query('COMMIT');
        return res.status(201).json({
          account: { id: account.id, handle: account.handle, createdAt: account.created_at },
          token,
          expiresInDays: SESSION_DAYS,
          balances: Object.entries(STARTING_BALANCES).map(([asset, available]) => ({ asset, available, locked: '0' }))
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    const token = bearer(req);
    if (!token) return res.status(401).json({ error: 'A valid Bearer session token is required.' });
    const result = await db.query(
      `SELECT a.id, a.handle, a.created_at
       FROM vex2_account_sessions s
       JOIN vex2_accounts a ON a.id = s.account_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()
       LIMIT 1`,
      [hashToken(token)]
    );
    if (!result.rowCount) return res.status(401).json({ error: 'Session is invalid or expired.' });
    const account = result.rows[0];
    const [balances, orders, fills] = await Promise.all([
      db.query('SELECT asset, available, locked FROM vex2_balances WHERE account_id=$1 ORDER BY asset', [account.id]),
      db.query("SELECT id, market, side, price, quantity, remaining, status, created_at FROM vex2_orders WHERE account_id=$1 AND status IN ('open','partially_filled') ORDER BY created_at DESC LIMIT 100", [account.id]),
      db.query(
        `SELECT f.id, f.market, f.price, f.quantity, f.created_at,
                CASE WHEN o.id = f.buy_order THEN 'buy' ELSE 'sell' END AS side
         FROM vex2_fills f
         JOIN vex2_orders o ON o.id IN (f.buy_order, f.sell_order)
         WHERE o.account_id=$1
         ORDER BY f.created_at DESC LIMIT 50`,
        [account.id]
      )
    ]);
    return res.status(200).json({ account, balances: balances.rows, openOrders: orders.rows, recentFills: fills.rows });
  } catch (error) {
    return sendUnavailable(res, error);
  }
}
