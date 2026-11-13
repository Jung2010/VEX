-- VEX v2 additive schema. Review and run manually against a dedicated preview database only.
-- This migration is intentionally NOT executed by API requests or deployments.
BEGIN;
CREATE TABLE IF NOT EXISTS vex2_assets (code TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'crypto', enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS vex2_markets (symbol TEXT PRIMARY KEY, base_asset TEXT NOT NULL REFERENCES vex2_assets(code), quote_asset TEXT NOT NULL REFERENCES vex2_assets(code), enabled BOOLEAN NOT NULL DEFAULT TRUE, last_price NUMERIC(24,10) NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS vex2_accounts (id BIGSERIAL PRIMARY KEY, handle TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS vex2_balances (account_id BIGINT NOT NULL REFERENCES vex2_accounts(id), asset TEXT NOT NULL REFERENCES vex2_assets(code), available NUMERIC(28,10) NOT NULL DEFAULT 0, locked NUMERIC(28,10) NOT NULL DEFAULT 0, PRIMARY KEY(account_id,asset));
CREATE TABLE IF NOT EXISTS vex2_orders (id BIGSERIAL PRIMARY KEY, account_id BIGINT NOT NULL REFERENCES vex2_accounts(id), market TEXT NOT NULL REFERENCES vex2_markets(symbol), side TEXT NOT NULL CHECK(side IN ('buy','sell')), price NUMERIC(24,10) NOT NULL CHECK(price>0), quantity NUMERIC(28,10) NOT NULL CHECK(quantity>0), remaining NUMERIC(28,10) NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','filled','cancelled')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS vex2_orders_book_idx ON vex2_orders(market,side,price,created_at) WHERE status='open';
CREATE TABLE IF NOT EXISTS vex2_fills (id BIGSERIAL PRIMARY KEY, market TEXT NOT NULL, price NUMERIC(24,10) NOT NULL, quantity NUMERIC(28,10) NOT NULL, buy_order BIGINT NOT NULL, sell_order BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS vex2_agent_state (agent TEXT PRIMARY KEY, inventory JSONB NOT NULL DEFAULT '{}'::jsonb, realized_pnl NUMERIC(24,10) NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS vex2_market_metrics (id BIGSERIAL PRIMARY KEY, market TEXT NOT NULL, spread_bps NUMERIC(16,6), bid_depth NUMERIC(24,10), ask_depth NUMERIC(24,10), volume_24h NUMERIC(24,10), volatility NUMERIC(16,8), observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
INSERT INTO vex2_assets(code,name,kind) VALUES ('KRW','Simulated US Dollar','fiat'),('CCC','Central Charging Coin','crypto'),('TOLR','Tolerancer','crypto'),('SECX','Secure','crypto') ON CONFLICT(code) DO NOTHING;
INSERT INTO vex2_markets(symbol,base_asset,quote_asset,last_price) VALUES ('CCC-KRW','CCC','KRW',1000),('TOLR-CCC','TOLR','CCC',0.25),('SECX-CCC','SECX','CCC',2) ON CONFLICT(symbol) DO NOTHING;
COMMIT;
