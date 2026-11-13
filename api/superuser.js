import { timingSafeEqual } from 'node:crypto';
import { getPool } from '../lib/db.js';
const fail=(res,status,error)=>res.status(status).json({error});
function authorized(req){
  const expected=process.env.VEXT_SUPERUSER_KEY||'';
  const supplied=String(req.headers['x-vext-admin-key']||'');
  if(!expected||!supplied) return false;
  const a=Buffer.from(expected),b=Buffer.from(supplied);
  return a.length===b.length&&timingSafeEqual(a,b);
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!authorized(req)) return fail(res,401,'Superuser authentication required.');
  if(req.method!=='GET') return fail(res,405,'Method not allowed');
  try{
    const db=getPool();
    const [accounts,markets,orders,fills,agents,agentsConfig]=await Promise.all([
      db.query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE handle LIKE 'guest_%')::int AS guests,
        MIN(created_at) AS first_created FROM vex2_accounts`),
      db.query(`SELECT symbol,enabled,last_price,updated_at FROM vex2_markets ORDER BY symbol`),
      db.query(`SELECT COUNT(*)::int AS open_orders FROM vex2_orders WHERE status IN ('open','partially_filled')`),
      db.query(`SELECT COUNT(*)::int AS fills_24h,COALESCE(SUM(price*quantity),0)::text AS volume_24h
        FROM vex2_fills WHERE created_at>NOW()-INTERVAL '24 hours'`),
      db.query(`SELECT a.handle,COUNT(DISTINCT o.id)::int AS open_orders,COUNT(DISTINCT f.id)::int AS fills
        FROM vex2_accounts a LEFT JOIN vex2_orders o ON o.account_id=a.id AND o.status IN ('open','partially_filled')
        LEFT JOIN vex2_fills f ON f.buyer_account_id=a.id OR f.seller_account_id=a.id
        WHERE a.handle LIKE 'system_vext_%' GROUP BY a.handle ORDER BY a.handle`),
      db.query(`SELECT agent,enabled,updated_at,updated_by FROM vex2_agent_config ORDER BY agent`)
    ]);
    await db.query(`INSERT INTO vex2_admin_audit(action,details) VALUES('dashboard_view',$1::jsonb)`,[JSON.stringify({ipHint:'not-recorded'})]);
    return res.status(200).json({mode:'simulation-only',accounts:accounts.rows[0],markets:markets.rows,
      openOrders:orders.rows[0].open_orders,activity:fills.rows[0],agents:agents.rows,agentControls:agentsConfig.rows});
  }catch(e){
    if(e?.code==='42P01') return fail(res,503,'Apply VEXT migrations 004 and 006 on the isolated Preview database.');
    console.error('VEXT admin API:',e?.message||e);
    return fail(res,503,'Superuser dashboard unavailable.');
  }
}
