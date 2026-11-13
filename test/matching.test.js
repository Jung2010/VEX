import test from 'node:test';
import assert from 'node:assert/strict';
import { planMatches, toUnits, fromUnits, validateLimitOrder } from '../lib/matching.js';

const sell = (id, price, quantity, createdAt = '2026-01-01T00:00:00Z') => ({ id, market: 'CCC-KRW', side: 'sell', price, quantity, createdAt });

test('fixed precision conversion avoids floating point arithmetic', () => {
  assert.equal(fromUnits(toUnits('0.1000000001')), '0.1000000001');
  assert.throws(() => toUnits('1.00000000001'));
});

test('buy matches lowest ask first and uses resting price', () => {
  const result = planMatches(
    { market: 'CCC-KRW', side: 'buy', price: '10', quantity: '4' },
    [sell('later', '9', '2', '2026-01-02'), sell('best', '8', '1'), sell('last', '10', '2')]
  );
  assert.deepEqual(result.fills, [
    { restingOrderId: 'best', price: '8', quantity: '1' },
    { restingOrderId: 'later', price: '9', quantity: '2' },
    { restingOrderId: 'last', price: '10', quantity: '1' }
  ]);
  assert.equal(result.filledQuantity, '4');
  assert.equal(result.remainingQuantity, '0');
  assert.equal(result.status, 'filled');
});

test('same price uses time priority and leaves an unfilled remainder', () => {
  const result = planMatches(
    { market: 'CCC-KRW', side: 'buy', price: '5', quantity: '3' },
    [sell('second', '5', '1', '2026-01-02'), sell('first', '5', '1', '2026-01-01')]
  );
  assert.deepEqual(result.fills.map(x => x.restingOrderId), ['first', 'second']);
  assert.equal(result.remainingQuantity, '1');
  assert.equal(result.status, 'partially_filled');
});

test('non-crossing, other-market and same-side orders do not match', () => {
  const result = planMatches(
    { market: 'CCC-KRW', side: 'buy', price: '4', quantity: '1' },
    [sell('high', '5', '1'), { id: 'other', market: 'TOLR-CCC', side: 'sell', price: '2', quantity: '1' }, { id: 'same', market: 'CCC-KRW', side: 'buy', price: '1', quantity: '1' }]
  );
  assert.equal(result.fills.length, 0);
  assert.equal(result.status, 'open');
});

test('rejects invalid order fields', () => {
  assert.throws(() => validateLimitOrder({ market: 'CCC-KRW', side: 'market', price: '1', quantity: '1' }));
  assert.throws(() => validateLimitOrder({ market: 'CCC-KRW', side: 'buy', price: '-1', quantity: '1' }));
});
