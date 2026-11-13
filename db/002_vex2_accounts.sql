-- VEX v2 Phase 3: server-side demo accounts and sessions.
-- Apply ONLY to a dedicated Preview Neon database after 001_vex2_init.sql.
-- Never run against the shared legacy/production database.
BEGIN;

ALTER TABLE vex2_orders DROP CONSTRAINT IF EXISTS vex2_orders_status_check;
ALTER TABLE vex2_orders ADD CONSTRAINT vex2_orders_status_check
  CHECK (status IN ('open','partially_filled','filled','cancelled'));

CREATE TABLE IF NOT EXISTS vex2_account_sessions (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES vex2_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS vex2_account_sessions_active_idx
  ON vex2_account_sessions(token_hash, expires_at)
  WHERE revoked_at IS NULL;

COMMIT;
