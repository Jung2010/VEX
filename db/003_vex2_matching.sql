-- VEX v2 Phase 4: transactional multi-account limit matching.
-- Apply ONLY to the isolated Preview database, after migrations 001 and 002.
BEGIN;
ALTER TABLE vex2_orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
DROP INDEX IF EXISTS vex2_orders_book_idx;
CREATE INDEX vex2_orders_book_idx ON vex2_orders(market,side,price,created_at,id)
  WHERE status IN ('open','partially_filled');
CREATE UNIQUE INDEX IF NOT EXISTS vex2_orders_account_idempotency_idx
  ON vex2_orders(account_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE vex2_fills ADD COLUMN IF NOT EXISTS buyer_account_id BIGINT REFERENCES vex2_accounts(id);
ALTER TABLE vex2_fills ADD COLUMN IF NOT EXISTS seller_account_id BIGINT REFERENCES vex2_accounts(id);
CREATE INDEX IF NOT EXISTS vex2_fills_buyer_idx ON vex2_fills(buyer_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vex2_fills_seller_idx ON vex2_fills(seller_account_id, created_at DESC);
COMMIT;
