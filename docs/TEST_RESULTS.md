# TPS V1 verification ledger

As of 2026-11-06:

- Historical v0.3 base commit `3a1d84c`: Node, Python importer and Java Timefold GitHub CI success.
- V1 `bbb62f1a`: GitHub CI tasks `node-tests`, `xlsx-import-tests`, `java-timefold`, `web-build`, `api-postgres-integration` succeeded on synthetic data (run 42208893085).
- V1 `75b73019`: all GitHub CI tasks passed, including term policy/snapshot migration and readiness checks (runs 42212547437 and 42212555263).
- Subsequent commits added scoped authorization regression tests. Verify their latest CI independently; do not reuse earlier results.
- User's Windows checkout `<LOCAL_TPS_DIR>`: not accessed by ChatGPT; installation, Playwright and local Docker restart persistence tests not performed.
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

## P0-07 controlled Timefold and synthetic scale — verified GitHub CI (2026-11-06)

- Commit `0a6f8b92bd8a4a5859dacd866b1fac7cc6a2d227` — GitHub Actions run **42260563860**, **SUCCESS** on all six jobs (`node-tests`, `web-e2e-phase10-11`, `web-build`, `java-timefold`, `api-postgres-integration`, `xlsx-import-tests`). Includes cancellation API, explicit CANCELLED SQL status, abort propagation, setting bounds, and Windows-agnostic source tests.
- Commit `afaa78fce9cc67ede63c89e342c7d6d0d5ea30e1` — run **42260816121**, all six jobs **SUCCESS**. Added actual assembled-JAR child-process abort test and a real Java Timefold synthetic scale smoke. Logs: 25 sections, 8 scheduled sessions, **17 gaps**, **4291 ms**, Node RSS **68 MB**. This exposed a room-candidate diversity defect despite a green CI check.
- Commit `eedd6c5e84592bbb0c782088064f61ad57802c93` — run **42261333608**, all six jobs **SUCCESS**. After diversifying room choices by instructor and adding a candidate diversity regression: **25 sections, 25 scheduled sessions, 0 uncovered gaps**, **4279 ms**, Node RSS **68 MB** on the same synthetic 25-course/6-trainer/20-room/4-level/20-block workload.
- **Interpretation:** the measured gain is from candidate-space quality, not increased room inventory or a claim of global optimum. Tests validate one synthetic feasible fixture; additional larger and adversarial configurations, stable repeated runs, all hard/soft constraints and real-world data remain to be verified.
- **Not tested locally:** the user's Windows checkout `<LOCAL_TPS_DIR>`, Docker restart persistence, all 20 real-API browser journey steps, official institutional policies or real trainee records.
- Subsequent documentation-only commits require a HEAD-matching CI pass before reporting a final green branch. No main merge or remote deployment.

## Additional larger Timefold workload (2026-11-06)

- Commit `d4a7fa6d279a0b4e606eb8e0feaa336632f51c70`; GitHub Actions run **42262168587**: **SUCCESS (all six jobs)**.
- PostgreSQL/Java job logs show the real JAR tests:
  - **25 courses, 6 trainers, 20 rooms, 4 levels, 20 blocks**: 25 sections / 25 sessions / **0 gaps**; **3985 ms**; Node RSS **64 MB**.
  - **50 courses, 12 trainers, 30 rooms, 6 levels, 30 blocks**: 50 sections / 50 sessions / **0 gaps**; **4155 ms**; Node RSS **69 MB**.
- These values come from CI's synthetic feasibility smoke, not repeated production benchmarks or full end-to-end browser acceptance. Java child memory is **not** fully captured by Node RSS; do not present these RSS values as total solution-process memory consumption.
- Run sources: `tests/scenario-scale.test.ts`, `.github/workflows/ci.yml` and Actions logs. The Windows device has **not** been tested.

## HTTP-independent local solver and real browser E2E — 2026-11-06

