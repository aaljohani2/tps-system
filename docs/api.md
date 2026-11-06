# API v0.1 (developer preview)

**No authentication; local-only use.** Default `HOST=127.0.0.1`, `PORT=8787`. Responses are JSON. The only write-like operation generates an **in-memory draft**; no persistent records are created.

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | RTL prototype frontend |
| GET | `/health` | Basic process health |
| GET | `/api/v1/policy/default` | Default four-layer configuration |
| POST | `/api/v1/plans/preview` | Validate scenario, build and return a draft timetable |

`POST` requires `Content-Type: application/json` and a `PlanRequest` JSON object. Working synthetic request: `examples/onsite.json`.

The request schema is defined in `src/types.ts`. Core fields:

- `scenarioName`, `termId` — identified scenario (not official Rayat identifiers).
- `courses[]` — `code`, `title`, `level`, `demand`, `theoryHours`, `practicalHours`, `mode`, `eligibleModes`, optional `blocks` and `assignedInstructorId` and `exclusiveInstructor`.
- `instructors[]` — `id`, `maxLoad`, `allowedModes`, optional course eligibility, declared `overload` and time availability.
- `rooms[]` — `id`, `type` (`CLASSROOM`/`LAB`/`MULTI`), `capacity`, availability.
- `policy` — enabled modes, capacities, practical-load factors, self-paced load policy, allowable windows and session maximum duration.

For `HYBRID`, `hybridSplit` must explicitly allocate all theoretical and practical hours to onsite and remote. The onsite component must end by 12:00; the remote component must start no earlier than 16:00 and finish by 22:00.

Result includes `status: "DRAFT"`, `sections`, `sessions`, `gaps`, `instructorLoads`, `metrics`, `notices`. `gaps` are **not** removed for aesthetic completeness.

Invalid data return `400 {"error":"..."}`. JSON bigger than `MAX_REQUEST_BYTES` is rejected. TLS, RBAC and persistence are not implemented.
