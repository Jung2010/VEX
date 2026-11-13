# VEX — Virtual Exchange Economy Simulator v2

Fictional, simulation-only market economy. No live exchange connectivity, real-money execution, leverage, or external asset custody.

## Preview scope
- Assets: CCC, TOLR, SECX; USD is simulated fiat.
- Additive PostgreSQL schema uses the vex2_ prefix and leaves legacy tables untouched.
- Read-only market and health endpoints; API requests never create or migrate tables.
- Pure fixed-point limit-order matching core with price-time priority and unit tests.
- Manual additive SQL migration at `db/001_vex2_init.sql`; run only against a dedicated preview database after reviewing it.
- Planned agents: VEX Liquidity Desk, Pulse Agent, Anchor Agent.

## Phase 2 local paper account
- The browser UI includes a local-only simulated wallet, limit orders, a synthetic order book, open-order cancellation, and recent simulated fills.
- Local account state is stored in browser localStorage and is not a secure identity, server-side account, or shared multi-user ledger.
- Initial demo balances are fictional and resettable from the UI.
- Synthetic liquidity is a deterministic teaching fixture, not a live market feed.
- No live exchange, payment, real-money, or leverage functionality.

## Deployment and database safety
Vercel Root Directory should remain the repository root. Preview and Production currently share the same Neon environment configuration, so do not apply schema migrations until a separate Preview database/branch is provisioned and verified. All new tables are isolated under vex2_.

## Safety
Educational simulation only. Never connect real exchanges, payment rails, or real funds.


## Phase 3: server-side Preview accounts (gated)
- `api/account.js` creates a simulated guest account (POST) and reads its balances, open orders, and recent fills (GET).
- Session tokens are random bearer credentials; only SHA-256 token hashes are stored in the database. Tokens expire after 30 days.
- Account creation and initial balance inserts run in one database transaction.
- The API uses only `VEX_PREVIEW_DATABASE_URL`. It intentionally does not fall back to `DATABASE_URL`, which is currently shared between Preview and Production.
- Configure `VEX_PREVIEW_DATABASE_URL` only after provisioning a dedicated Preview Neon database/branch. Then manually apply `db/001_vex2_init.sql` followed by `db/002_vex2_accounts.sql` to that isolated database.
- Until that dedicated connection and migrations exist, the account endpoint returns a clear 503 and does not write to any database.
- The current browser-local paper account remains the active UI mode; the server account API is not yet wired into the UI.
