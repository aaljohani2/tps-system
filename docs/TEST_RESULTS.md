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

## Current incremental CI checkpoint

- Commit `b789823e`: both GitHub Actions runs **42220124613** and **42220115899** succeeded with migration 0005/0006, manual edits and approved load exceptions; five jobs green.
- Later revisions add normalized fork fixes and curriculum version activation (migration 0007). Check the **HEAD-matching** GitHub Actions run before declaring the new change verified.
- Never equate this with local acceptance. Codex has not installed/tested the Windows checkout, and the operational E2E suite is incomplete.

## Additional synthetic CI scope

- Commit `f704bb1d`: two successful GitHub Actions runs **42221648859** and **42221662313**, including repeated opt-in synthetic database seeding.
- Migration 0008, durable solver attempts/history and recovery were added in subsequent commits. Confirm the newest HEAD-matching CI run; do not infer a PASS from previous revisions.

## Verified full-stack checkpoint — 2026-11-06

- Commit `dbf2cd236b1329433443fdaf951475108d518cae`: GitHub Actions runs **42222172141** and **42222182839** completed **SUCCESS**.
- On run **42222182839**, all five jobs passed: `api-postgres-integration`, `web-build`, `node-tests`, `java-timefold` and `xlsx-import-tests`.
- Verification includes SQL migrations **0001–0008**, opt-in synthetic seed twice, scope/CSRF checks, manual timetable edit history/optimistic concurrency, Timefold run history, term load exception approval, prerequisites and active-plan immutability, and normalized block fork constraints. These are CI synthetic checks, not institution or Windows signoff.
- **Not performed:** local Windows installation, browser-driven end-to-end journey on user's PC, real student dataset evaluation, throughput benchmarks for production-size terms, and official curriculum/security approval.

## Bulk import and export increment

- Commit `69c5f49c`: both GitHub Actions runs **42229164272** and **42229174188** completed successfully, including Fastify/PostgreSQL bulk preview/commit tests (four entity types, scope, CSRF and token replay), and Node/React/Timefold/Python verification.
- Commit `a9b9b9a2`: both GitHub Actions runs **42229654190** and **42229664267** completed successfully, including RTL Excel report worksheets, cross-scenario comparison fixtures, and XLSX-formula rejection.
- Subsequent updates add the comparison download link and supporting integration test. Confirm the **final HEAD** matches a completed green GitHub run before reporting completion.
- Windows local installation, full browser E2E and real institutional data verification remain untested.

## Phase 10 & 11 verified engineering checkpoint — 2026-11-06

- **Commit `20a9f9f81c237a343a482a645a4418918470edcd`** passed GitHub Actions runs **42238619762** and **42238626729**, including **all six jobs**:
  `node-tests`, `api-postgres-integration`, `xlsx-import-tests`, `web-build`, `java-timefold`, `web-e2e-phase10-11`.
- The Node tests include explicit room/trainer/block collision warnings, improved collision-resolving manual scheduling, unsafe-course-mode blockers and HTML/PDF print source escaping.
- PostgreSQL integration tests include complete course CSV and actual XLSX preview/commit, exact file hash, school scope, immutable mode eligibility, master data and report export.
- Playwright runs **three browser interaction tests** using mocked API responses for the four timetable views, warning navigation, stage-only drag/drop, rejected API save, viewer permissions and course import preview/commit UI. Mocked-browser interaction is not a substitute for a full real-API end-to-end user journey.
- **Windows local installation/testing has not been conducted.** No main merge, no external deployment or Rayat changes.
