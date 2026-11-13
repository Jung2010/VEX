-- VEXT Phase 7: persistent controls for the simulated liquidity agent.
BEGIN;
CREATE TABLE IF NOT EXISTS vex2_agent_config (
  agent TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);
INSERT INTO vex2_agent_config(agent, enabled, updated_by)
VALUES ('VEXT Liquidity Desk', TRUE, 'migration')
ON CONFLICT(agent) DO NOTHING;
COMMIT;
