-- VEXT Phase 5: market candles and administrator audit foundation.
-- Apply ONLY to the isolated Preview Neon branch.
BEGIN;
CREATE TABLE IF NOT EXISTS vex2_market_candles (
  market TEXT NOT NULL REFERENCES vex2_markets(symbol),
  interval_seconds INTEGER NOT NULL CHECK (interval_seconds IN (60,300,900,3600)),
  bucket_at TIMESTAMPTZ NOT NULL,
  open NUMERIC(24,10) NOT NULL,
  high NUMERIC(24,10) NOT NULL,
  low NUMERIC(24,10) NOT NULL,
  close NUMERIC(24,10) NOT NULL,
  volume NUMERIC(28,10) NOT NULL DEFAULT 0,
  trade_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (market, interval_seconds, bucket_at)
);
CREATE INDEX IF NOT EXISTS vex2_market_candles_recent_idx
  ON vex2_market_candles(market, interval_seconds, bucket_at DESC);
CREATE TABLE IF NOT EXISTS vex2_admin_audit (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'superuser',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
