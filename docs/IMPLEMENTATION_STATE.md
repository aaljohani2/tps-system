# TPS V1 — Implementation state (2026-11-06)

Branch: `feat/full-stack-tps-v1`. Base commit: `3a1d84c` from the previously tested `feat/web-excel-import-v0.3`.

## New verified engineering checkpoint — candidate diversity and documentation

- Timefold source fix `ddc8afc` diversifies room placements per instructor, preventing multiple valid trainers from artificially sharing one room candidate even when 20 rooms are available.
- GitHub Actions run **42261333608** on `eedd6c5` passed all six jobs, including Java JAR cancellation and actual synthetic scheduling performance. The 25-course fixture improved from **8 covered / 17 uncovered (4291 ms)** to **25 covered / 0 uncovered (4279 ms)**; this is one synthetic fixture, not a guarantee for other inputs. Source regression now checks diversity among trainer/room placements.
- Added the exact originally mandated documentation names: `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md`, `docs/USER_GUIDE_AR.md`, `docs/ADMIN_GUIDE_AR.md`, `docs/SCHEDULING_RULES.md`, `docs/SECURITY.md`. They explicitly distinguish present features from residual gaps.
- **Still open:** wider/unbounded search and preferences, queued solver progress/cluster management, relational course-section constraints, complete resource administration, 20-step unmocked browser testing, larger-scale/adversarial performance, Windows local acceptance and release signoff. The new documentation does **not** close these feature gaps.
- Preserve the development branch and Draft PR #8; only the validated engineering increments may be described as complete. Confirm latest HEAD CI separately.

## P0-07 incremental closeout — live local Timefold control (verified synthetic CI)

- `POST /api/v1/scenarios/:id/solve` now accepts independently bounded `seconds` (1–30; default 5) and `candidatesPerInstructor` (1–24; default 6), records selections in run audit/details, and prevents more than two local Java solver claims at once.
- `POST /api/v1/scenarios/:id/runs/cancel` is a scope/role/CSRF-protected route. It uses a PostgreSQL transaction to mark the active run `CANCELLED`, returns the scenario to `FAILED` (retriable DRAFT), records `CANCEL_SOLVER` audit and aborts the attached Java child process. Cancellation cannot overwrite a result already committed.
- Migration `0011_solver_cancellation.sql` extends the solver-run status check. The user interface displays a guarded cancel action and configurable run settings while polling in-progress work.
- Tests added: pre-aborted input, settings bounds, reject invalid/idle/CSRF cancellation, and actual Java-process abortion when the assembled JAR is available in CI.
- **Not closed:** globally shared concurrency limits across multiple API instances, asynchronous HTTP-independent worker queue, live progress percentage or incremental scoring, free-form search over the complete schedule space, complete P0–P2 scope, Windows acceptance, and 20-step real-API E2E. This work remains on Draft PR #8; no merge/deployment. CI is pending verification against the final HEAD.
- Historical progress paragraphs below describe earlier checkpoints; any contradictory "not implemented" language there is historical, not a current-head assertion. Use this section and the live source plus final CI for recent behavior.

## Phase 10 & 11 engineering closeout — original mandate (§28–32)

See `docs/PHASE_10_11_CLOSEOUT.md` for the complete 26-point traceability matrix, exact source files, API routes and corresponding synthetic tests.

Phase 10 adds complete course and instructor department template columns, independently governed delivery proposals, five protected CSV/XLSX batch kinds, detailed Arabic RTL Excel exports and browser print-to-PDF. Phase 11 adds four weekly timetable views, click-through details, guarded drag/drop, role-aware editor and Arabic actionable record-linked warnings. Backend now permits only strictly improving edits to repair an existing collision without creating new blockers.

**Scope distinction:** these stages can be marked engineering-complete only with HEAD-matching green CI, not locally accepted on Windows until Codex later performs the final installation/tests. Other stages of the original 15-stage mandate remain independently open.

## Engineering increment — preview-based bulk imports and richer reports (2026-11-06)