- Commit `a1324efb4fd982ffe7c08da8c6b6856c684c5dbe`, GitHub Actions run **42263941126**, **6/6 success**. PostgreSQL integration verifies the `0012` migration, HTTP 202 durable async acceptance, duplicate rejection, completion after the HTTP request, real cancellation, preserved scenario snapshots, and cancellation audit.
- The first unmocked browser run **42264461789** failed at a *real UI defect*: the run-history query did not refetch the terminal stage after the scenario transitioned from RUNNING to COMPLETED. Fixed `SolverRunsPanel` query key to include scenario solver status; CI credentials also now register an Actions mask before storing in `GITHUB_ENV`.
- Commit `277419017f450fb60c5cfc16bdf2776ceb0b9740`, GitHub Actions run **42264930048**, **7/7 success**, including `web-e2e-real`: disposable PostgreSQL 17 service + real Fastify/React + Java 21 Timefold + Chromium/Playwright, with ephemeral masked synthetic administrator. The test covers login, selecting college/department/term, reading actual stored master data, creating a scenario, asynchronous solve, persisted run stage, review, approval, real CSV/XLSX bytes, and logout. **This is one real browser journey, not yet the complete 20-step original-mandate suite.**
- Run **42264700428** passed the PostgreSQL/Timefold job for impossible-slot validation: 8 synthetic sections, one room, one two-hour slot → **1 scheduled, 7 uncovered**. Earlier feasible scale checks cover 25/25 and 50/50 with zero gaps for their respective synthetic fixtures.
- Additional optional scenario search/pagination (`limit` 1–100, `offset` 0–10000) and access-control tests were added in subsequent commits; they require a HEAD-matching CI run before acceptance.
- **Not tested:** Windows `<LOCAL_TPS_DIR>`, PostgreSQL persistence across Windows Docker restart, complete 20-step role-negative browser suite, broader curriculum/equipment constraints, multi-process durable job queue, performance with authentic institutional data, formal security review.

## Scoped scenario list search/pagination — confirmed 2026-11-06

- Source commit `7ceda8a12144be3a958d8847648db7e38dc119fc`: GitHub Actions run **42265498369**, **7/7 successful** including the unmocked real Chromium/React/Fastify/PostgreSQL/Timefold journey.
- `GET /api/v1/scenarios` supports optional `limit` (1–100; default 100), `offset` (0–10000; default 0) and bounded `search`, retaining the legacy array shape. SQL uses parameter binding and preserves mandatory department/term scoping.
- PostgreSQL API integration tests verify exact scoped search, empty offsets, invalid page size (400), and out-of-scope page (403). This closes only the scenario-list slice of the wider P0-13 uniform API pagination/archiving requirement, **not all catalog/user CRUD**.
- Last independently verified code SHA: `7ceda8a12144be3a958d8847648db7e38dc119fc`. Subsequent documentation-only HEAD must not be confused with an independently tested code change.

## Explicit specialty/equipment and reversible archive closure (2026-11-06)

- Migration **0013** introduced mandatory course `required_specialties`/`required_equipment`, instructor `specialties` and room `equipment_codes`, validated and checked by Greedy, Timefold, manual edits and readiness. **Commit `be29338cc474e45a533a721bac7f10930c32cc83`**, Actions **42270613282**, **7/7 jobs SUCCESS**. Real Java candidate tests forbid unqualified trainers and unequipped rooms; API integration tests reject invalid locked instructor qualifications and unauthorized room edits.
- Migration **0014** adds reversible `is_active` status for courses, instructors and rooms. Lifecycle state and audit entry are committed atomically. New scenarios omit archived resources; a locked inactive trainer blocks a new scenario with 409. Archived courses cannot be used to activate curricula; courses in an already active curriculum cannot be archived. **Source commit `dc8d477d5f3e3353ecd80638a4be23c6b46ce91f`**, Actions **42272336053**, **7/7 jobs SUCCESS** including PostgreSQL/API, real Chromium/React/Fastify/Timefold, and both browser mock and Java tests.
- **Limits:** no real user/trainee data, no Windows `<LOCAL_TPS_DIR>` test, no complete 20-step and multi-role browser suite, no independent institutional confirmation of specialties/equipment. Other entities' archival and distributed solver queue remain open. Documentation-only commits after the tested code do not change the above source evidence.

## Pre-production Windows bugfixes and reproducibility — 2026-11-06

