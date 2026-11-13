import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1];
assert.ok(script, 'index.html must contain the application script');
const wait = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));

function createApp() {
  const calls = [];
  const token = 'a'.repeat(43);
  const markets = {
    assets: [{ code: 'KRW' }, { code: 'CCC' }, { code: 'TOLR' }, { code: 'SECX' }],
    markets: [
      { symbol: 'CCC-KRW', base_asset: 'CCC', quote_asset: 'KRW', last_price: '1000' },
      { symbol: 'TOLR-CCC', base_asset: 'TOLR', quote_asset: 'CCC', last_price: '0.25' },
      { symbol: 'SECX-CCC', base_asset: 'SECX', quote_asset: 'CCC', last_price: '2' }
    ],
    agents: ['VEXT Liquidity Desk', 'Pulse Agent', 'Anchor Agent']
  };
  const balances = [
    { asset: 'KRW', available: '10000000', locked: '0' },
    { asset: 'CCC', available: '1000', locked: '0' },
    { asset: 'TOLR', available: '2500', locked: '0' },
    { asset: 'SECX', available: '250', locked: '0' }
  ];
  const account = { account: { id: 1, handle: 'guest_test' }, balances, openOrders: [], recentFills: [] };
  const dom = new JSDOM(source.replace(/<script[^>]*>[\s\S]*?<\/script>/i, ''), {
    url: 'https://vext.test/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.confirm = () => true;
      window.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method || 'GET' });
        let data = {}, status = 200;
        if (url === '/api/markets') data = markets;
        else if (url === '/api/account' && options.method === 'POST') {
          status = 201;
          data = { ...account, token };
        } else if (url === '/api/account') data = account;
        else if (String(url).startsWith('/api/orders') && (!options.method || options.method === 'GET')) {
          data = { market: 'CCC-KRW', orders: [] };
        } else if (url === '/api/orders' && options.method === 'POST') {
          status = 201;
          data = { order: { id: 99, market: 'CCC-KRW', side: 'buy', price: '900', quantity: '2', filledQuantity: '0', remainingQuantity: '2', status: 'open' } };
        } else if (String(url).startsWith('/api/orders?id=') && options.method === 'DELETE') {
          data = { cancelled: true, id: 99 };
        }
        return { ok: status < 400, status, json: async () => data };
      };
    }
  });
  dom.window.eval(script);
  return { dom, calls };
}

test('UI initializes and renders markets and balances', async t => {
  const { dom } = createApp();
  t.after(() => dom.window.close());
  await wait();
  const doc = dom.window.document;
  assert.ok(doc.querySelector('#marketSelect option'));
  assert.ok(doc.querySelector('#balances .balance'));
  assert.match(doc.querySelector('#marketInfo').textContent, /CCC/);
});

test('local order button creates an order and cancel button removes it', async t => {
  const { dom } = createApp();
  t.after(() => dom.window.close());
  await wait();
  const doc = dom.window.document;
  doc.querySelector('#price').value = '900';
  doc.querySelector('#quantity').value = '2';
  doc.querySelector('#submitOrder').click();
  await wait();
  assert.match(doc.querySelector('#orderStatus').textContent, /주문으로 등록/);
  const cancel = doc.querySelector('#openOrders [data-cancel]');
  assert.ok(cancel);
  cancel.click();
  await wait();
  assert.match(doc.querySelector('#openOrders').textContent, /미체결 주문 없음/);
});

test('market selector updates the selected market', async t => {
  const { dom } = createApp();
  t.after(() => dom.window.close());
  await wait();
  const select = dom.window.document.querySelector('#marketSelect');
  select.value = 'TOLR-CCC';
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await wait();
  assert.match(dom.window.document.querySelector('#marketInfo').textContent, /TOLR/);
});

test('reset button resets only the local demo account', async t => {
  const { dom } = createApp();
  t.after(() => dom.window.close());
  await wait();
  dom.window.document.querySelector('#resetBtn').click();
  await wait();
  assert.match(dom.window.document.querySelector('#orderStatus').textContent, /초기화했습니다/);
  assert.match(dom.window.document.querySelector('#serverStatus').textContent, /서버 계정은 별도로 보존/);
});

test('server account button creates and loads a simulated account', async t => {
  const { dom, calls } = createApp();
  t.after(() => dom.window.close());
  await wait();
  dom.window.document.querySelector('#serverAccountBtn').click();
  await wait(60);
  assert.match(dom.window.document.querySelector('#serverStatus').textContent, /새 서버 모의 계정을 만들었습니다/);
  assert.ok(calls.some(call => call.url === '/api/account' && call.method === 'POST'));
  assert.ok(calls.some(call => call.url === '/api/account' && call.method === 'GET'));
  assert.ok(calls.some(call => call.url.startsWith('/api/orders?market=') && call.method === 'GET'));
});
