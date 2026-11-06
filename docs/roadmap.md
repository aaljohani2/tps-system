# Roadmap / Delivery status

| Release | Scope | Status |
|---|---|---|
| Bootstrap 0.1 | Repository, domain model, policy, input checks, draft planner, tests, API, RTL preview | Implemented as prototype |
| 0.1 hardening | Course demand estimates, real CSV/XLSX import, hour fractions, robust conflict proofs, output XLSX, UI forms | Next |
| 0.2 | Timefold Java 21 optimizer adapter; hard/soft constraint score; stable solver runs; exclusive course assignment across instructor workloads | Planned |
| 0.3 | Optional remote and its practical weighted load, course-level authorization, virtual capacity 120 | Domain rules available; production policy/solver pending |
| 0.4 | Optional self-paced, supervision-load rules, asynchronous assessment | Domain rules available; approval workflow pending |
| 0.5 | Optional hybrid, morning/on-site and 16–22 remote sessions, explicit hour split | Domain rules available; timetable optimizer pending |
| 1.0 | Roles, multi-college tenants, scenario versions, approval, exports, monitoring, institutional integration (only after approval) | Planned |

## GitHub issues for next milestone
- `Optimizer`: Build a Timefold Solver Java module with hard and soft constraints, benchmark against current scenarios and test invariants.
- `Data import`: CSV/XLSX templates, course curriculum reconciliation, level demand estimate with transparent 5% margin and no double-counting.
- `Scheduling`: Use fractional-hour resolution where institutional schedules require it, and verify real cohort membership.
- `Operations`: Persistent scenario store, authenticated RTL admin, RBAC and audit log.

**Definition of done:** deterministic regression fixtures, zero hard violations in approved outputs, explicit uncovered demand and documented authorization. Test with sanitized term 144720 data, **not** personal student data.
