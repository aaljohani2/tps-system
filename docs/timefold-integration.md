# Timefold v0.2 — experimental whole-section optimizer

**Status: code implemented, local Java build/runtime unverified.** The runtime environment used during authoring has Java 21 but no Maven and cannot resolve Maven Central. CI must successfully execute the Java tests before merging and claiming operational readiness. The existing GitHub Actions `startup_failure` may block that verification.

## Architecture

`Node PlanRequest` → validated course/room/instructor input → `prepareSolverPayload()` → per-section **atomic candidates** → JSON-over-stdin → Java 21 Timefold Community → selected candidate ID per section → stringent Node `applySolverChoice()` validation → `PlanResult(DRAFT)`.

* Each candidate contains the **entire timetable** for one section (including all theoretical and practical sessions), one trainer and a weighted load; no split of the same section across trainers.
* Each section also has an explicit **UNCOVERED** candidate. Infeasibility cannot be concealed as a false assignment.
* A Timefold planning variable chooses one candidate per section. Hard constraints: instructor/room/block conflicts, trainer credit caps, exclusive course ownership. Soft constraints: minimize uncovered contact and Thursday/evening usage.
* Candidate pool is intentionally bounded to at most 6 variations per instructor by default; **the solver does not generate all possible start times, rooms or instructor allocations**, hence coverage and optimality are limited by candidate generation. A future improvement will introduce finer duration and room search.
* Timefold returns only candidate IDs and score; Node validates selected candidates, instructor eligibility and credited caps, actual contact hours, hybrid hours, conflicts, and room suitability before accepting.
* There is **no silent fallback**: if Java/JAR is not installed or a hard constraint is violated, `/api/v1/plans/optimize` errors; the separate `/preview` remains explicitly greedy.
* No student-level information is required or persisted. All results are drafts and cannot publish into Rayat.

## Build and run

Requirements: Java 21+, Maven 3.9.11+, Node 22+. Then:

```bash
cd solver && mvn -B -ntp clean package && cd ..
npm install
npm test
npm run build
npm start
```

Jar created as `solver/target/tps-timefold-0.2.0-jar-with-dependencies.jar`. Set `TIMEFOLD_JAR` if relocated. Local server accepts `POST /api/v1/plans/optimize` with same JSON as `/api/v1/plans/preview`. Internal Java request schema: `tps.timefold.v1`. CLI reads **only stdin** and writes **only JSON to stdout**; logs go to stderr. Java runtime timeout is bounded (Node default 20 s, max 60 s).

## Known gaps before a pilot

- Passing the Java build, constraint verifier tests and a real Node↔Java end-to-end test in CI.
- Generate richer candidates (diverse rooms/timeslots) and benchmark against sanitized 144720 data.
- Current prototype schedules whole-hour slots only; timetable granularity < 60 minutes is not implemented.
- Add room/date and trainer change rules, external department agreement, locked commitments, per-college RBAC, approvals and persistence.
- Do not treat absent block IDs as verified cohort safety.
