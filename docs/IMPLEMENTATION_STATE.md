# TPS V1 — Implementation state (2026-11-06)

Branch: `feat/full-stack-tps-v1`. Base commit: `3a1d84c` from the previously tested `feat/web-excel-import-v0.3`.

## Engineering increment — structured academic model (2026-11-06)

Implemented in the codebase since the earlier checkpoint:
- Forward-only migration **0004**: `training_programs`, `curriculum_plans`, `curriculum_items`, `cohorts`, `student_blocks`, `block_course_assignments` and `demand_estimates` (with recorded source, confidence and repeat-rate forecast).
- Scope-controlled Fastify APIs and Arabic RTL pages for programs, plan versions, cohorts, blocks, course-to-block term assignments and sourced demand.
- Snapshot generation uses normalized block sizes and cohort identities when assignments exist. Block totals must reconcile exactly with demand; a mismatch returns HTTP 409 rather than creating invented or duplicated sections.
- **30-minute scheduling windows** accepted by TypeScript/Timefold/Java double-based session slots and rendered as HH:MM. Candidate-bounded Timefold remains experimental; half-hour support is not a guarantee of global optimization.
- Course-level manual instructor locks and HYBRID theory/practical onsite/remote split editing with server-side validation.
- Independent readiness validation now checks session duration/time window, trainer availability and eligibility, room type/availability, block identity and hybrid component-hour distribution.
- Live PostgreSQL-scoped dashboard metrics and local administrative user lifecycle (create, deactivate/reactivate, scoped role changes, password reset; stronger-than-UI RBAC and session invalidation).
- Synthetic regression tests for normalized blocks, cohort collisions, half-hour candidates, instructor locks, demand mismatches, dashboard and administrative privilege escalation.

**Not complete:** official curriculum plan lifecycle/activation, prerequisites, detailed assessment of returning students, professional specialization matrix, approved overload workflow, editable weekly timetable with transactional rescheduling, long-running asynchronous solver jobs, bulk import for resources, full report suite, comprehensive browser E2E and Windows verification. Do not move PR to Ready or call the full 15-stage mandate complete.

## Implemented in code (verification scope described below)

- Local-only PostgreSQL Compose and non-destructive migrations 0001–0004; user sessions, audit log, institutions, colleges, departments, terms, courses, instructors, rooms, scenarios.
- Node 22 / Fastify API with Argon2id login, scoped roles, CSRF tokens, rate limit and cookies.
- Institution, college, department, term creation; course creation, demand and block editing; independent institutional-level course-mode eligibility approval; instructor/room creation and PATCH editing. Shared college records have stricter RBAC than department resources.
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

## Full-mandate gap review
The complete original 15-phase mandate has **not** been fulfilled. See `docs/FULL_MANDATE_GAP_REVIEW.md` for an evidence-based P0–P2 matrix. The existing local acceptance matrix tests the implemented foundation only; it is not complete acceptance of all 20 requested functional pages. Treat this branch as **not yet ready for final Codex acceptance tests**.

## Local acceptance
See `docs/ACCEPTANCE_MATRIX.md`. GitHub Actions verifies synthetic Linux builds and integration; Windows/GUI/real-world data validation remains to Codex. Do not treat a successful CI build as the institution's approval.

## Next implementation work

Finish all data-entry/editing modules, institutional policy governance, block relationships, persistent run management, E2E and performance testing; only then consider closing this development phase. Codex handoff remains **strictly local installation and tests**.
