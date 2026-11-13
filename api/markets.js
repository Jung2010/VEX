import { getPool } from '../lib/db.js';
export default async function handler(req, res) {
  try {
    const db = getPool();
    const [a, m] = await Promise.all([
      db.query("SELECT code,name,kind FROM vex2_assets WHERE enabled=true ORDER BY CASE code WHEN 'USD' THEN 0 WHEN 'CCC' THEN 1 WHEN 'TOLR' THEN 2 ELSE 3 END"),
      db.query('SELECT symbol,base_asset,quote_asset,last_price,updated_at FROM vex2_markets WHERE enabled=true ORDER BY symbol')
    ]);
    res.status(200).json({ assets: a.rows, markets: m.rows, agents: ['VEX Liquidity Desk','Pulse Agent','Anchor Agent'], mode: 'simulation-only' });
  } catch (e) { res.status(503).json({ error: 'Market data unavailable' }); }
}
