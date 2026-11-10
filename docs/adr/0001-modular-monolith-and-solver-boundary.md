# ADR-0001 — Domain-first modular foundation, independent solver boundary

**Status:** Accepted for bootstrap / 2026-11-06

## Context
The system must support four selectively enabled teaching modes, a 1:1 theory/practical pairing rule, weighted teaching load, section sizing, instructors, physical room suitability, student blocks, and hard/soft constraints. It must not disguise infeasibility as success. The target can grow from one department to several colleges.

## Decision
1. Start with a stateless domain-first TypeScript/Node 22 proof-of-concept and Arabic RTL local UI; the prototype uses only aggregated course demand.
2. The deterministic greedy planner is **not** the production optimizer. Its purpose is to check basic invariants and establish API contracts and reference test cases quickly.
3. Isolate planning as `buildDraftPlan(PlanRequest): PlanResult`. Replace the internal allocation strategy with a Timefold Solver-backed optimization service (likely Java 21) behind a versioned adapter; preserve the external request/result contract only after compatibility tests.
4. Future persistence and multi-tenant RBAC belong outside the planning core. Explicit scenarios and approval states must precede any real-world write-back.
5. Do not integrate directly with Rayat before institutional access, authorization, and data contracts are verified.

## Consequences
- v0.1 can run without a database or Java solver. This is a deliberate limited foundation, not a substitution for the selected Timefold architecture.
- The greedy baseline can report additional gaps even when a mathematically feasible timetable exists; it has **no optimality guarantee**.
- Node 22 + TypeScript keeps the initial frontend/API lightweight. Adding the Java optimizer will require a service boundary, versioned schema, performance tests, licensing review and operational observability.
- Authentication, secure storage, XLSX/CSV imports and production deployment are explicitly deferred. The server binds to 127.0.0.1 by default.

## Non-goals of bootstrap
A finished production site; regulatory approval of training modes; access to real trainee information; publication to Rayat; automatic verification of university-specific legal or institutional rules.
