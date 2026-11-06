# TPS V1 — Implementation state (2026-11-06)

Branch: `feat/full-stack-tps-v1`. Base commit: `3a1d84c` from the previously tested `feat/web-excel-import-v0.3`.

## Implemented in code (verification scope described below)

- Local-only PostgreSQL Compose and non-destructive migration 0001; user sessions, audit log, institutions, colleges, departments, terms, courses, instructors, rooms, scenarios.
- Node 22 / Fastify API with Argon2id login, scoped roles, CSRF tokens, rate limit and cookies.
- Institution, college, department, term creation; course creation, demand and block editing; instructor/room creation and PATCH editing. Shared college records have stricter RBAC than department resources.
- Department+term planning policies with pending and approved revisions; mode, capacity, load factors and time windows are validated. Scenario creation uses only approved policy (or ONSITE default), never unapproved client overrides.
- Scenario forking with alternative demand and blocks, parent lineage, immutable original scenario, and approval-ready analysis.
- Transactional CSV and XLSX course import with preview, error/warning results and preservation of existing course demand.
- Persistent scenario snapshot, deterministic labelled draft, direct Timefold invocation, uncovered-section report, load report, scenario comparison and revision.
- Gated review/approval, independently rechecked sessions/rooms/cohorts/load/collisions; no approval with uncovered sections or missing cohort IDs; immutable approved snapshot in PostgreSQL.
- CSV export and Arabic RTL XLSX export with explicit APPROVED/NOT_APPROVED state and policy version; sanitization against spreadsheet formula injection.
- React/TypeScript RTL staged user journey and local PowerShell script.
- Existing legacy Node/Python/Java solver tests retained. A synthetic PostgreSQL/Timefold integration test added; frontend build check added.

## Not yet implemented or not complete

- Full normalized enterprise data model (programs, prerequisites, training levels, cohort relationships, explicit multi-level policies, user-management screens).
- Bulk instructor/room import, mass editing and delete/archive management, user administration and complete CRUD for all objects.
- Formal institutional documentation or credential workflow to authorize individual course delivery modes; current policy approval is an internal planning-system control, not TVTC permission. The default remains ONSITE-only.
- Detailed cross-course block/learner demand model, prerequisites, electives and all hard/soft constraints for large real-world schedules. The existing solver is candidate-bounded.
- Long-running solver run progress, cancellation, concurrency limiting across processes and robust job persistence.
- Weekly drag-and-drop timetable, conflict explanations linked to every record, room utilization and PDF export.
- Full Playwright journey tested on user's Windows device, larger performance scenarios, restart persistence and recoverability verification.
- Formal security audit and any real integration with Rayat (not authorized).
- Production release approval.

## Verification rules

A successful compiler build does not establish local operational readiness. Integration tests use synthetic data only. Record exact CI job SHA and result in `docs/TEST_RESULTS.md`. Any failed job is a blocker, not something to disable. Never claim optimum global scheduling.

## Local acceptance
See `docs/ACCEPTANCE_MATRIX.md`. GitHub Actions verifies synthetic Linux builds and integration; Windows/GUI/real-world data validation remains to Codex. Do not treat a successful CI build as the institution's approval.

## Next implementation work

Finish all data-entry/editing modules, institutional policy governance, block relationships, persistent run management, E2E and performance testing; only then consider closing this development phase. Codex handoff remains **strictly local installation and tests**.
