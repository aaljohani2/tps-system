# Stable blocks and general-course source times

This development change preserves the TypeScript planning engine and Java Timefold solver. Greedy output remains a labelled preview; optimized results require actual Timefold execution and validation. Planning assumptions are locally configured and do not represent official TVTC policy. No Rayat integration is introduced.

## Planning behavior

- `general-courses.ts` maps provisional workbook rows to explicit source constraints. It retains provenance and unresolved times or resources. The planner, optimizer, manual moves and readiness checks respect known external meetings. Incomplete integration prevents approval.
- `stable-blocks.ts` retains anonymous block memberships and source lecture evidence. External block demand does not create new source sections. Campus attendance excludes documented remote meetings; incomplete external coverage remains visible.
- `schedule-refinement.ts` supports scenario-specific weights, seeds, reference meetings, warm starts, instructor retention and explicit coverage/load requirements. The Java constraints and TypeScript result validation both enforce the requested restrictions. Quality metrics disclose whether external times are incomplete.
- `section-balancing.ts` balances eligible second-profile sections while preserving course populations and capacity limits. Other profiles retain their prior behavior.
- `small-block-closure.ts` preserves original external source seats while recording unresolved redistribution. `department-reassignment.ts` contains opt-in helpers for a specific department convention (trainer IDs 1–6 and explicit course codes); these helpers are not a general assignment policy.
- `fixed-general-stage.ts` stores exact source times, including evening, self-paced and unspecified modes, without creating departmental assignments. A source-only scenario blocks both solver endpoints and review. Its RTL view disables department-planning controls and exports source times through the existing external CSV endpoint.

No database migration is added. Existing scenario snapshots without the new optional fields continue through their existing planning paths.

## Repository boundaries

Commit source, synthetic fixtures and tests. Keep `.env`, `private-data/`, `test-reports/`, `outputs/`, build output and machine-specific installation reports local. One-off operational scripts and the private-snapshot browser test are explicitly ignored because they depend on local scenario identities and private files. They are not required by the reusable modules or synthetic tests.

`docs/IMPLEMENTATION_STATE.md` remains the factual local implementation ledger. Local operational additions to that ledger are retained on the operator's machine; this document describes the development change without copying database snapshots or machine-specific evidence.

## Validation

Build Java before running Node tests so Timefold integration uses the current solver JAR:

```powershell
mvn -B -ntp -f solver/pom.xml package
npm.cmd test
python -m unittest discover -s scripts -p 'test_*.py' -v
npm.cmd run web:build
```

For PostgreSQL integration, set `DATABASE_URL` to a fresh isolated local test database, apply the existing migrations twice, then run `npm.cmd test` with `TPS_DB_INTEGRATION=1`. Never direct integration tests or synthetic seeding to an operational database.

For synthetic browser checks, serve the frontend on localhost, set `TPS_E2E_MOCK=1` and run:

```powershell
npm.cmd run e2e --prefix frontend -- phase10-11.spec.ts automatic-planning.spec.ts capacity-projections.spec.ts stable-blocks.spec.ts fixed-general-stage.spec.ts
```

These mocked UI tests do not prove operational authentication. Real browser journeys require a separate synthetic PostgreSQL database and ephemeral test credentials. No operational login or real workbook acceptance is implied by the synthetic suite.

### Local verification on 2026-11-10 (Asia/Riyadh)

Verified on Windows 11, Node 24.19.0, npm 11.0.0, Temurin Java 21.0.6, Maven 3.9.11, Python 3.11.1, openpyxl 3.1.5, Docker Engine 26.1.1 / Compose 2.27.0 and PostgreSQL 17. Browser tests used Playwright 1.56.1 against a separate loopback API and a fresh synthetic database.

| Check | Command | Result |
| --- | --- | --- |
| Solver build and Java tests | `mvn -o -B -ntp -f solver/pom.xml package` | 10 passed; executable JAR built |
| Root TypeScript build | `node node_modules/typescript/bin/tsc -p tsconfig.json` | Passed |
| Unit, Timefold and PostgreSQL integration | `node --test dist/tests/*.test.js` with `TPS_DB_INTEGRATION=1` and the isolated test database | 188 passed, 0 failed, 0 skipped |
| Python import/export regressions | `python -m unittest discover -s scripts -p 'test_*.py' -v` | 19 passed |
| Frontend types and production build | `npm.cmd run web:build` | Passed |
| Repeatable database migrations | `node dist/src/api/migrate.js` twice, then `node dist/src/api/check.js` | Passed; all 19 migrations present |
| Repeatable synthetic seed | `node dist/src/api/seed.js` twice with `TPS_ALLOW_SYNTHETIC_SEED=1` on the test database | Passed |
| Real browser journeys | `node frontend/node_modules/@playwright/test/cli.js test --config frontend/playwright.config.ts --workers=1 real-api-journey.spec.ts login.spec.ts external-assignments-real.spec.ts lecture-periods-real.spec.ts smart-import-real.spec.ts` | 5 passed |
| Synthetic UI journeys | Same Playwright command with `TPS_E2E_MOCK=1` and `phase10-11.spec.ts automatic-planning.spec.ts capacity-projections.spec.ts stable-blocks.spec.ts fixed-general-stage.spec.ts` | 10 passed |
| API restart persistence | Compare every synthetic scenario's ID, input/result snapshots, state and solver status before/after restarting the isolated API | Identical |

No failed or skipped tests occurred in these executed suites. Operational authentication, the private-workbook browser test, operational service restart and backup/restore were not run as part of this source handoff. The local test runner and detailed logs remain under ignored `private-data/` and `test-reports/`; credentials, snapshots and generated artifacts are excluded from Git.
