# Codex — strictly bounded final handoff

You are Codex on the user's Windows computer. **Your only tasks are to install and test TPS System locally.** All development should already have been committed remotely by the primary engineering session.

## Hard limits

- Do not write to or modify GitHub remotely, commit, push, create branches or pull requests.
- Do not deploy on any server, cloud, shared network or internet-facing port.
- Do not change the source code or dependencies to make tests pass without explicit additional user instruction.
- Do not reset/clean the working tree, delete existing files or Docker volumes, or overwrite `.env`.
- Do not send user or trainee data to tests. Use synthetic datasets.
- Keep `Timefold Solver` as the only optimization engine; do not silently replace it with greedy.

## Actions on `H:\\tps_system`

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
8. Verify that a PostgreSQL container restart does not lose the synthetic scenario, policy and users; repeat migrations 0001–0013 idempotently.
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
