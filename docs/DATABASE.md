# TPS System — PostgreSQL model and migration safety

**Status:** development schema, migrations `0001`–`0011`. Source of truth: SQL files in `db/migrations/`; this guide describes actual stored entities, not the unimplemented portion of the original mandate.

## Data areas

| Area | Implemented tables (selected) |
|---|---|
| Organization and scope | `institutions`, `colleges`, `departments`, `academic_terms`, `users`, `user_sessions` |
| Curriculum | `training_programs`, `curriculum_plans`, `curriculum_items`, `courses`, `course_prerequisites` |
| Cohorts and demand | `cohorts`, `student_blocks`, `block_course_assignments`, `demand_estimates` |
| Trainers and facilities | `instructors`, `instructor_load_exceptions`, `rooms` |
| Scheduling and governance | `planning_policies`, `scenarios`, `scenario_session_edits`, `solver_runs`, `audit_logs` |
| Imports | `import_jobs`, `course_import_proposals` |

Key relationships: a program belongs to a department; a curriculum plan belongs to a program, and its items reference courses and levels. A cohort belongs to a department and can belong to a program; blocks belong to cohorts, and their course assignments are term-specific. Demand estimates are course+term unique with stored source, confidence and repeat rate. Shared physical rooms belong to a college; instructors belong to departments.

Scenario `input_snapshot` and `result_snapshot` are JSONB snapshots tied to the department and term. The approved snapshot is preserved separately. Session edits record before/after JSONB, author, reason and optimistic `edit_version`. Course import proposals do not approve their proposed delivery mode.

## Database integrity and safe operations

- Foreign keys/uniques/checks exist for core entities. Examples: one active plan per program, one approved instructor load exception per instructor+term, positive block size, and no self-dependency in a course prerequisite.
- Further cycle checks and authorization are enforced by API logic; database FK checks alone do not cover all domain rules.
- `schema_migrations` stores an SHA-256 checksum for each applied SQL script. `npm run db:migrate` uses a transaction and advisory lock. **Never edit an applied migration**; add a forward-only migration.
- `npm run db:check` requires migrations 0001–0013 and checks database reachability.
- Migration 0011 adds `CANCELLED` to `solver_runs.status`; the scenario itself returns to `FAILED` after a cancellation so a DRAFT may be retried.
- An import commit must match the preview's SHA-256, scope, creator and expiry. No orphan records or silent partial writes may be introduced.
- `npm run db:seed` is opt-in only (`TPS_ALLOW_SYNTHETIC_SEED=1`) and **only for an isolated synthetic test DB**. Do not run it against operational data.

## Windows local checks (Codex testing phase only)

1. Check the existing worktree and existing Docker volumes, preserve `.env`, and use a database dedicated to TPS.
2. Migrate and run `npm run db:check`; rerun migrations for idempotence.
3. In a separate synthetic database run API integration tests; never run test migrations or destructive cleanup against existing live data.
4. Restart the PostgreSQL container **without deleting the named volume**, and verify that the same scenario, user and revision records remain.
5. Record machine versions and pass/fail/skip; GitHub Actions' synthetic pass does not establish Windows operational acceptance.

## Explicit gaps

The full normalized model named in the original mandate is **not** represented by one table for every requested noun. Course components/section pairs are currently represented inside course and scenario structures, not complete normalized relational entities. Granular instructor specializations, equipment/restriction models, uniform soft deletion/archiving and broader concurrency controls still require work. Do not mark the schema 100% complete based on migration count.

### Migration 0013: resource qualifications

Courses store `required_specialties` and `required_equipment`; instructors store `specialties` and rooms store `equipment_codes`. All are JSONB arrays defaulting to `[]`. A missing required code blocks scheduling, regardless of room capacity or instructor load. Resource claims are internal planning data, not institutional certification.
