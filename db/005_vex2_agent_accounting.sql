-- VEXT Phase 6: weighted-average inventory accounting for the simulated liquidity agent.
BEGIN;
CREATE TABLE IF NOT EXISTS vex2_agent_positions (
  account_id BIGINT NOT NULL REFERENCES vex2_accounts(id),
  market TEXT NOT NULL REFERENCES vex2_markets(symbol),
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL,
  base_quantity NUMERIC(28,10) NOT NULL DEFAULT 0,
  average_cost NUMERIC(24,10) NOT NULL DEFAULT 0,
  realized_pnl NUMERIC(28,10) NOT NULL DEFAULT 0,
  bought_quantity NUMERIC(28,10) NOT NULL DEFAULT 0,
  sold_quantity NUMERIC(28,10) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(account_id,market)
);
CREATE INDEX IF NOT EXISTS vex2_agent_positions_market_idx
  ON vex2_agent_positions(market,account_id);
COMMIT;
