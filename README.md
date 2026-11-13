# VEXT — Virtual Economy Exchange Simulator

VEXT is a fictional, simulation-only virtual economy for learning about markets, liquidity, and order matching. It has no live exchange connectivity, real-money execution, leverage, payment rails, or external asset custody.

## Current Preview

- Product-facing name: **VEXT**. The GitHub repository remains named `VEX`.
- Simulated assets: KRW (quote currency), CCC, TOLR, and SECX.
- Markets: CCC-KRW, TOLR-CCC, and SECX-CCC.
- Spot-style limit orders only, using fictional balances.
- A browser-local demo wallet and a separate server-backed Preview account mode.
- Server accounts use bearer sessions; only SHA-256 token hashes are stored in PostgreSQL.
- Order matching uses price-time priority, resting-order prices, partial fills, fixed-point arithmetic, idempotency keys, and per-market transaction locking.
- Market agents include VEXT Liquidity Desk, Pulse Agent, and Anchor Agent. The Liquidity Desk now has an inventory-aware, volatility-sensitive quote planner and a Preview quote-proposal endpoint; it does not yet place autonomous resting orders.

## API

- `GET /api/health` — Preview service and database health.
- `GET /api/markets` — enabled assets, markets, and simulated agents.\n- `GET /api/agents/liquidity?market=CCC-KRW` — risk-bounded simulated bid/ask quote proposals.
- `POST /api/account` — create a fictional guest account and issue a session token.
- `GET /api/account` — read the authenticated account, balances, open orders, and recent fills.
- `GET /api/orders?market=CCC-KRW` — read the shared simulated order book.
- `POST /api/orders` — submit a simulated limit order.
- `DELETE /api/orders?id=<order-id>` — cancel the authenticated account's open order.

Account and order endpoints require the server-issued bearer token. The token is returned once at account creation; the browser stores it locally for the Preview session.

## Database and environment safety

- New schema objects use the `vex2_` prefix.
- SQL migrations are manual and ordered: `db/001_vex2_init.sql`, `db/002_vex2_accounts.sql`, then `db/003_vex2_matching.sql`.
- The Preview application reads only `VEXT_DATABASE_URL`; it never falls back to the legacy `DATABASE_URL`.
- Database access is explicitly gated to Vercel Preview. Production is not enabled by this code path.
- API requests never create tables or run migrations.
- The dedicated Neon Preview branch has the VEXT schema. The default/main branch is intentionally untouched.
- Do not apply these migrations to Production or repoint the legacy database configuration.

## Tests

Run the fixed-point matching unit tests with:

```sh
npm install
npm test
```

The GitHub Actions workflow runs the same command for pushes and pull requests targeting `rebuild/vex-v2`.

## Limitations

- The browser UI has not yet had a full manual interaction test across account creation, order submission, partial fills, and cancellation.
- Preview health and market-read endpoints have been smoke-tested; authenticated POST/DELETE API flows still need automated end-to-end coverage.
- The Liquidity Desk currently produces indicative quotes only. Automated order placement, quote refresh/cancel lifecycle, agent-funded inventory, and live order-book integration remain future Preview-only work. Pulse Agent and Anchor Agent are still descriptive fixtures.
- The project is educational simulation software only. Never connect real exchanges, payment providers, or real funds.