- User-supplied first local report: A01–A59: **57 passed, A07/A40 failed, 0 unrun**. Original failures involve Arabic XLSX UTF-8 decoding without an environment workaround; other observed issues include PowerShell 5.1 false-positive installer success, npm audit high alerts, npm 11 web manifest mutation, NTFS case-only documentation collisions and obsolete login locator. This does **not** imply successful acceptance of the fixes on the user's Windows checkout.
- Source fixes: Node/Python per-child UTF-8, Windows PowerShell fail-fast native commands, npm frontend install from its own directory, renamed historical case-colliding files, updated login E2E and optional non-piped bootstrap username on an empty DB only.
- Refreshed dependencies according to npm advisories: Fastify 5.12.8, @fastify/static 10.1.10, Drizzle 0.45.4, Zod 4.6.7, React Router DOM 7.18.5 and Vite 7.3.7. Zod 4 created a PATCH absent-field/default regression identified by PostgreSQL tests; shared explicit-key-only PATCH filtering and regression assertions preserve course blocks, trainer specialties/modes and room equipment.
- Checked in npm lockfiles captured from the audited dependency trees; CI and local installation scripts now use **npm ci** to avoid unplanned dependency resolution and npm 11 manifest mutation.
- **Commit `c077e431749a7236d4add6cc4e14b2528b757b4c`: Actions TPS checks run `42285459292` — 8/8 SUCCESS**, including actual Windows Node/Python regression and isolated PowerShell 5.1 failure propagation, real Chromium, PostgreSQL, Java, mock browser, import and web build.
- **Same commit: TPS production dependency security gate run `42285459720` — SUCCESS**, npm audit root: 0 total reported vulnerabilities, frontend: 0 total reported vulnerabilities. Clean npm audit is **not** an independent threat assessment.
- Windows A07/A40 and all A01–A59 cases must be rerun on the user's actual `<LOCAL_TPS_DIR>` checkout after safe fast-forward and backed-up untracked lockfiles. No real-data production access, public network exposure, off-device restore verification or formal institutional sign-off has been performed.

## Encrypted backup/restore engineering verification (2026-11-07)

- User-supplied `TPS_LOCAL_ACCEPTANCE_REPORT_V2.md` records Windows machine commit `f1d76aa75aafcba12bfa81a496d004c94c730de3`: **A01–A59 = 59 pass / 0 fail**, 80 unique completed tests, working React/Fastify/PostgreSQL/Java Timefold, preserved scenarios and approved exports. This is the V2 test report; no new on-device backup drill is claimed.
- The development branch subsequently added `scripts/backup-restore.mjs` and `docs/BACKUP_RESTORE.md`. It creates an AES-256-GCM encrypted stream from Docker PostgreSQL pg_dump, requires an operator-supplied key, authenticates and structurally validates the archive, and restores ONLY to a newly generated disposable database. No source database overwrite/delete mechanism exists in this utility.
- **Source commit `f9797b51d5d7fa9e14682d6f4df7a430fe097f5e`** (latest code for this milestone): `TPS checks` GitHub Actions **42295358836 — 9/9 SUCCESS**, including `backup-restore-drill`, Windows, Node, real Chromium, PostgreSQL integration, Java and Python XLSX.
- The backup-drill job created a synthetic approved scenario, a `COMPLETED` solver run and an audit record. After encrypted backup, restore to `tps_restore_*` verified all three records and 14 migrations; a modified ciphertext was rejected. This is proof of runner-level isolated restore for synthetic data only, not off-device persistence, key escrow or restore on the user's workstation.
- Production **NO-GO** until independent on-PC backup/restore drill, off-device retention and restore validation, institutional identity/data permissions, security/TLS assessment and operational sign-off. Do not silently equate local synthetic acceptance with a public or real-data deployment.

## Local production priority — source verification (2026-11-07)

- A dedicated loopback-only `tps_operational_local` PostgreSQL database, separate from the user's retained `tps_browser_test`, is now supported by `scripts/local-production.mjs`. The existing `.env` and Docker Volume are not rewritten, and operational DB initialization is idempotent. Initial administrator bootstrap refuses non-empty user tables.
- The operational Fastify service returns `/health.mode=local-production` and forbids synthetic-seed/integration flags. Operational-specific backup commands route only to the operational DB; a Windows user-logon Scheduled Task is optional and needs on-PC verification.
- **Commit `2789af23fb788265f4da088e299b22e394fb9331`: `TPS checks` run 42309548466 = 10/10 SUCCESS**, including `local-production-smoke` (DB creation/reuse, empty seed state, one-time admin, encrypted backup/isolated restore and HTTP 200 production profile), PostgreSQL, backup drill, real Chromium, Windows and Java. The dependency gate was also successful.
- On-PC local production activation and scheduled-task reliability have not been demonstrated yet. Earlier user reports show `127.0.0.1:8787` serving `tps_browser_test` with `mode=local-only`. The new operational DB must be initialized and the old **verified test API process only** safely retired before starting production on that port. Preserve all original data and test evidence.
