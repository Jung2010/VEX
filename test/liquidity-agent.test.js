import test from 'node:test';
import assert from 'node:assert/strict';
import { planLiquidityQuotes } from '../lib/liquidity-agent.js';

test('liquidity desk quotes both sides around reference price', () => {
  const q = planLiquidityQuotes({ referencePrice: '1000', baseQuantity: 2 });
  assert.equal(q.agent, 'VEXT Liquidity Desk');
  assert.equal(q.marketMode, 'simulation-only');
  assert.ok(Number(q.bid.price) < 1000);
  assert.ok(Number(q.ask.price) > 1000);
  assert.ok(Number(q.bid.quantity) > 0);
  assert.ok(Number(q.ask.quantity) > 0);
});

test('inventory above target skews quotes to reduce inventory', () => {
  const neutral = planLiquidityQuotes({ referencePrice: '1000', inventory: 0 });
  const long = planLiquidityQuotes({ referencePrice: '1000', inventory: 80 });
  assert.ok(Number(long.bid.price) < Number(neutral.bid.price));
  assert.ok(Number(long.ask.price) < Number(neutral.ask.price));
  assert.ok(Number(long.bid.quantity) < Number(neutral.bid.quantity));
});

test('volatility widens the spread within configured cap', () => {
  const calm = planLiquidityQuotes({ referencePrice: '1000', volatilityBps: 0 });
  const volatile = planLiquidityQuotes({ referencePrice: '1000', volatilityBps: 80 });
  assert.ok(volatile.spreadBps > calm.spreadBps);
  assert.ok(volatile.spreadBps <= 500);
});

test('agent stops quoting the exhausted inventory side', () => {
  const q = planLiquidityQuotes({ referencePrice: '1000', inventory: 100, inventoryLimit: 100 });
  assert.equal(q.bid, null);
  assert.ok(q.ask);
});

test('agent rejects invalid or out-of-limit risk inputs', () => {
  assert.throws(() => planLiquidityQuotes({ referencePrice: '0' }));
  assert.throws(() => planLiquidityQuotes({ referencePrice: '1000', inventory: 101, inventoryLimit: 100 }));
});
