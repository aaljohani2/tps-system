# Codex — strictly bounded final handoff

You are Codex on the user's Windows computer. **Your only tasks are to install and test TPS System locally.** All development should already have been committed remotely by the primary engineering session.

## Hard limits

- Do not write to or modify GitHub remotely, commit, push, create branches or pull requests.
- Do not deploy on any server, cloud, shared network or internet-facing port.
- Do not change the source code or dependencies to make tests pass without explicit additional user instruction.
- Do not reset/clean the working tree, delete existing files or Docker volumes, or overwrite `.env`.
- Do not send user or trainee data to tests. Use synthetic datasets.
- Keep `Timefold Solver` as the only optimization engine; do not silently replace it with greedy.

## Actions on `<LOCAL_TPS_DIR>`

1. Inspect current Git branch, uncommitted changes and `git status` before any remote fetch or checkout. If conflicts might overwrite changes, stop and report rather than destroying them.
2. Confirm Node 22+, npm, Java 21, Maven, Python/openpyxl, Docker Desktop and free loopback ports. Check Docker volume/data state without deleting anything.
3. If the development branch is already checked out and safe, install project dependencies and compile frontend/backend/Java.
4. With user's own secret `.env`, run local PostgreSQL migrations safely and `db:check`. Never display database passwords.
5. Run TypeScript and existing Node tests, Python importer/exporter tests, Maven JUnit, API integration against a separate synthetic database, Playwright browser tests, and basic endpoint checks.
6. Verify CSV/XLSX four-entity imports and worksheet exports from synthetic-only data, including row errors, exact preview file hash, one-time commit and college-scoped permissions.
7. Verify synthetic seeding only in the isolated test DB and saved Timefold run history/recovery; do not run seed against existing operational data.
7. Include optimistic manual timetable edits, scenario immutability, load-exception approval, prerequisite cycle rejection and plan activation; reject any unimplemented workflow, never mark it passed.
7. Include programs/plan versions, normalized blocks, source-based demand, half-hour slots, manual trainer locks, hybrid split, dashboard and user scope checks; never infer completion of the full mandate from the limited matrix.
7. Validate `docs/ACCEPTANCE_MATRIX.md` A01–A20 locally, including mode-policy draft/approval, instructor/room editing, scenario forks and readiness blockers.
7. Validate the full workflow: login → institution/college/department/term → import courses → instructors and rooms → mode policy → demand/blocks → sections → Timefold → timetable/gaps → fork/compare → review/approve → CSV/XLSX.
8. Verify that a PostgreSQL container restart does not lose the synthetic scenario, policy and users; repeat migrations 0001–0014 idempotently.
9. Produce a written report with command, environment/version, test count, pass/fail/skip, errors and exact fixes **recommended but not performed**. Mark unsupported workflow steps as incomplete.

Only local installation and testing are authorized. A passing test in GitHub Actions does **not** replace Windows-specific verification.

## Additional bounded local acceptance — phases 10 and 11

Once the remaining original-mandate development stages are finished, Codex may run local-only tests on a separate Windows test database. Use `docs/PHASE_10_11_CLOSEOUT.md` as the acceptance basis: verify five CSV/XLSX templates and exact-file confirmation, intentional 410 legacy write blocks, proposed course modes awaiting explicit approval, instructor department scope, actual Excel summary sheets, print-to-PDF, four weekly grid views, detailed blocker navigation, guarded drag/drop, verified manual conflict repair, immutable approved schedules and viewer access restrictions. Record failures and evidence; **do not edit code or run GitHub commits/PR merges**. No tests have been performed on the user's Windows machine yet.

## Additional local-only cases after P0-07 incremental engineering

