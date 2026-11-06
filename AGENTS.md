# TPS System — instructions for Codex and contributors

## Boundaries
- Work from existing `H:\\tps_system`. Never delete or re-clone it, overwrite local edits, or run `git reset --hard`, `git clean -fd`, force push, volume deletion or destructive SQL.
- GitHub development branch: `feat/full-stack-tps-v1`. Do not merge to `main`.
- **Codex scope at final handoff is LOCAL INSTALLATION AND LOCAL TESTS ONLY** unless the user explicitly extends it. Do not modify remote GitHub, deploy, provision cloud infrastructure, or send any data externally.
- Preserve the existing `src/planner.ts`, `src/optimizer.ts`, `solver/`, CSV/XLSX importer and regression tests. Timefold is mandatory for optimized timetables; greedy is an explicitly labelled preview only.
- No automatic Rayat integration. The planning policy is locally configurable, not a statement of official TVTC regulations.
- Never commit secrets, personal trainee data, local database volumes or generated build output.

## Working locally
1. Inspect `git status` before any pull/check out; preserve changes and ask user before destructive conflicts.
2. Check Node 22+, Java 21, Maven, Python 3/openpyxl, Docker Desktop and ports.
3. Create `.env` from `.env.example` with a fresh strong password; do not include it in logs.
4. Run `powershell -ExecutionPolicy Bypass -File scripts/local.ps1 setup` only when dependencies and local changes are understood.
5. Run unit/integration/Java/Python/frontend and browser E2E tests against localhost.
6. Verify database persistence across service restart, migrations are repeatable, solver reports actual results and never silently falls back.
7. Report tested/passed/failed/skipped separately with exact commands and machine versions; **never claim success without test output**.

## Architecture
- Existing TypeScript scheduling engine remains authoritative for planning rules.
- Fastify/TypeScript API under `src/api` uses PostgreSQL/Drizzle and scoped access.
- React/Vite interface under `frontend` is Arabic RTL and accesses the same local origin `/api/v1`.
- SQL migrations under `db/migrations`; local-only Docker PostgreSQL bound to 127.0.0.1.
- `docs/IMPLEMENTATION_STATE.md` is the factual implementation ledger.
