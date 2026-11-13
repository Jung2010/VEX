# VEX — Virtual Exchange Economy Simulator v2

Fictional, simulation-only market economy. No live exchange connectivity, real-money execution, leverage, or external asset custody.

## Preview scope
- Assets: CCC, TOLR, SECX; USD is simulated fiat.
- Additive PostgreSQL schema uses the vex2_ prefix and leaves legacy tables untouched.
- Read-only market and health endpoints.
- Planned agents: VEX Liquidity Desk, Pulse Agent, Anchor Agent.

## Deployment
Vercel Root Directory should be src. Review DATABASE_URL and the additive schema before enabling database access. All new tables are isolated under vex2_.

## Safety
Educational simulation only. Never connect real exchanges, payment rails, or real funds.
