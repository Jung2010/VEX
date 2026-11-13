const assets = [
  { code: 'KRW', name: 'Simulated Korean Won', kind: 'fiat' },
  { code: 'CCC', name: 'Central Charging Coin', kind: 'crypto' },
  { code: 'TOLR', name: 'Tolerancer', kind: 'crypto' },
  { code: 'SECX', name: 'Secure', kind: 'crypto' }
];
const markets = [
  { symbol: 'CCC-KRW', base_asset: 'CCC', quote_asset: 'KRW', last_price: '1000.0000000000' },
  { symbol: 'TOLR-CCC', base_asset: 'TOLR', quote_asset: 'CCC', last_price: '0.2500000000' },
  { symbol: 'SECX-CCC', base_asset: 'SECX', quote_asset: 'CCC', last_price: '2.0000000000' }
];
const agents = ['VEX Liquidity Desk', 'Pulse Agent', 'Anchor Agent'];

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { getPool } = await import('../lib/db.js');
    const db = getPool();
    const [a, m] = await Promise.all([
      db.query("SELECT code,name,kind FROM vex2_assets WHERE enabled=true ORDER BY CASE code WHEN 'KRW' THEN 0 WHEN 'CCC' THEN 1 WHEN 'TOLR' THEN 2 ELSE 3 END"),
      db.query('SELECT symbol,base_asset,quote_asset,last_price,updated_at FROM vex2_markets WHERE enabled=true ORDER BY symbol')
    ]);
    return res.status(200).json({ assets: a.rows, markets: m.rows, agents, mode: 'simulation-only', dataSource: 'database' });
  } catch (e) {
    if (e?.code === '42P01' || e?.code === 'VEXT_DB_NOT_CONFIGURED') {
      return res.status(200).json({
        assets, markets, agents, mode: 'simulation-only', dataSource: 'preview-seed',
        notice: e.code === '42P01'
          ? 'Preview schema has not been initialized; showing static preview data.'
          : 'Dedicated Preview database is not configured; showing static preview data.'
      });
    }
    console.error('VEX markets API failed:', e?.code || 'unknown');
    return res.status(503).json({ error: 'Market data unavailable' });
  }
}
