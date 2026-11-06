# TPS V1 verification ledger

As of 2026-11-06:

- Historical v0.3 base commit `3a1d84c`: Node, Python importer and Java Timefold GitHub CI success.
- V1 `bbb62f1a`: GitHub CI tasks `node-tests`, `xlsx-import-tests`, `java-timefold`, `web-build`, `api-postgres-integration` succeeded on synthetic data (run 42208893085).
- V1 `75b73019`: all GitHub CI tasks passed, including term policy/snapshot migration and readiness checks (runs 42212547437 and 42212555263).
- Subsequent commits added scoped authorization regression tests. Verify their latest CI independently; do not reuse earlier results.
- User's Windows checkout `H:\\tps_system`: not accessed by ChatGPT; installation, Playwright and local Docker restart persistence tests not performed.
- Tests use synthetic information only; never actual student personal records.

Review `docs/ACCEPTANCE_MATRIX.md` before local testing. Distinguish source implementation, GitHub Actions (Linux) and the user's Windows environment.

## Latest increment — verify latest HEAD separately

After commit `28f64044`, development continued with schema 0004, academic UI, demand-to-block reconciliation, half-hour scheduling, manual trainer locks, enriched readiness, PostgreSQL dashboard and admin users. Some intermediate CI failures were due to TypeScript typing and an incorrect test fixture using 42 trainees below the 45-seat theoretical limit; those were corrected. **Record a run matching the current HEAD before claiming the increment is green**. Local Windows installation, restart persistence and 20-step Playwright acceptance have not run.
