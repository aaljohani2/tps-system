# API v0.2 (developer preview)

**No authentication; local-only use.** Default `HOST=127.0.0.1`, `PORT=8787`. Responses are JSON. The only write-like operation generates an **in-memory draft**; no persistent records are created.

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | RTL prototype frontend |
| GET | `/health` | Basic process health |
| GET | `/api/v1/policy/default` | Default four-layer configuration |
| POST | `/api/v1/plans/preview` | Validate scenario and build greedy draft only |
| POST | `/api/v1/plans/optimize` | Invoke Timefold Java 21 candidate optimizer if locally installed, otherwise explicit error (never fallback) |
| POST | `/api/v1/catalog/import-csv` | Import curriculum CSV (text/csv), returns course catalog with zero enrollment |

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

## Timefold optimize contract

`/optimize` takes the exact `PlanRequest` from `/preview`. Local Java 21 and built JAR are required. Returns the same `PlanResult` shape with an explicit solver notice, or `503` if the solver is missing / invalid / times out. `timefold.v1` internal JSON is documented in `docs/timefold-integration.md`. A candidate pool constrains the optimization search space; global optimality is not asserted.

`/catalog/import-csv` accepts `Content-Type: text/csv`, requires a schema with Arabic training-course headers, and returns `tps.catalog.v1` with `courses`, `ignored`, `warnings`. Never infer registration numbers or authorize remote teaching from an imported catalog.


### `POST /api/v1/catalog/import-xlsx` — v0.3 local development only

- Accepts raw `.xlsx` body with `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
- Maximum request 5 MiB by default; returned payload `tps.catalog.v1` includes course-level demand from sheet `المقررات`.
- Requires Python 3 and `openpyxl` on the **server**, invokes `scripts/import_xlsx.py` in a child process and removes its temporary copy.
- Returns `400` for invalid workbook, `413` for excessive request size, `415` for wrong content type, `503` if Python/OpenPyXL is unavailable.
- No personal learner fields, session storage or direct Rayat upload. **Not suitable for public deployment without auth/RBAC and file scan controls.**
- `GET /templates/courses.xlsx` and `GET /templates/curriculum.csv` download filled example templates for term 144720.
