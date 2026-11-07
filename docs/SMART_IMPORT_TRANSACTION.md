# TPS — unified smart-import and safe cohort grouping

**Development review branch:** `feat/unified-smart-import-from-local-20261107` (Draft PR #9).
**Primary deployment:** loopback-only Windows with the dedicated `tps_operational_local` database.
**Release state:** GitHub synthetic verification only until exact-HEAD CI, real approved files, backups, Windows user acceptance and controlled local cutover.

## One-button import transaction

The `/imports` primary action sends SHA-256-verified original CSV/XLSX files in a single
`POST /api/v1/automatic-planning/full-import?departmentId=<UUID>` call. The browser never sends learner names or numbers as separate database records. The API accepts a bounded JSON payload (40 MiB limit; at most 20 MiB per file, 25 MiB combined source bytes), rechecks SHA-256 and parses the **original bytes again**. It derives curriculum levels, course hours, student counts with deduplication, and instructor-course evidence. It enforces authenticated editor RBAC, department/term/college scope, requested program identity, plan source integrity and selected alternative paths.

The API uses **one PostgreSQL transaction** for:
1. New program (only when necessary) and a versioned DRAFT plan.
2. Upserting compatible academic courses without rewriting the hours/level of an active plan.
3. Importing **new** instructors only; old trainer permissions/eligibility never overwritten and REMOTE is never granted by historical timetable evidence.
4. Recording level source provenance, exact demand (no unverified +5% multiplier), stable base cohorts/blocks and course links.
5. Creating the scenario DRAFT from the **imported curriculum version only** using the **same transactional DB client**, rather than reading unrelated department courses.
6. Recording the scenario-to-plan audit and immutable receipt, keyed by a hash of source bytes and validated operating choices.

All six commit together or roll back together. An exact repeated upload returns its previous receipt/scene rather than creating duplicate cohorts. A failed re-import does **not** truncate or replace working records. No source learner-level records, uploaded files, passwords or encryption keys are stored in the receipt.

The Java solver is explicitly **the next step after commit**. A failed or cancelled Java run does not undo valid imported academic data, and the UI must report the real solver state; do not claim an optimized timetable from a deterministic DRAFT.

## Scoped, non-template input

Plan levels are read directly from the plan, not requested manually.
Trainee CSV/XLSX can hold one row/student, multiple course registrations, repeated meeting rows,
outstanding/fulfilled course rows or aggregated level counts.
Within a recognized department/college column, learner rows are filtered to the selected
scope before counting. Blank or different-scope learner rows cannot silently enter the selected department.
When several available files disagree about level counts, the user must choose the correct source:
the largest number is **not** automatically taken as authoritative.

Numbers from previously fulfilled/remaining coursework are a conditional level-transition
estimate, not confirmed enrollment. Historical planning sheets remain historical until validated.

## Practical blocks vs merged theory sections

Base `student_blocks` stay intact and continue to support all the course-to-block assignments.
For a **pure-theory timed course**, `packTheoryBlocks` applies deterministic
first-fit-decreasing bin packing **within each existing cohort** up to the effective approved
lecture capacity. It never splits a block, imports a participant list, or merges different cohorts.
Practical or mixed courses keep their base block partitions.

A merged section saves `blockGroups` in its immutable input snapshot and `blockIds` in
its sections and sessions. Draft placement, Java Timefold `SessionSlot.conflictsWith`,
post-solve verification, readiness/approval and manual editing all compare the underlying
shared student-block memberships, not just their human-readable merged group label.
A flat scenario fork cannot rewrite a merged group's membership without rebuilding it
from the verified base assignments. Legacy single-block snapshots remain supported.

**Important capacity limitation:** this is capacity-feasible whole-block bin packing, not
global optimal bin packing or student-level repartition. For example, five base blocks of
40,40,40,40,5 can safely create two <=100 theory groups with sizes 85 and 80.
When base blocks cannot fit the theoretical minimum, actual sections can exceed
`ceil(students/capacity)`. The API returns actual `scheduledSections` and
`theorySectionsCombined`; do not substitute the theoretical preview count.

## Evidence and checks

Synthetic regression coverage:
- Original project Node, Python/XLSX, PostgreSQL, Windows and Java build suites.
- A real PostgreSQL atomic imported scenario, exact hash replay, and forced manual-demand
  conflict proving rollback of both newly created program and plan.
- A mixed-department learner file where out-of-scope trainee rows are excluded before demand.
- A 105-student example: base blocks 30+30+30+15 give **4 mixed/practical sections**
  and **3 pure-theory sections** under approved 45-seat theory capacity, with all
  four constituent block IDs preserved in section snapshots.
- Unit example 165 students in 40+40+40+40+5 base blocks, packing into two <=100
  lecture groups, with no duplicate or split membership.
- Java direct conflict and TypeScript readiness tests: a theory lecture containing B02
  cannot overlap a practical class for B02 even with different trainer/room IDs.
- Mock browser integration: all source files pass through one verified request;
  real API browsing uses isolated synthetic PostgreSQL and Timefold.
- Additive schema migrations 0015–0016. No migration rewrites an earlier migration.

## Restrictions and remaining work

- Do **not** merge this draft PR into the working production instance or migrate the live database
  until exact HEAD CI succeeds, encrypted backup is verified, independent local
  restore rehearsal passes and real scoped file previews are approved.
- Files on the user's Windows desktop, current operating DB data, and external systems such
  as Rayat are not accessed or exported by GitHub Actions. Their acceptance must be completed
  separately by Codex on the user's own machine, on an isolated test database first.
- Imported trainer timetable rows establish past teaching/course evidence only.
  Availability, course specializations, authorized modes, actual room capacities and
  official institutional approvals are **not** inferred from historical assignments.
- A queued Java solve is not a durable cross-process worker/restart-proof orchestration system.
- Historical legacy partial save buttons remain supported for manual stepwise work;
  for all-or-nothing **unified import** use the primary one-button workflow.
