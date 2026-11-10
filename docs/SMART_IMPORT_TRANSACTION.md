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

## Windows update and guarded local trial

This source increment has a dedicated **PowerShell 5.1** updater:
`scripts/upgrade-smart-import-windows.ps1`. It runs only on
`feat/unified-smart-import-from-local-20261107` with a clean tracked Git
worktree and **never forces checkout, reset, deletes a DB, or publishes files**.

### 1. Get the updater without touching the operational database

```powershell
Set-Location <LOCAL_TPS_DIR>
git status --short
git pull --ff-only origin feat/unified-smart-import-from-local-20261107
```

Stop and reconcile any conflicting **tracked** source changes rather than
resetting. This checkout contains no real learner files.

### 2. Stop only the live TPS API before installing native Node dependencies

**Windows native files can be locked:** a running Node/Fastify instance keeps the
`node_modules/argon2/prebuilds/win32-x64/argon2.glibc.node` binary open. Running
`npm ci` against that active installation fails with `EPERM/unlink` and may leave
`node_modules` partially changed. **Never delete it or force-kill another service.**

Finish any live Timefold solve, verify the latest encrypted operational backup has
already been validated, and stop only the app, **not Docker/PostgreSQL**. If the
optional user-owned `TPS Local Production` Windows scheduled task exists,
temporarily disable it *before* stopping it (its restart policy can otherwise
start Node again). Otherwise press Ctrl+C in the known app server console.
Verify nothing is listening on TCP port 8787 before starting preparation:

```powershell
$task=Get-ScheduledTask -TaskName 'TPS Local Production' -ErrorAction SilentlyContinue
if($task){
  Disable-ScheduledTask -TaskName 'TPS Local Production'
  Stop-ScheduledTask -TaskName 'TPS Local Production' -ErrorAction SilentlyContinue
}
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
```

If the last command still shows a listener, inspect
`Get-CimInstance Win32_Process -Filter "ProcessId = <OwningProcess>"`
and stop only the verified TPS server gracefully; never use blind
`taskkill /F`, `git clean`, `npm cache clean`, or volume deletion.

### 3. Prepare offline (operational encrypted backup + independent restore + builds)

Obtain an exact-green `TPS checks` run ID of the **same feature HEAD**. It
must include the `tps-timefold-jar` artifact, retained seven days. Maven
users do not need GitHub CLI. If Maven is absent, authenticate a supported
GitHub CLI once (`gh auth login`) before running the updater; the installer
will refuse any artifact whose run is not SUCCESS for the exact downloaded
source commit.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/upgrade-smart-import-windows.ps1 -Action Prepare -VerifiedRunId <GREEN_RUN_ID>
```

A securely prompted backup passphrase (24+ characters) is used for the
local operational database backup/verification and an independent isolated
restore rehearsal. Keep the passphrase in an approved secure offline
location, not in Git, logs or chat. Prep also performs `npm ci`,
`web:install`, API + web builds, verified Java solver build/download and
`npm test`. It saves only a checksum receipt in ignored `private-data`
and **refuses to start dependency installation if any service still
listens on port 8787**. It does not restart or change the database schema
until explicit `Start`.

### 4. Controlled local activation only

Before starting, confirm the `PREPARE_SUCCESS` message and that port 8787
remains free. Leave Docker/PostgreSQL and its named volumes intact.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/upgrade-smart-import-windows.ps1 -Action Start
```

`Start` demands the prepared exact commit/JAR/backup hashes, rejects any
busy port, applies only forward migrations 0015/0016 to
`tps_operational_local`, checks the DB and starts actual Fastify/React
on `127.0.0.1:8787`. It is a **foreground process**: leave its console
open. In a second PowerShell window:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/upgrade-smart-import-windows.ps1 -Action Status
Invoke-RestMethod http://127.0.0.1:8787/health
```

Require `status=ok`, `database=ok`, `mode=local-production`.
Log in, visit `/imports`, inspect detection of program/department/plan,
unique trainee counts, conflicting source warnings, class capacity and
the actual draft section counts. Use only authorized files or synthetic
fixtures on a disposable database until on-device validation is complete.
The one-click action must write a single receipt, leave old approved
scenarios unchanged and allow inspecting a new scenario. Run Timefold
and verify its status explicitly; a DRAFT is not an approved timetable.

If preparation fails after the old app is stopped, **do not start the new
version**. Investigate the failed command and repair dependencies while keeping
the operational database and the verified backup intact. Resume the original
application only if its runtime dependencies are known to be complete.
If migration or new runtime fails, retain the encrypted backup and
isolated restore evidence; stop and inspect before any rollback. A
forward migration cannot be undone by merely reverting source code.
Do not restore over the operational database or delete the volume.

**Do not merge draft PR #9 merely to test locally.**


## Rayat-style resource discovery: instructors and college rooms

Two places in the TPS frontend expose **استيراد مدربي وقاعات رايات من Excel**:
\`/resources\` and \`/imports\`. Authorized users select one Excel (\`.xlsx\`) or CSV file
from an exported timetable, instructor directory, or room list. This is **file
ingestion only**, not an online connection or modification of Rayat.

On **preview**, the backend detects worksheet header rows (including headers
after informational rows), recognizes Arabic and English column aliases,
deduplicates instructor/room identities across repeated meetings, checks
college/department evidence, and flags unknown room capacity/type and
placeholder instructor names. Raw source files are never stored in the database.
One educational planning workbook, for instance, has an instructors sheet
with placeholders such as *رئيس القسم — اكتب الاسم* and a timetable with
room codes such as EXAMPLE_ROOM_001 but no room capacity: the importer deliberately
does not invent real instructor names or room capacities from those rows.

The user reviews the preview. A college administrator (or system administrator)
may import college-wide rooms and must supply an explicit room capacity/type
for every new incomplete room, or opt to skip incomplete rooms. Department
editors can import their trainers but **cannot add or alter shared college rooms**.
Unscoped spreadsheets require explicit user confirmation of the selected
college/department. Rows tagged with another college are excluded; instructors
in another department are excluded, while genuine college-shared rooms
can still be imported.

**Commit** reparses original bytes, verifies SHA-256 against the preview
and writes only new instructor/room records in a **single PostgreSQL
transaction**, including an audit entry. Existing resources are never
overwritten, archived or granted new qualifications by imported files.
Historical timetable instructor-course links are **evidence**, not a future
certification of competence. Newly imported instructors start with
\`eligible_course_codes=[]\`, \`allowed_modes=["ONSITE"]\`, unknown load
recorded as zero, and no claimed future availability, pending verified
administrative configuration. A room without a verifiable type and capacity
cannot become a schedulable room unless reviewed/corrected.

The live local operational database is not touched by GitHub development;
use only the approved local deployment procedure after current-HEAD CI
is green. For sample institutional files, review row-level authorization
and avoid uploading personally identifying learner data to GitHub.
