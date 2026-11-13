const SCALE = 10n ** 10n;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d{1,10})?$/;

export function toUnits(value, field = 'value') {
  const text = String(value);
  if (!DECIMAL.test(text)) throw new TypeError(`Invalid ${field}`);
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * SCALE + BigInt((fraction + '0'.repeat(10)).slice(0, 10));
}

export function fromUnits(units) {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(10, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? '.' + fraction : ''}`;
}

export function validateLimitOrder(order) {
  if (!order || !['buy', 'sell'].includes(order.side)) throw new TypeError('side must be buy or sell');
  if (typeof order.market !== 'string' || !/^[A-Z0-9]{2,12}-[A-Z0-9]{2,12}$/.test(order.market)) throw new TypeError('Invalid market');
  const price = toUnits(order.price, 'price');
  const quantity = toUnits(order.quantity, 'quantity');
  if (price <= 0n || quantity <= 0n) throw new RangeError('price and quantity must be positive');
  return { ...order, priceUnits: price, quantityUnits: quantity };
}

function timeValue(value) {
  const n = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(n) ? n : 0;
}

export function planMatches(incomingOrder, restingOrders) {
  const incoming = validateLimitOrder(incomingOrder);
  const candidates = restingOrders
    .map(order => ({ ...validateLimitOrder(order), remainingUnits: toUnits(order.remaining ?? order.quantity, 'remaining') }))
    .filter(order => order.market === incoming.market && order.side !== incoming.side && order.remainingUnits > 0n)
    .filter(order => incoming.side === 'buy' ? order.priceUnits <= incoming.priceUnits : order.priceUnits >= incoming.priceUnits)
    .sort((a, b) => {
      if (a.priceUnits !== b.priceUnits) {
        const better = incoming.side === 'buy' ? a.priceUnits < b.priceUnits : a.priceUnits > b.priceUnits;
        return better ? -1 : 1;
      }
      const byTime = timeValue(a.createdAt) - timeValue(b.createdAt);
      if (byTime) return byTime;
      return String(a.id ?? '').localeCompare(String(b.id ?? ''), 'en', { numeric: true });
    });

  let remaining = incoming.quantityUnits;
  const fills = [];
  for (const resting of candidates) {
    if (remaining <= 0n) break;
    const quantity = remaining < resting.remainingUnits ? remaining : resting.remainingUnits;
    fills.push({
      restingOrderId: resting.id,
      price: fromUnits(resting.priceUnits),
      quantity: fromUnits(quantity),
      quantityUnits: quantity
    });
    remaining -= quantity;
  }
  return {
    fills: fills.map(({ quantityUnits, ...fill }) => fill),
    filledQuantity: fromUnits(incoming.quantityUnits - remaining),
    remainingQuantity: fromUnits(remaining),
    status: remaining === 0n ? 'filled' : remaining === incoming.quantityUnits ? 'open' : 'partially_filled'
  };
}
