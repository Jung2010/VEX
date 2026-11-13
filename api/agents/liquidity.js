import { getPool } from '../../lib/db.js';
import { planLiquidityQuotes } from '../../lib/liquidity-agent.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const market = String(req.query?.market || 'CCC-KRW');
    const db = getPool();
    const result = await db.query(
      'SELECT symbol,last_price FROM vex2_markets WHERE symbol=$1 AND enabled=true LIMIT 1',
      [market]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Unknown or disabled market.' });
    const quote = planLiquidityQuotes({
      referencePrice: String(result.rows[0].last_price),
      inventory: 0,
      targetInventory: 0,
      inventoryLimit: 100,
      halfSpreadBps: 35,
      volatilityBps: 0,
      maxSpreadBps: 250,
      baseQuantity: 2,
      maxQuoteQuantity: 10
    });
    return res.status(200).json({
      market,
      agent: quote.agent,
      mode: 'simulation-only',
      execution: 'quote-preview-only',
      quote,
      note: 'Quotes are indicative simulated liquidity proposals; they are not resting orders and do not move balances.'
    });
  } catch (error) {
    if (error?.code === 'VEXT_DB_NOT_CONFIGURED' || error?.code === '42P01')
      return res.status(503).json({ error: 'Dedicated Preview database is required.' });
    console.error('VEXT liquidity agent failed:', error?.message || 'unknown');
    return res.status(503).json({ error: 'Liquidity agent temporarily unavailable.' });
  }
}
