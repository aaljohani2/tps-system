# TPS System — architecture (V1 development branch)

## Scope and deployment

TPS is a **local-only modular monolith**, not a hosted institutional service and not connected to Rayat. Main code lives in `aaljohani2/tps-system`, development branch `feat/full-stack-tps-v1`, Draft PR #8. The intended Windows workspace is `<LOCAL_TPS_DIR>`; the app is served on `127.0.0.1:8787` with a separate loopback PostgreSQL port by default.

## Runtime components

| Component | Implementation | Responsibilities |
|---|---|---|
| Frontend | `frontend/src`, React, TypeScript, Vite | Arabic RTL navigation, preview/commit imports, resources, policy, block/demand screens, scenario lifecycle, weekly grid and audited manual edits |
| Web/API | `src/api`, Fastify, TypeScript, Zod | Auth/session/CSRF, role and college/department scope, APIs, approval checks, snapshots, audit, exports |
| Planning rules | `src/planner.ts`, `src/validation.ts`, `src/optimizer.ts` | Demand/section generation, eligibility, credited loads, half-hour candidate generation and validation of returned solutions |
| Solver | `solver/`, Java 21 + Timefold | Select a whole-section atomic placement among bounded candidates; explicit uncovered alternative |
| Database | PostgreSQL + SQL migrations in `db/migrations` | Durable users, academic structure, demand, policy revisions, scenarios, run history, audits and imports |
| File converters | `scripts/`, Python/openpyxl | Bounded XLSX parsing, safe templates and saved-scenario RTL exports |

### Operational request path

1. Login creates a server-side session identified by a hashed cookie value.
2. User chooses institution/college/department/term; the server enforces authorization independently of the UI.
3. Imports follow file validation → row-level preview → explicit commit guarded by hash, creator, scope, expiry and PostgreSQL transaction.
4. A scenario contains immutable inputs and current result snapshots. DRAFT initialization is a labelled deterministic preview, not Timefold.
5. The user explicitly invokes Timefold: TypeScript generates bounded atomic candidates, Java solves, TypeScript validates, PostgreSQL records the result or failure. An authorized operator can cancel an active attached Java child without approving its partial result.
6. Readiness and approvals are server-validated. Approved snapshots are preserved. Output files read persisted snapshots, not demonstration data.

## Known architectural limits

- Scheduling choices are bounded; neither complete combinatorial search nor global optimality is claimed.
- Solve requests currently occupy an HTTP lifecycle; there is no durable background task queue or live progress stream.
- Java concurrency and cancellation are enforced for the current API process, not a distributed cluster.
- Half-hour weekly grid/links exist, but complete browser-driven real-API acceptance on Windows is pending.
- Internal planning approval is **not** an official TVTC/Rayat institutional approval.
- Current security posture is localhost and synthetic CI only; production and external exposure are excluded.

## Primary source of truth

`src/api/create-app.ts`, `src/api/scenarios.ts`, `src/api/security.ts`, `src/optimizer.ts`, `solver/src/main/java/sa/tps/solver/SolverMain.java`, `db/migrations/`, `frontend/src/App.tsx`. For remaining requirements and local evidence use `docs/FULL_MANDATE_GAP_REVIEW.md`, `docs/ACCEPTANCE_MATRIX.md`, `docs/TEST_RESULTS.md`. Do not treat historical prototype text as current implementation.