- New forward-only migrations **0009–0010** adds `import_jobs`: 30-minute creator/scope-bound previews, SHA-256 exact-file check, one-time transaction commit and audit. No uploaded file contents or personal trainee records are persisted in this table.
- **Five bulk import kinds (including course catalog with separate proposed mode approval):** trainers, college rooms, cohort blocks with term course links, and term-specific evidenced demand forecasts. Templates are available as CSV and styled right-to-left XLSX. Resource upserts preserve distinct instructor overload approval; rooms require shared college permissions.
- Previews parse up to **500 rows** and return row-level validation, duplicate and formula-like text errors; source/cohort/course/level links are checked against PostgreSQL. Commit rechecks source references and locks the approved preview in a single transaction. Existing course/block links are never silently deleted.
- Arabic React page `/imports` connects downloads, file upload, row preview, errors and explicit commit. A failed validation saves nothing; changed files or replayed tokens are rejected.
- Python XLSX converter enforces zip decompression/entry bounds, forbids formulas/macros, includes Arabic instruction sheet and does not execute workbook expressions.
- Excel export now includes saved schedules by trainer, room, curriculum level and cohort block, plus the independently calculated readiness issues; optional same-department/term comparison adds a comparison worksheet. All sheets are RTL, formula-injection guarded, and reflect saved scenario snapshots rather than sample numbers.
- Synthetic Node, Python/XLSX and PostgreSQL integration tests verify these behaviors. **They are not user Windows acceptance tests.**

**Remaining:** fully responsive interactive timetable grid, persistent asynchronous Timefold jobs with cancellation/progress, additional specialization/equipment/administrative load constraints, richer decision reporting, comprehensive Playwright E2E, real-world scale tests and Windows local verification. Keep the draft PR unmerged and Codex restricted to local installation/testing.

## Engineering increment — synthetic seed and persistent solver runs (2026-11-06)

- `npm run db:seed` is implemented as an **opt-in** idempotent fixture requiring `TPS_ALLOW_SYNTHETIC_SEED=1`. It creates one fictional college, department, program, plan, term, instructor, two rooms, one course and one block; no passwords or learner-level records. CI runs it twice against disposable PostgreSQL.
- Migration **0008** records every Timefold attempt's run ID, operator, status, start/finish, duration, score, metrics and bounded error. API exposes scoped history and a guarded recovery operation for abandoned RUNNING jobs older than two minutes; runs are still initiated synchronously and **there is no cancellation/progress percentage or real-time streaming**.
- Approved curriculum prerequisite relations now reject direct changes, and plan-item creation locks the draft version to avoid racing an activation.
- The GitHub Actions jobs, not the user's Windows machine, validate these additions on synthetic data. They do not imply full institutional acceptance.

## Engineering increment — manual scheduling, governed loads and plan lifecycle (2026-11-06)

- Migrations **0005–0007** are additive to PostgreSQL: scenario edit revisions + before/after audit, instructor load exception decision records, curriculum prerequisites and activation metadata.
- Only a **solved DRAFT** may receive a manual session move. Backend validates full instructor/room/cohort/time/load constraints, preserves the existing Timefold result provenance, never edits approved or under-review scenarios, and uses row locks plus edit-version conflict detection.
- A trainer change for one session moves the whole section's instructor assignment and **recomputes weighted instructor loads per section**, avoiding multiplied theory/practical credit. The Arabic RTL session editor requires a reason and displays change history. The manual workflow does **not** replace Timefold, optimize other sections, or bypass pre-existing readiness blockers.
- Instructor load exceptions are requested **per term**, pending until an authorized approver explicitly decides. Unapproved or legacy freeform `instructors.overload` is excluded from every *new* scenario's credit calculation; existing approved scenario snapshots remain immutable.
- Curriculum prerequisites cannot self-reference or form cycles. Activating a plan requires an explicit authorized decision with a reason, all prerequisites present in earlier levels, and only one active version per program. Activated plan items are read-only in the API. This is an **internal TPS planning state**, not institutional curriculum approval.
- The alternative-scenario workflow now requires exact new block sizes when normalized cohort demand changes, preventing silent reuse of stale group totals.
- Failed authentication attempts are audit-logged by one-way username hash without storing submitted credentials.
- Synthetic Node/PostgreSQL integration tests exercise CSRF, optimistic edit conflicts, prohibited edits on approved schedules, exception approval and immutability, prerequisite cycles and plan activation, and forked block sizes.

**Still not full mandate:** free-form Timefold search and persistent progress/cancellation, safe per-section auto re-optimization after manual edits, trainer specializations/equipment constraints, comprehensive Excel bulk imports, full reports and realistic performance, multi-stage governance, and 20-step Playwright running on Windows. Do not ask Codex to claim final acceptance yet.

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

- Local-only PostgreSQL Compose and non-destructive migrations 0001–0009; user sessions, audit log, institutions, colleges, departments, terms, courses, instructors, rooms, scenarios.
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
