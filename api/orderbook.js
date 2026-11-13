import { getPool } from '../lib/db.js';
const fail=(res,status,error)=>res.status(status).json({error});
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return fail(res,405,'Method not allowed');
  const market=String(req.query?.market||'CCC-KRW');
  try{
    const db=getPool();
    const m=await db.query('SELECT symbol FROM vex2_markets WHERE symbol=$1 AND enabled=true',[market]);
    if(!m.rowCount) return fail(res,404,'Unknown market.');
    const r=await db.query(`SELECT side,price,SUM(remaining)::text AS quantity,COUNT(*)::int AS order_count
      FROM vex2_orders WHERE market=$1 AND status IN ('open','partially_filled') AND remaining>0
      GROUP BY side,price ORDER BY CASE WHEN side='buy' THEN 0 ELSE 1 END,
      CASE WHEN side='buy' THEN price END DESC,CASE WHEN side='sell' THEN price END ASC LIMIT 40`,[market]);
    return res.status(200).json({market,levels:r.rows});
  }catch(e){console.error('VEXT orderbook API:',e?.message||e);return fail(res,503,'Order book temporarily unavailable.')}
}
