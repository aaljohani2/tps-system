# TPS V1 — Implementation state (2026-11-06)

Branch: `feat/full-stack-tps-v1`. Base commit: `3a1d84c` from the previously tested `feat/web-excel-import-v0.3`.

## Implemented in code (verification scope described below)

- Local-only PostgreSQL Compose and non-destructive migration 0001; user sessions, audit log, institutions, colleges, departments, terms, courses, instructors, rooms, scenarios.
- Node 22 / Fastify API with Argon2id login, scoped roles, CSRF tokens, rate limit and cookies.
- Institution, college, department, term creation; course creation, demand and block editing; instructor and room creation.
- Transactional CSV and XLSX course import with preview, error/warning results and preservation of existing course demand.
- Persistent scenario snapshot, deterministic labelled draft, direct Timefold invocation, uncovered-section report, load report, scenario comparison and revision.
- Gated review/approval; no approval with uncovered sessions or unidentified blocks; immutable approved snapshot in PostgreSQL.
- CSV export and Arabic RTL XLSX export; sanitization against spreadsheet formula injection.
- React/TypeScript RTL staged user journey and local PowerShell script.
- Existing legacy Node/Python/Java solver tests retained. A synthetic PostgreSQL/Timefold integration test added; frontend build check added.

## Not yet implemented or not complete

- Full normalized enterprise data model (programs, prerequisites, training levels, cohort relationships, explicit multi-level policies, user-management screens).
- Instructor/room edit, availability UI, permissions administration and complete CRUD for all objects.
- Institution-controlled policy approval/enablement UI for the four modes. Default policy remains ONSITE-only.
- Detailed block course mapping and every required hard/soft constraint for larger real-world schedules.
- Long-running solver run progress, cancellation, concurrency limiting across processes and robust job persistence.
- Weekly drag-and-drop timetable, conflict explanations linked to every record, room utilization and PDF export.
- Full Playwright journey tested on user's Windows device, larger performance scenarios, restart persistence and recoverability verification.
- Formal security audit and any real integration with Rayat (not authorized).
- Production release approval.

## Verification rules

A successful compiler build does not establish local operational readiness. Integration tests use synthetic data only. Record exact CI job SHA and result in `docs/TEST_RESULTS.md`. Any failed job is a blocker, not something to disable. Never claim optimum global scheduling.

## Next implementation work

Finish all data-entry/editing modules, institutional policy governance, block relationships, persistent run management, E2E and performance testing; only then consider closing this development phase. Codex handoff remains **strictly local installation and tests**.
