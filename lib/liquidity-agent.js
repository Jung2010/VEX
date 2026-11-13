const SCALE = 10n ** 10n;
const units = value => {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,10})?$/.test(text)) throw new Error('Invalid decimal value');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * SCALE + BigInt((fraction + '0'.repeat(10)).slice(0, 10));
};
const decimal = value => {
  const whole = value / SCALE;
  const fraction = String(value % SCALE).padStart(10, '0').replace(/0+$/, '');
  return fraction ? whole + '.' + fraction : String(whole);
};

/**
 * Deterministic, simulation-only market-making quote planner.
 * It proposes quotes; it does not submit orders or move balances.
 */
export function planLiquidityQuotes({
  referencePrice,
  inventory = 0,
  targetInventory = 0,
  inventoryLimit = 100,
  halfSpreadBps = 35,
  volatilityBps = 0,
  maxSpreadBps = 250,
  baseQuantity = 1,
  maxQuoteQuantity = 10
}) {
  const ref = units(referencePrice);
  const inv = Number(inventory), target = Number(targetInventory);
  const limit = Number(inventoryLimit), baseQty = Number(baseQuantity);
  const maxQty = Number(maxQuoteQuantity);
  const half = Number(halfSpreadBps), vol = Number(volatilityBps), cap = Number(maxSpreadBps);
  if (ref <= 0n || ![inv,target,limit,baseQty,maxQty,half,vol,cap].every(Number.isFinite) ||
      limit <= 0 || baseQty <= 0 || maxQty <= 0 || half <= 0 || vol < 0 || cap < half ||
      Math.abs(inv) > limit) throw new Error('Invalid liquidity-agent risk configuration');

  const skew = Math.max(-half * 0.75, Math.min(half * 0.75, ((inv - target) / limit) * half * 0.75));
  const effectiveHalf = Math.min(cap, half + vol * 0.5);
  const bidBps = Math.max(1, effectiveHalf + skew);
  const askBps = Math.max(1, effectiveHalf - skew);
  const bid = ref * BigInt(Math.round(1_000_000 - bidBps * 100)) / 1_000_000n;
  const ask = ref * BigInt(Math.round(1_000_000 + askBps * 100)) / 1_000_000n;
  const inventoryRatio = Math.max(0, Math.min(1, (limit - Math.max(0, inv - target)) / limit));
  const bidQty = Math.min(maxQty, baseQty * inventoryRatio);
  const askCapacity = Math.max(0, Math.min(1, (limit + Math.min(0, inv - target)) / limit));
  const askQty = Math.min(maxQty, baseQty * askCapacity);
  return {
    agent: 'VEXT Liquidity Desk',
    marketMode: 'simulation-only',
    referencePrice: decimal(ref),
    bid: bidQty > 0 ? { price: decimal(bid), quantity: String(Number(bidQty.toFixed(8))) } : null,
    ask: askQty > 0 ? { price: decimal(ask), quantity: String(Number(askQty.toFixed(8))) } : null,
    spreadBps: Number((bidBps + askBps).toFixed(2)),
    inventorySkewBps: Number(skew.toFixed(2)),
    status: bidQty > 0 || askQty > 0 ? 'quoting' : 'inventory-limited'
  };
}
