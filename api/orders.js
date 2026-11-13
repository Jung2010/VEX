import { createHash } from 'node:crypto';
import { getPool } from '../lib/db.js';
import { validateLimitOrder, toUnits, fromUnits } from '../lib/matching.js';
const SCALE = 10n ** 10n;
const multiply = (a, b) => (a * b) / SCALE;

function tokenFrom(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
  return match?.[1] || null;
}
function fail(res, status, error) { return res.status(status).json({ error }); }
async function accountFor(db, token) {
  const hash = createHash('sha256').update(token).digest('hex');
  const r = await db.query(`SELECT a.id FROM vex2_account_sessions s
    JOIN vex2_accounts a ON a.id=s.account_id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>NOW() LIMIT 1`, [hash]);
  return r.rows[0]?.id || null;
}
function unavailable(res, e) {
  if (e?.code === 'VEX_PREVIEW_DB_NOT_CONFIGURED' || e?.code === '42P01')
    return fail(res, 503, 'Isolated Preview database and VEX migrations 001–003 are required.');
  console.error('VEX order API failed:', e?.code || e?.message || 'unknown');
  return fail(res, 503, 'Order service temporarily unavailable.');
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['POST','GET','DELETE'].includes(req.method)) return fail(res,405,'Method not allowed');
  const token=tokenFrom(req);
  if (!token) return fail(res,401,'A valid Bearer session token is required.');
  let db, client;
  try {
    db=getPool();
    if(req.method==='GET'){
      const accountId=await accountFor(db,token);
      if(!accountId) return fail(res,401,'Session is invalid or expired.');
      const market=String(req.query?.market||'CCC-KRW');
      const r=await db.query(`SELECT id,side,price,remaining,created_at FROM vex2_orders
        WHERE market=$1 AND status IN ('open','partially_filled')
        ORDER BY CASE WHEN side='buy' THEN price END DESC,
                 CASE WHEN side='sell' THEN price END ASC, created_at ASC, id ASC LIMIT 200`,[market]);
      return res.status(200).json({market,orders:r.rows});
    }
    client=await db.connect();
    await client.query('BEGIN');
    const accountId=await accountFor(client,token);
    if(!accountId){await client.query('ROLLBACK');return fail(res,401,'Session is invalid or expired.');}
    if(req.method==='DELETE'){
      const id=String(req.query?.id||'');
      const peek=await client.query(`SELECT market FROM vex2_orders
        WHERE id=$1 AND account_id=$2 AND status IN ('open','partially_filled')`,[id,accountId]);
      if(!peek.rowCount){await client.query('ROLLBACK');return fail(res,404,'Open order not found.');}
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[peek.rows[0].market]);
      const r=await client.query(`SELECT id,market,side,price,remaining FROM vex2_orders
        WHERE id=$1 AND account_id=$2 AND status IN ('open','partially_filled') FOR UPDATE`,[id,accountId]);
      if(!r.rowCount){await client.query('ROLLBACK');return fail(res,404,'Open order not found.');}
      const o=r.rows[0];
      const m=await client.query('SELECT base_asset,quote_asset FROM vex2_markets WHERE symbol=$1',[o.market]);
      if(!m.rowCount) throw new Error('Market missing');
      const asset=o.side==='buy'?m.rows[0].quote_asset:m.rows[0].base_asset;
      const refund=o.side==='buy'?fromUnits(multiply(toUnits(String(o.price)),toUnits(String(o.remaining)))):String(o.remaining);
      await client.query('UPDATE vex2_balances SET available=available+$3::numeric, locked=locked-$3::numeric WHERE account_id=$1 AND asset=$2',[accountId,asset,refund]);
      await client.query("UPDATE vex2_orders SET status='cancelled',remaining=0 WHERE id=$1",[id]);
      await client.query('COMMIT');
      return res.status(200).json({cancelled:true,id});
    }
    const body=req.body||{};
    let order;
    try { order=validateLimitOrder({market:body.market,side:body.side,price:String(body.price),quantity:String(body.quantity)}); }
    catch(e) { await client.query('ROLLBACK'); return fail(res,400,e.message||'Invalid limit order.'); }
    const key=String(body.idempotencyKey||'');
    if(!/^[A-Za-z0-9_-]{12,80}$/.test(key)) {await client.query('ROLLBACK');return fail(res,400,'idempotencyKey must be 12–80 URL-safe characters.');}
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[order.market]);
    const existing=await client.query('SELECT id,status,remaining FROM vex2_orders WHERE account_id=$1 AND idempotency_key=$2',[accountId,key]);
    if(existing.rowCount){await client.query('COMMIT');return res.status(200).json({order:existing.rows[0],duplicate:true});}
    const market=await client.query('SELECT base_asset,quote_asset FROM vex2_markets WHERE symbol=$1 AND enabled=true',[order.market]);
    if(!market.rowCount){await client.query('ROLLBACK');return fail(res,400,'Unknown or disabled market.');}
    const {base_asset:base,quote_asset:quote}=market.rows[0];
    const reserveAsset=order.side==='buy'?quote:base;
    const reserve=order.side==='buy'?fromUnits(multiply(order.priceUnits,order.quantityUnits)):String(body.quantity);
    const balance=await client.query('SELECT available FROM vex2_balances WHERE account_id=$1 AND asset=$2 FOR UPDATE',[accountId,reserveAsset]);
    if(!balance.rowCount||Number(balance.rows[0].available)<reserve){await client.query('ROLLBACK');return fail(res,400,'Insufficient available balance.');}
    await client.query('UPDATE vex2_balances SET available=available-$3::numeric,locked=locked+$3::numeric WHERE account_id=$1 AND asset=$2',[accountId,reserveAsset,reserve]);
    const inserted=await client.query(`INSERT INTO vex2_orders(account_id,market,side,price,quantity,remaining,status,idempotency_key)
      VALUES($1,$2,$3,$4,$5,$5,'open',$6) RETURNING id,account_id,market,side,price,quantity,remaining,status,created_at`,
      [accountId,order.market,order.side,String(body.price),String(body.quantity),key]);
    const incoming=inserted.rows[0];
    const opposite=order.side==='buy'?'sell':'buy';
    const sort=order.side==='buy'?'price ASC':'price DESC';
    const resting=await client.query(`SELECT id,account_id,side,price,remaining FROM vex2_orders
      WHERE market=$1 AND side=$2 AND status IN ('open','partially_filled') AND account_id<>$3
      AND remaining>0 AND (($4='buy' AND price<=$5) OR ($4='sell' AND price>=$5))
      ORDER BY ${sort},created_at ASC,id ASC FOR UPDATE`,
      [order.market,opposite,accountId,order.side,String(body.price)]);
    let remainingUnits=order.quantityUnits, filledUnits=0n;
    for(const maker of resting.rows){
      if(remainingUnits<=0n) break;
      const makerRemainingUnits=toUnits(String(maker.remaining));
      const qtyUnits=remainingUnits<makerRemainingUnits?remainingUnits:makerRemainingUnits;
      const priceUnits=toUnits(String(maker.price));
      const notionalUnits=multiply(priceUnits,qtyUnits);
      const qty=fromUnits(qtyUnits), notional=fromUnits(notionalUnits);
      const buyer=order.side==='buy'?accountId:Number(maker.account_id);
      const seller=order.side==='sell'?accountId:Number(maker.account_id);
      const buyerOrder=order.side==='buy'?incoming.id:maker.id;
      const sellerOrder=order.side==='sell'?incoming.id:maker.id;
      await client.query('UPDATE vex2_balances SET locked=locked-$3::numeric WHERE account_id=$1 AND asset=$2',[buyer,quote,notional]);
      await client.query('UPDATE vex2_balances SET available=available+$3::numeric WHERE account_id=$1 AND asset=$2',[buyer,base,qty]);
      await client.query('UPDATE vex2_balances SET locked=locked-$3::numeric WHERE account_id=$1 AND asset=$2',[seller,base,qty]);
      await client.query('UPDATE vex2_balances SET available=available+$3::numeric WHERE account_id=$1 AND asset=$2',[seller,quote,notional]);
      if(order.side==='buy' && order.priceUnits>priceUnits){
        const improvement=fromUnits(multiply(order.priceUnits-priceUnits,qtyUnits));
        await client.query('UPDATE vex2_balances SET locked=locked-$3::numeric,available=available+$3::numeric WHERE account_id=$1 AND asset=$2',[accountId,quote,improvement]);
      }
      const makerRemaining=makerRemainingUnits-qtyUnits;
      await client.query("UPDATE vex2_orders SET remaining=$2::numeric,status=$3 WHERE id=$1",[maker.id,fromUnits(makerRemaining),makerRemaining===0n?'filled':'partially_filled']);
      remainingUnits-=qtyUnits;filledUnits+=qtyUnits;
      await client.query(`INSERT INTO vex2_fills(market,price,quantity,buy_order,sell_order,buyer_account_id,seller_account_id)
        VALUES($1,$2::numeric,$3::numeric,$4,$5,$6,$7)`,[order.market,String(maker.price),qty,buyerOrder,sellerOrder,buyer,seller]);
    }
    const status=remainingUnits===0n?'filled':filledUnits>0n?'partially_filled':'open';
    const remaining=fromUnits(remainingUnits), filled=fromUnits(filledUnits);
    await client.query('UPDATE vex2_orders SET remaining=$2::numeric,status=$3 WHERE id=$1',[incoming.id,remaining,status]);
    await client.query('UPDATE vex2_markets SET last_price=COALESCE((SELECT price FROM vex2_fills WHERE market=$1 ORDER BY id DESC LIMIT 1),last_price),updated_at=NOW() WHERE symbol=$1',[order.market]);
    await client.query('COMMIT');
    return res.status(201).json({order:{id:incoming.id,market:order.market,side:order.side,price:String(body.price),quantity:String(body.quantity),filledQuantity:filled,remainingQuantity:remaining,status}});
  }catch(e){if(client)try{await client.query('ROLLBACK')}catch{}return unavailable(res,e)}
  finally{client?.release()}
}
