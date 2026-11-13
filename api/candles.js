import { getPool } from '../lib/db.js';
const fail=(res,status,error)=>res.status(status).json({error});
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return fail(res,405,'Method not allowed');
  const market=String(req.query?.market||'CCC-KRW');
  const interval=Number(req.query?.interval||60);
  const limit=Math.min(500,Math.max(10,Number(req.query?.limit||180)));
  if(![60,300,900,3600].includes(interval)) return fail(res,400,'Unsupported candle interval.');
  try{
    const db=getPool();
    const m=await db.query('SELECT last_price FROM vex2_markets WHERE symbol=$1 AND enabled=true',[market]);
    if(!m.rowCount) return fail(res,404,'Unknown market.');
    const r=await db.query(`SELECT bucket_at,open,high,low,close,volume,trade_count
      FROM vex2_market_candles WHERE market=$1 AND interval_seconds=$2
      ORDER BY bucket_at DESC LIMIT $3`,[market,interval,limit]);
    return res.status(200).json({market,interval,candles:r.rows.reverse(),lastPrice:String(m.rows[0].last_price),source:'simulated-fills'});
  }catch(e){
    if(e?.code==='42P01') return fail(res,503,'Apply VEXT migration 004 on the isolated Preview database.');
    console.error('VEXT candles API:',e?.message||e);
    return fail(res,503,'Market chart temporarily unavailable.');
  }
}
