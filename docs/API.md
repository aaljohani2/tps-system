# TPS System — current Fastify API (local development)

**Source of truth:** `src/api/*`. All operational routes use `/api/v1` and PostgreSQL. Swagger is registered through `src/api/create-app.ts`, but not every route has a complete request/response schema; do **not** assert full OpenAPI coverage.

## Authentication and response conventions

- `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, `POST /api/v1/auth/logout`. Server-side session with HttpOnly SameSite cookie; authenticated write requests require an `X-CSRF-Token` header from `auth/me`.
- Request validation is primarily Zod with role and department/college scope checks in the backend. Common failures use `400` (invalid request), `403` (authorization/CSRF), `404` (absent record) and `409` (conflicting version/state). Over-capacity local Java solving returns `429`.
- `GET /health` checks PostgreSQL and returns local-only status.

## Endpoints by domain

| Domain | Methods and paths (prefix `/api/v1` omitted) |
|---|---|
| Organization | GET/POST `/institutions`, `/colleges`, `/departments`, `/terms` |
| Courses and facilities | GET/POST `/courses`, `/instructors`, `/rooms`; PATCH `/courses/:id`, `/instructors/:id`, `/rooms/:id`; PUT `/courses/:id/eligibility` |
| Curriculum | GET/POST `/programs`, `/plans`, `/plans/:id/items`, `/cohorts`, `/blocks`; PATCH `/blocks/:id`; GET/POST `/assignments`; DELETE `/assignments/:id`; GET/PUT `/demand` |
| Prerequisites | GET/POST `/prerequisites`; DELETE `/prerequisites/:id`; POST `/plans/:id/activate` |
| Policies | GET/PUT `/policies`; POST `/policies/approve` |
| Dashboard and users | GET `/dashboard`; GET/POST `/users`, PATCH `/users/:id`, PUT `/users/:id/password` |
| Trainer exceptions | GET/POST `/load-exceptions`; POST `/load-exceptions/:id/decision` |
| Scenarios | GET/POST `/scenarios`; GET `/scenarios/:id`, `/scenarios/:id/readiness`; POST `/scenarios/:id/solve`, `/review`, `/approve`, `/reject`, `/revise`, `/fork`; GET `/scenarios/compare` |
| Scheduling edits | GET `/scenarios/:id/edits`; PATCH `/scenarios/:id/sessions/:sessionId` |
| Timefold operations | GET `/scenarios/:id/runs`; POST `/scenarios/:id/runs/cancel`, `/runs/recover` |
| Exports | GET `/scenarios/:id/export.csv`, `/export.xlsx`, `/print` |
| Batch imports | GET `/import/batch/:kind/template.csv`, `/template.xlsx`; POST `/import/batch/:kind/preview`, `/commit`; GET `/import/batch/courses/proposals` |

Supported batch `:kind`: `courses`, `instructors`, `rooms`, `blocks`, `demand`. The preview/commit workflow protects file integrity, expiry, permissions and transactionality; templates are synthetic and no import changes course-mode authorization automatically.

## Timefold request example

`POST /api/v1/scenarios/:id/solve` with authenticated session and CSRF:

```json
{"seconds": 5, "candidatesPerInstructor": 6}
```

Both keys are optional; bounds are 1–30 seconds and 1–24 candidates per trainer. A second running solve of the same scenario returns 409. The API process admits at most two Java solver operations concurrently. `POST /runs/cancel` cancels only an attached live process; cancellation is transactionally audited, the specific run is marked `CANCELLED`, and the draft scenario becomes retryable with solver status `FAILED`. The bounded candidate solver does not claim a globally optimal result.

## Important limits

- Several lists use fixed limits rather than uniform pagination; not all CRUD/soft-delete/search operations from the original mandate exist.
- User-role and delivery-mode approval are **internal planning controls** and do not confer official training authority.
- The old lowercase `docs/api.md` describes the historic v0.2 prototype; this file documents the current local V1 API.
- API results in CI use synthetic fixtures; the unmocked 20-step browser journey and Windows acceptance remain outstanding.
