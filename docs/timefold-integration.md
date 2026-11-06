# Timefold integration — TPS V1 (2026-11-06)

## What is actually implemented

- `src/optimizer.ts` prepares atomic, whole-section placement candidates. Every section has an explicit `UNCOVERED` option; a selected placement contains all theory/practical sessions and exactly one instructor.
- `solver/src/main/java/sa/tps/solver/SolverMain.java` invokes Java 21 / Timefold Solver from a bounded JSON-on-stdin contract (`tps.timefold.v1`), returning candidate IDs and hard/soft scores.
- Node verifies selected IDs, instructor eligibility/approved credited loads, room type and capacity, session duration and availability, Thursday/hybrid windows, and instructor/room/cohort/section overlaps. A negative hard score is rejected.
- Weekday slots may start/end on half-hours. The generated candidate pool remains bounded; this is **not unrestricted global schedule search**.
- The `DRAFT` scenario runs through `POST /api/v1/scenarios/:id/solve`. An unoptimized greedy preview is never relabelled as a Timefold solution.

## Solver controls

`POST /api/v1/scenarios/:id/solve` accepts a JSON object, optionally:

```json
{"seconds": 5, "candidatesPerInstructor": 6}
```

`seconds`: integer 1–30; `candidatesPerInstructor`: integer 1–24. Defaults preserve historical behavior (5 seconds, 6 candidates per trainer). Validation occurs before the scenario enters RUNNING. The Java-process timeout exceeds requested solving time and is capped at 60 seconds.

The local API process permits at most two simultaneous Java solver claims; simultaneous solving of one scenario is also prevented by an atomic PostgreSQL transition. This **does not guarantee a cluster-wide limit across multiple independent API processes**.

`GET /api/v1/scenarios/:id/runs` returns durable run records (RUNNING/COMPLETED/FAILED/CANCELLED), timestamps, score and metrics when available.

`POST /api/v1/scenarios/:id/runs/cancel` is available to scope-authorized editors with a valid session and CSRF token. It first commits a PostgreSQL cancellation with audit and then aborts the attached local Java child. A cancellation cannot replace an already committed result. The scenario remains DRAFT and is marked solver FAILED (retryable); the specific run is CANCELLED. If a prior process has died, no live Java child is inferred: use guarded `/runs/recover` after two minutes instead.

**Limitations:** cancellation applies only to jobs owned by this currently running local API process. There is no asynchronous worker queue, server-push status stream, intermediate score series, progress percentage, or cluster-wide cancellation. Network disconnect does not, by itself, cancel a job.

## Validation and CI

- TypeScript/Node tests: `tests/integration.test.ts`, `tests/half-hour.test.ts`, `tests/scenario-scale.test.ts`.
- Real child-abort regression: `tests/solver-cancel.test.ts` when a built JAR exists.
- PostgreSQL/API status and authorization checks: `tests/api-postgres.test.ts`.
- Maven/JUnit: `solver/src/test/java/sa/tps/solver/SolverMainTest.java`.
- GitHub Actions runs real Java cancellation and a synthetic 25-course workload in `api-postgres-integration` after building the JAR.

The synthetic scale fixture covers 25 courses, 6 trainers, 20 rooms, 4 curriculum levels and 20 distinct blocks. It reports elapsed time, gaps and Node RSS; a passing smoke is not evidence of satisfactory performance for every college workload. Verify the **current commit SHA's CI run** before treating any new test as passing.

## Safety boundary and pending work

- Never modify Rayat or assume institutional permission for REMOTE/HYBRID/SELF_PACED.
- Real trainee records must not be committed or copied into CI.
- Remaining original-mandate gaps: richer placement search, all mandatory/soft policy checks at real scale, async job management, live progress, robust multi-process locking/cancellation, full unmocked Playwright workflow and local Windows acceptance.
- Do not merge PR #8 or claim institution-ready scheduling until the full acceptance matrix has been verified.
