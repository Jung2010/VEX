import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountHandler } from '../api/account.js';
import { createOrdersHandler } from '../api/orders.js';

function response() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function request(method, { headers = {}, body = {}, query = {} } = {}) {
  return { method, headers, body, query };
}

function fakePool({ accountId = 41, failAt = null } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql).trim(), params });
      if (failAt && String(sql).includes(failAt)) throw new Error('injected database failure');
      if (String(sql).includes('INSERT INTO vex2_accounts')) {
        return { rows: [{ id: accountId, handle: 'guest_test', created_at: '2026-11-14T00:00:00Z' }], rowCount: 1 };
      }
      if (String(sql).includes('SELECT a.id FROM vex2_account_sessions')) {
        return { rows: [{ id: accountId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() { calls.push({ sql: 'RELEASE', params: [] }); }
  };
  return {
    calls,
    pool: {
      async connect() { return client; },
      async query(sql, params = []) {
        calls.push({ sql: String(sql).trim(), params });
        return { rows: [], rowCount: 0 };
      }
    }
  };
}

test('account POST creates a guest account in one committed transaction', async () => {
  const fake = fakePool();
  const handler = createAccountHandler(() => fake.pool);
  const res = response();
  await handler(request('POST'), res);
  assert.equal(res.statusCode, 201);
  assert.match(res.body.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(res.body.expiresInDays, 30);
  assert.deepEqual(res.body.balances.map(x => x.asset).sort(), ['CCC', 'KRW', 'SECX', 'TOLR']);
  assert.ok(fake.calls.some(x => x.sql === 'BEGIN'));
  assert.ok(fake.calls.some(x => x.sql === 'COMMIT'));
  assert.equal(fake.calls.filter(x => x.sql.startsWith('INSERT INTO vex2_balances')).length, 4);
  assert.ok(fake.calls.some(x => x.sql.includes('INSERT INTO vex2_account_sessions')));
});

test('account GET rejects a missing bearer token without opening the database', async () => {
  const handler = createAccountHandler(() => { throw new Error('must not connect'); });
  const res = response();
  await handler(request('GET'), res);
  assert.equal(res.statusCode, 401);
});

test('account API rejects unsupported methods', async () => {
  const handler = createAccountHandler(() => { throw new Error('must not connect'); });
  const res = response();
  await handler(request('DELETE'), res);
  assert.equal(res.statusCode, 405);
});

test('orders API rejects missing bearer token before database access', async () => {
  const handler = createOrdersHandler(() => { throw new Error('must not connect'); });
  const res = response();
  await handler(request('POST'), res);
  assert.equal(res.statusCode, 401);
});

test('orders API rolls back invalid order input', async () => {
  const fake = fakePool();
  const handler = createOrdersHandler(() => fake.pool);
  const res = response();
  await handler(request('POST', {
    headers: { authorization: 'Bearer ' + 'x'.repeat(43) },
    body: { market: 'CCC-KRW', side: 'buy', price: '0', quantity: '1', idempotencyKey: 'test-order-key-001' }
  }), res);
  assert.equal(res.statusCode, 400);
  assert.ok(fake.calls.some(x => x.sql === 'BEGIN'));
  assert.ok(fake.calls.some(x => x.sql === 'ROLLBACK'));
  assert.ok(!fake.calls.some(x => x.sql.startsWith('INSERT INTO vex2_orders')));
});

test('orders API rejects malformed idempotency keys and rolls back', async () => {
  const fake = fakePool();
  const handler = createOrdersHandler(() => fake.pool);
  const res = response();
  await handler(request('POST', {
    headers: { authorization: 'Bearer ' + 'x'.repeat(43) },
    body: { market: 'CCC-KRW', side: 'buy', price: '1000', quantity: '1', idempotencyKey: 'bad' }
  }), res);
  assert.equal(res.statusCode, 400);
  assert.ok(fake.calls.some(x => x.sql === 'ROLLBACK'));
});

test('account API returns a controlled 503 when the Preview database is unavailable', async () => {
  const handler = createAccountHandler(() => {
    const error = new Error('unavailable');
    error.code = 'VEXT_DB_NOT_CONFIGURED';
    throw error;
  });
  const res = response();
  await handler(request('POST'), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'VEXT_DB_NOT_CONFIGURED');
});


test('orders API matches a buy against a resting sell at maker price', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const q = String(sql).trim();
      calls.push({ q, params });
      if (q.includes('SELECT a.id FROM vex2_account_sessions')) return { rows: [{ id: 41 }], rowCount: 1 };
      if (/FROM\s+vex2_markets/i.test(q)) return { rows: [{ base_asset: 'CCC', quote_asset: 'KRW' }], rowCount: 1 };
      if (q.includes('SELECT available FROM vex2_balances')) return { rows: [{ available: '950' }], rowCount: 1 };
      if (q.includes('SELECT id FROM vex2_orders WHERE account_id=$1')) return { rows: [], rowCount: 0 };
      if (q.includes('INSERT INTO vex2_orders')) return { rows: [{ id: 22, account_id: 41, market: 'CCC-KRW', side: 'buy', price: '1000', quantity: '1', remaining: '1', status: 'open' }], rowCount: 1 };
      if (/SELECT\s+id\s*,\s*account_id\s*,\s*side\s*,\s*price\s*,\s*remaining\s+FROM\s+vex2_orders/i.test(q)) return { rows: [{ id: 11, account_id: 77, side: 'sell', price: '900', remaining: '1' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() { calls.push({ q: 'RELEASE', params: [] }); }
  };
  const pool = { async connect() { return client; }, async query() { return { rows: [], rowCount: 0 }; } };
  const handler = createOrdersHandler(() => pool);
  const res = response();
  await handler(request('POST', {
    headers: { authorization: 'Bearer ' + 'x'.repeat(43) },
    body: { market: 'CCC-KRW', side: 'buy', price: '1000', quantity: '1', idempotencyKey: 'maker-price-test-001' }
  }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.order.status, 'filled');
  assert.equal(res.body.order.filledQuantity, '1');
  assert.equal(res.body.order.remainingQuantity, '0');
  assert.ok(calls.some(x => x.q.includes('INSERT INTO vex2_fills')));
  assert.ok(calls.some(x => x.q.includes('available=available-$3::numeric,locked=locked+$3::numeric') && x.params[2] === '900'));
  assert.ok(calls.some(x => x.q.includes('locked=locked-$3::numeric') && x.params[2] === '900'));
  assert.ok(!calls.some(x => x.q.includes('available=available+$3::numeric') && x.params[2] === '100'));
  assert.ok(calls.some(x => x.q === 'COMMIT'));
  assert.ok(!calls.some(x => x.q === 'ROLLBACK'));
});

test('orders API rolls back when the account has insufficient balance', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const q = String(sql).trim(); calls.push(q);
      if (q.includes('SELECT a.id FROM vex2_account_sessions')) return { rows: [{ id: 41 }], rowCount: 1 };
      if (q.includes('SELECT base_asset,quote_asset FROM vex2_markets')) return { rows: [{ base_asset: 'CCC', quote_asset: 'KRW' }], rowCount: 1 };
      if (q.includes('SELECT available FROM vex2_balances')) return { rows: [{ available: '5' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  const pool = { async connect() { return client; } };
  const handler = createOrdersHandler(() => pool);
  const res = response();
  await handler(request('POST', {
    headers: { authorization: 'Bearer ' + 'x'.repeat(43) },
    body: { market: 'CCC-KRW', side: 'buy', price: '1000', quantity: '1', idempotencyKey: 'insufficient-test-001' }
  }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Insufficient/);
  assert.ok(calls.includes('ROLLBACK'));
  assert.ok(!calls.some(q => q.includes('INSERT INTO vex2_orders')));
});


test('orders API accepts a numeric order ID and refunds the reserved balance on cancellation', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const q = String(sql).trim();
      calls.push({ q, params });
      if (q.includes('SELECT a.id FROM vex2_account_sessions')) return { rows: [{ id: 41 }], rowCount: 1 };
      if (q.includes('SELECT market FROM vex2_orders')) return { rows: [{ market: 'CCC-KRW' }], rowCount: 1 };
      if (q.includes('SELECT id,market,side,price,remaining FROM vex2_orders')) return { rows: [{ id: '123', market: 'CCC-KRW', side: 'buy', price: '1000', remaining: '2' }], rowCount: 1 };
      if (q.includes('SELECT base_asset,quote_asset FROM vex2_markets')) return { rows: [{ base_asset: 'CCC', quote_asset: 'KRW' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
  const pool = { async connect() { return client; } };
  const handler = createOrdersHandler(() => pool);
  const res = response();
  await handler(request('DELETE', {
    headers: { authorization: 'Bearer ' + 'x'.repeat(43) },
    query: { id: '123' }
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.cancelled, true);
  assert.equal(res.body.id, '123');
  assert.ok(calls.some(x => x.q.includes('available=available+$3::numeric') && x.params[2] === '2000'));
  assert.ok(calls.some(x => x.q === 'COMMIT'));
});

test('orders API rejects a non-numeric cancellation ID as invalid', async () => {
  const fake = fakePool();
  const handler = createOrdersHandler(() => fake.pool);
  const res = response();
  await handler(request('DELETE', {
    headers: { authorization: 'Bearer ' + 'x'.repeat(43) },
    query: { id: 'not-an-id' }
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid order id.');
  assert.ok(fake.calls.some(x => x.sql === 'ROLLBACK'));
});
