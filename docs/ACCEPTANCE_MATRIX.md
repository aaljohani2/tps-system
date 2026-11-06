# TPS — Local acceptance matrix for Codex (synthetic data only)

**Only install and run tests on the user's Windows PC.** Do not change source code, commit, push, merge or deploy. Use only fictional names and IDs.

| ID | Action | Expected local result | Category |
|---|---|---|---|
| A01 | Install Node/React/Python/Java dependencies | No missing package; backend/frontend/Java compile | Environment |
| A02 | Start loopback PostgreSQL and run all SQL migrations twice | 0001–0009 installed; second run idempotent | DB |
| A03 | Create first admin and login/logout | Argon2id hash; session cookie; no default password | Auth |
| A04 | Make request without CSRF | 403, nothing changed | Security |
| A05 | Create two colleges/departments; sign in as scoped head | Other departments inaccessible; shared college objects not modifiable | Tenant scope |
| A06 | Create a term with valid start/end, enter synthetic course | Course visible only in selected department | Catalog |
| A07 | Upload CSV then XLSX template; preview before commit | Columns/errors visible, upsert does not destroy previous demand | Import |
| A08 | Enter trainer, eligibility, base load, approved exception and availability | Values persist; invalid Thursday window rejected | Resources |
| A09 | Enter room/lab capacity and edit availability | Resource reflected in planning; no unauthorized department-level edits | Resources |
| A10 | Change policy in a draft (enable REMOTE) | Effective mode remains ONSITE until explicit approval | Policy |
| A11 | Approve policy as authorized role | Future scenarios use approved revision; past snapshots unchanged | Policy |
| A12 | Create synthetic scenario and plan sections | Sections generated, uncovered items shown explicitly | Scheduling |
| A13 | Run Timefold; send second concurrent request | Single successful run, duplicate returns 409; never silent greedy fallback | Solver |
| A14 | Evaluate readiness | Missing block, room capacity, uncovered hour, timetable collision block approval | Quality |
| A15 | Fork from an existing scenario with different demand and blocks | Original unchanged, fork records parent ID, comparison differs | Scenarios |
| A16 | Submit for review and approve feasible scenario | Only authorized approver; approved snapshot immutable | Governance |
| A17 | Export DRAFT and APPROVED CSV/XLSX | State indicated in filename/data; Excel RTL and formula-safe | Exports |
| A18 | Restart local PostgreSQL (without volume deletion) | Saved scenarios, users, policy revisions remain | Persistence |
| A19 | Open React RTL flow on Chromium locally | No client errors; screens connect to API | Browser |
| A20 | Try creating scenario with request-supplied unapproved policy | HTTP 400; no bypass | Security |

| A21 | Move a solved draft session by 30 minutes, change instructor and verify audit | Whole-section credit recomputed, no collision, version increments | Manual scheduling |
| A22 | Submit stale edit version or edit under-review/approved schedule | 409; approved snapshot untouched | Immutability |
| A23 | Request a term-specific instructor overload | Pending has no effect; only approved record appears in new snapshot | Governance |
| A24 | Create prerequisite cycle and activate incomplete plan | Circular prerequisites and missing earlier-level course block activation | Curriculum |
| A25 | Modify activated plan item | HTTP 409 and prior curriculum remains unchanged | Curriculum |
| A26 | Fork normalized cohort with new demand and no block sizes | Rejected; explicit matching block sizes accepted | Cohort integrity |

| A27 | Run Java Timefold and inspect durable attempt history | RUNNING then COMPLETED/FAILED, run ID and duration/score persisted | Solver jobs |
| A28 | Try recovering a healthy run, and recover an abandoned run aged >2 minutes | Healthy run 409; abandoned run moves to FAILED with audit | Solver recovery |
| A29 | Invoke seed without explicit opt-in; then run twice in isolated test DB with opt-in | No execution by default; exactly one consistent synthetic fixture after both runs | Safe seed |
| A30 | Attempt failed local login | Audit event stored with hashed user identifier; no raw password | Authentication |

| A31 | Download CSV/XLSX templates for trainers, rooms, blocks, and demand | Arabic RTL XLSX, correct schemas; formulas/macros rejected | Bulk import |
| A32 | Preview an invalid CSV with duplicate keys and wrong room capacity | Row-level errors; no database rows created | Import validation |
| A33 | Commit a successfully previewed file exactly once | All rows upserted in one PostgreSQL transaction; audit + import-job state recorded | Import commit |
| A34 | Modify the file between preview and commit or replay same importId | HTTP 409; no partial writes | Import integrity |
| A35 | Try importing shared college rooms as a department-scoped user | 403; no college resources modified | Tenant authorization |
| A36 | Import linked cohort blocks with unknown course or mismatched level | Preview fails; no orphan/mismatched course assignments | Referential integrity |
| A37 | Export Excel with 2 saved scenarios and readiness issues | RTL trainer/room/level/block/conflict/compare sheets reflect persisted data | Reports |

## Inputs

Use only synthetic: course TEST-101, cohort BLK-1, instructor I-1, room R-1; term dates should fall inside a fictional year/term. For a fork, increase demand enough to create two sections and supply two distinct block IDs.

## Evidence and signoff

For each row record: timestamp, machine versions, command/request used, pass/fail/skip, failure excerpts, screenshots if useful, and correction recommendation. Do not mark unrun tests as passing. Never perform destructive cleanup against an existing project checkout or database volume. A CI pass does not substitute for these local Windows checks.

## Scope exclusions

No Rayat API connection, no student personal records, no production deployment, no official institutional approval, and no claim that bounded Timefold candidate search always produces a global optimum.
