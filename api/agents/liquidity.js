import { getPool } from '../../lib/db.js';
import { planLiquidityQuotes } from '../../lib/liquidity-agent.js';
import { toUnits, fromUnits } from '../../lib/matching.js';

const AGENT_HANDLE = 'system_vext_liquidity_desk';
const AGENT_NAME = 'VEXT Liquidity Desk';
const STARTING = { KRW: '5000000', CCC: '1000', TOLR: '1000', SECX: '500' };
const SCALE = 10n ** 10n;
const mul = (a, b) => (a * b) / SCALE;
const fail = (res, status, error) => res.status(status).json({ error });

async function ensureAgent(client) {
  const result = await client.query(
    'INSERT INTO vex2_accounts(handle) VALUES ($1) ON CONFLICT(handle) DO UPDATE SET handle=EXCLUDED.handle RETURNING id,handle',
    [AGENT_HANDLE]
  );
  const id = result.rows[0].id;
  for (const [asset, amount] of Object.entries(STARTING)) {
    await client.query(
      'INSERT INTO vex2_balances(account_id,asset,available,locked) VALUES ($1,$2,$3,0) ON CONFLICT(account_id,asset) DO NOTHING',
      [id, asset, amount]
    );
  }
  return { id, handle: result.rows[0].handle };
}

async function cancelAgentQuotes(client, accountId, market) {
  const orders = await client.query(
    "SELECT id,side,price,remaining FROM vex2_orders WHERE account_id=$1 AND market=$2 AND status IN ('open','partially_filled') AND remaining>0 FOR UPDATE",
    [accountId, market]
  );
  const pair = await client.query('SELECT base_asset,quote_asset FROM vex2_markets WHERE symbol=$1', [market]);
  const { base_asset: base, quote_asset: quoteAsset } = pair.rows[0];
  for (const order of orders.rows) {
    const asset = order.side === 'buy' ? quoteAsset : base;
    const refund = order.side === 'buy'
      ? fromUnits(mul(toUnits(String(order.price)), toUnits(String(order.remaining))))
      : String(order.remaining);
    await client.query(
      'UPDATE vex2_balances SET available=available+$3::numeric,locked=locked-$3::numeric WHERE account_id=$1 AND asset=$2',
      [accountId, asset, refund]
    );
    await client.query("UPDATE vex2_orders SET status='cancelled',remaining=0 WHERE id=$1", [order.id]);
  }
  return orders.rowCount;
}