- Validate locally the new A47–A50 acceptance items. Start a real Java Timefold solve and cancel it only while attached/running; confirm PostgreSQL `solver_runs.status='CANCELLED'` and `scenarios.solver_status='FAILED'`, the audit row, and that no partial or approved result changed.
- Verify a completed run rejects cancellation; viewer/cross-department access must fail. Reject solver settings outside 1–30 seconds / 1–24 candidates per trainer and confirm no RUNNING row was created.
- Confirm a local maximum of two simultaneous Java children per API process; do not claim a distributed/multi-process limit.
- Run the real JAR 25-course and 50-course synthetic workload tests from `tests/scenario-scale.test.ts`. Record coverage gaps, elapsed time, RSS and any differences from Linux CI. The Linux sample 25/6/20/4/20 achieved 25/25 covered on commit `eedd6c5`, but this is **not** guaranteed on the user's machine.
- Before any local work, inspect the real checkout; **do not overwrite, force-reset, re-clone, push, change dependencies or deploy**. If source defects are found, report them for GitHub engineering to correct in a separate authorized phase.

## Asynchronous solver and browser regression (development increment 0012)

Only after source CI is green and development gaps are agreed closed, run local-only acceptance for HTTP 202 solve submission, realistic stage polling, cancellation, duplicate 409, and immutable result snapshots. Confirm the browser's polling still refreshes after the scenario becomes COMPLETED. Use a synthetic local DB for a real, unmocked login → schedule → approve → CSV/XLSX flow. Do not update GitHub, commit, deploy, change dependencies, replace Timefold, reset the user's worktree or delete persistent volumes. The async worker is process-local and cannot be described as a restart-surviving distributed queue.

### Additional archive/restore tests (migration 0014)

Run archived course/trainer/room lifecycle A56–A59 only in a separate synthetic local test DB. Verify audit and status changes in the same transaction; no deletion, no overwrite of older scenarios, no archive of courses in ACTIVE curriculum, and college-only permission for shared rooms. Do not touch actual trainer or trainee information.

## Second Windows acceptance after fixing local blockers (2026-11-06)

The first local report recorded A07/A40 failure when reading Arabic XLSX without a UTF-8 workaround. The GitHub branch now includes Python child encoding fixes, PowerShell fail-fast checks, vetted dependency upgrades, committed npm lockfiles, conflict-free historical documentation paths and updated Playwright navigation. These changes have NOT yet been retested on the user's Windows workstation.

Before fetching: inspect git status. Back up any existing untracked package-lock.json and frontend/package-lock.json before fast-forwarding to the tracked lockfiles; preserve all user-created reports, .env, Docker volumes and local changes. If an update would overwrite anything, stop. Never reset, clean or force-checkout.

Once safe: run npm ci in the project root and npm run web:install (frontend npm ci). Run A01-A59 again in an isolated synthetic database, especially A07/A40 without PYTHONUTF8 or PYTHONIOENCODING, the local.ps1 intentional native failure check, npm audit, Playwright login.spec.ts and real-api-journey.spec.ts, and Zod v4 PATCH preservation of course blocks, instructor qualifications and equipment. Confirm DB persistence across restart.

Create a new local evidence file test-reports/TPS_LOCAL_ACCEPTANCE_REPORT_V2.md with real pass/fail/skipped counts, exact code commit, Windows environment, first-hand test evidence and outstanding risks. Never report earlier passing CI as a Windows result. Do not modify source, GitHub, production servers, or real institutional data. A green result permits a synthetic loopback pilot only; full release conditions are in docs/PRODUCTION_READINESS.md.

## New operational backup/restore drill (later branch, **not** part of V2 acceptance)

After the new GitHub `backup-restore-drill` job passes, Codex may test the new backup utility **only against an isolated synthetic PostgreSQL database** with disposable credentials. Preserve operational databases and named volumes. Follow `docs/BACKUP_RESTORE.md` for a unique in-memory passphrase; do not log/store the key. Backup -> verify -> restore-test must create a new `tps_restore_*` database and leave the source untouched. Record outcomes in a new separate dated report; do not rewrite the V2 59/59 result as if this new drill had already passed locally. No real data, remote copying, GitHub mutation, merge or network deployment without new permission.