export async function runLiquidityAgent(client, market) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [market]);
  const m = await client.query(
    'SELECT symbol,base_asset,quote_asset,last_price FROM vex2_markets WHERE symbol=$1 AND enabled=true FOR UPDATE',
    [market]
  );
  if (!m.rowCount) {
    const error = new Error('Unknown or disabled market.');
    error.status = 404;
    throw error;
  }
  const { base_asset: base, quote_asset: quoteAsset, last_price: referencePrice } = m.rows[0];
  const agent = await ensureAgent(client);
  const cancelled = await cancelAgentQuotes(client, agent.id, market);
  await client.query(`INSERT INTO vex2_agent_positions
    (account_id,market,base_asset,quote_asset,base_quantity,average_cost)
    SELECT $1,$2,$3,$4,b.available+b.locked,$5
    FROM vex2_balances b WHERE b.account_id=$1 AND b.asset=$3
    ON CONFLICT(account_id,market) DO NOTHING`,
    [agent.id,market,base,quoteAsset,String(referencePrice)]);
  const balances = await client.query(
    'SELECT asset,available,locked FROM vex2_balances WHERE account_id=$1 AND asset IN ($2,$3) FOR UPDATE',
    [agent.id, base, quoteAsset]
  );
  const byAsset = Object.fromEntries(balances.rows.map(x => [x.asset, x]));
  let baseAvailable = toUnits(String(byAsset[base]?.available || '0'));
  let quoteAvailable = toUnits(String(byAsset[quoteAsset]?.available || '0'));
  const inventoryUnits = baseAvailable + toUnits(String(byAsset[base]?.locked || '0'));
  const inventory = Number(fromUnits(inventoryUnits));
  const plan = planLiquidityQuotes({
    referencePrice: String(referencePrice),
    inventory,
    targetInventory: 500,
    inventoryLimit: 1000,
    halfSpreadBps: 35,
    volatilityBps: 0,
    maxSpreadBps: 250,
    baseQuantity: 2,
    maxQuoteQuantity: 10
  });
  const bestAsk = await client.query(
    "SELECT MIN(price) AS price FROM vex2_orders WHERE market=$1 AND side='sell' AND status IN ('open','partially_filled') AND remaining>0 AND account_id<>$2",
    [market, agent.id]
  );
  const bestBid = await client.query(
    "SELECT MAX(price) AS price FROM vex2_orders WHERE market=$1 AND side='buy' AND status IN ('open','partially_filled') AND remaining>0 AND account_id<>$2",
    [market, agent.id]
  );
  const bidPrice = plan.bid ? toUnits(plan.bid.price) : 0n;
  const askPrice = plan.ask ? toUnits(plan.ask.price) : 0n;
  let bidQty = plan.bid ? toUnits(plan.bid.quantity) : 0n;
  let askQty = plan.ask ? toUnits(plan.ask.quantity) : 0n;
  if (bidQty > 0n && quoteAvailable > 0n) {
    const affordable = quoteAvailable * SCALE / bidPrice;
    if (bidQty > affordable) bidQty = affordable;
  } else bidQty = 0n;
  if (askQty > baseAvailable) askQty = baseAvailable;
  if (bestAsk.rows[0]?.price && bidPrice >= toUnits(String(bestAsk.rows[0].price))) bidQty = 0n;
  if (bestBid.rows[0]?.price && askPrice <= toUnits(String(bestBid.rows[0].price))) askQty = 0n;

  const proposals = [];
  const levels = 5;
  const halfSpreadBps = 35;
  const stepBps = 20;
  for (let level = 0; level < levels; level++) {
    const bidLevelPrice = toUnits(String(plan.bid?.price || referencePrice)) * (10000n - BigInt(level * stepBps)) / 10000n;
    const askLevelPrice = toUnits(String(plan.ask?.price || referencePrice)) * (10000n + BigInt(level * stepBps)) / 10000n;
    let bidLevelQty = plan.bid ? toUnits('2') : 0n;
    let askLevelQty = plan.ask ? toUnits('2') : 0n;
    if (bestAsk.rows[0]?.price && bidLevelPrice >= toUnits(String(bestAsk.rows[0].price))) bidLevelQty = 0n;
    if (bestBid.rows[0]?.price && askLevelPrice <= toUnits(String(bestBid.rows[0].price))) askLevelQty = 0n;
    if (askLevelQty > baseAvailable) askLevelQty = baseAvailable;
    if (bidLevelQty > 0n) {
      const reserve = mul(bidLevelPrice, bidLevelQty);
      if (reserve > quoteAvailable) bidLevelQty = quoteAvailable * SCALE / bidLevelPrice;
    }
    const sides = [
      bidLevelQty > 0n ? {side:'buy',price:bidLevelPrice,quantity:bidLevelQty,asset:quoteAsset,reserve:mul(bidLevelPrice,bidLevelQty)} : null,
      askLevelQty > 0n ? {side:'sell',price:askLevelPrice,quantity:askLevelQty,asset:base,reserve:askLevelQty} : null
    ].filter(Boolean);
    for (const item of sides) {
      const reserveText = fromUnits(item.reserve);
      const qtyText = fromUnits(item.quantity);
      const priceText = fromUnits(item.price);
      await client.query(
        'UPDATE vex2_balances SET available=available-$3::numeric,locked=locked+$3::numeric WHERE account_id=$1 AND asset=$2',
        [agent.id,item.asset,reserveText]
      );
      const key = `liq_${market.replace('-', '_')}_${item.side}_${Date.now()}_${level}_${Math.random().toString(36).slice(2,7)}`;
      const inserted = await client.query(
        "INSERT INTO vex2_orders(account_id,market,side,price,quantity,remaining,status,idempotency_key) VALUES($1,$2,$3,$4,$5,$5,'open',$6) RETURNING id,side,price,quantity,remaining",
        [agent.id,market,item.side,priceText,qtyText,key]
      );
      proposals.push(inserted.rows[0]);
      if(item.side==='buy') quoteAvailable -= item.reserve;
      else baseAvailable -= item.reserve;
    }
  }
  const inventorySnapshot = {
    [base]: fromUnits(inventoryUnits),
    [quoteAsset]: String(byAsset[quoteAsset]?.available || '0')
  };
  await client.query(
    "INSERT INTO vex2_agent_state(agent,inventory,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(agent) DO UPDATE SET inventory=EXCLUDED.inventory,updated_at=NOW()",
    [AGENT_NAME, JSON.stringify(inventorySnapshot)]
  );
  return {
    agent: { ...agent, name: AGENT_NAME },
    market,
    mode: 'simulation-only',
    execution: 'autonomous-multilevel-virtual-resting-orders',
    quoteLevels: levels,
    cancelledPreviousQuotes: cancelled,
    orders: proposals,
    quotePlan: plan,
    status: proposals.length ? 'quoting' : 'inventory-or-book-limited'
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) return fail(res, 405, 'Method not allowed');
  const market = String(req.query?.market || req.body?.market || 'CCC-KRW');
  let client;
  try {
    const db = getPool();
    if (req.method === 'GET') {
      const m = await db.query('SELECT symbol,last_price FROM vex2_markets WHERE symbol=$1 AND enabled=true', [market]);
      if (!m.rowCount) return fail(res, 404, 'Unknown or disabled market.');
      const a = await db.query(
        "SELECT a.id,a.handle,b.asset,b.available,b.locked FROM vex2_accounts a JOIN vex2_balances b ON b.account_id=a.id WHERE a.handle=$1 ORDER BY b.asset",
        [AGENT_HANDLE]
      );
      const agentId = a.rows[0]?.id;
      const orders = agentId ? await db.query(
        "SELECT id,market,side,price,quantity,remaining,status,created_at FROM vex2_orders WHERE account_id=$1 AND market=$2 AND status IN ('open','partially_filled') ORDER BY side,price",
        [agentId, market]
      ) : { rows: [] };
      const fills = agentId ? await db.query(
        "SELECT COUNT(*)::int AS fill_count,COALESCE(SUM(quantity),0)::text AS traded_base,COALESCE(SUM(price*quantity),0)::text AS traded_quote FROM vex2_fills WHERE market=$2 AND (buyer_account_id=$1 OR seller_account_id=$1)",
        [agentId, market]
      ) : { rows: [{ fill_count: 0, traded_base: '0', traded_quote: '0' }] };
      const positionResult = agentId ? await db.query(
        'SELECT base_quantity,average_cost,realized_pnl,bought_quantity,sold_quantity FROM vex2_agent_positions WHERE account_id=$1 AND market=$2',
        [agentId,market]
      ) : {rows:[]};
      const position = positionResult.rows[0] || {base_quantity:'0',average_cost:'0',realized_pnl:'0',bought_quantity:'0',sold_quantity:'0'};
      const balanceMap = Object.fromEntries(a.rows.map(x => [x.asset, x]));
      const baseAsset = m.rows[0].symbol.split('-')[0];
      const quoteAsset = m.rows[0].symbol.split('-')[1];
      const baseTotal = Number(balanceMap[baseAsset]?.available || 0) + Number(balanceMap[baseAsset]?.locked || 0);
      const quoteTotal = Number(balanceMap[quoteAsset]?.available || 0) + Number(balanceMap[quoteAsset]?.locked || 0);
      const markedBaseValue = baseTotal * Number(m.rows[0].last_price);
      const fillStats = fills.rows[0] || { fill_count: 0, traded_base: '0', traded_quote: '0' };
      return res.status(200).json({
        market, agent: AGENT_NAME, mode: 'simulation-only',
        execution: 'status-only', balances: a.rows, orders: orders.rows,
        metrics: {
          openOrderCount: orders.rowCount,
          fillCount: fillStats.fill_count,
          tradedBase: fillStats.traded_base,
          tradedQuote: fillStats.traded_quote,
          baseInventory: String(baseTotal),
          quoteInventory: String(quoteTotal),
          markedBaseValue: String(markedBaseValue),
          indicativeEquity: String(quoteTotal + markedBaseValue),
          accounting: {
            method: 'weighted-average-cost',
            baseline: 'Opening inventory valued at first accounting snapshot; earlier realized P&L is not reconstructed.',
            baseQuantity: position.base_quantity,
            averageCost: position.average_cost,
            realizedPnl: position.realized_pnl,
            unrealizedPnl: String((baseTotal * Number(m.rows[0].last_price)) - (baseTotal * Number(position.average_cost))),
            boughtQuantity: position.bought_quantity,
            soldQuantity: position.sold_quantity
          },
          valuationNote: 'Indicative market-value snapshot; realized and unrealized P&L are tracked separately.'
        }
      });
    }
    client = await db.connect();
    await client.query('BEGIN');
    const result = await runLiquidityAgent(client, market);
    await client.query('COMMIT');
    return res.status(200).json(result);
  } catch (error) {
    if (client) try { await client.query('ROLLBACK'); } catch {}
    if (error?.status) return fail(res, error.status, error.message);
    if (error?.code === 'VEXT_DB_NOT_CONFIGURED' || error?.code === '42P01')
      return fail(res, 503, 'Dedicated Preview database and VEXT migrations 001–004 are required.');
    console.error('VEXT liquidity agent failed:', error?.stack || error?.message || 'unknown');
    return fail(res, 503, 'Liquidity agent temporarily unavailable.');
  } finally {
    client?.release();
  }
}
