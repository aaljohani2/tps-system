# Security and privacy — TPS local development branch

This document describes controls visible in the current source; it is **not** a security certification or permission for public network deployment. Earlier `docs/legacy/security-bootstrap.md` text was written for the pre-authentication prototype and is historical.

## Implemented controls (verify in CI and Windows before relying on them)

- `src/api/security.ts`: password hashes use Argon2id; server-side sessions persist in PostgreSQL, with a random cookie whose stored value is hashed. The cookie is HttpOnly and SameSite=Strict; `Secure` is environment-controlled and must be enabled whenever HTTPS is introduced.
- `POST /api/v1/auth/login` has a rate limiter; failed attempts are audited with a one-way username identifier rather than storing submitted passwords.
- Backend authentication and scoped role checks are required for operational APIs; write requests require an `X-CSRF-Token` matching the session, with an additional Origin check when supplied.
- Fastify request validation uses Zod on key routes; PostgreSQL queries use parameters; internal server errors are not returned verbatim to clients.
- Strong permission separation: department editing cannot silently modify shared college resources; only authorized approvers can approve mode eligibility, planning policy, load exceptions and scenarios.
- Preview/commit imports restrict file type/size, row count, formula-like values, source links and scope; SHA-256 binds the commit to the reviewed file, with expiry and one-use records.
- Export sanitizes spreadsheet formulas; printable HTML escapes user-supplied data; approved scenario snapshots and manual changes have audit/version controls.
- The Timefold cancel endpoint requires an authenticated editor, CSRF and department scope; a database transaction records cancellation before killing the child. A completed solution cannot be replaced with an earlier cancellation.

## Deployment boundary

- The intended interface and database are reachable on `127.0.0.1` only. There is **no authorized cloud deployment**, LAN/public port, institutional SSO or Rayat connection in the scope.
- Keep `.env`, tokens, private schedules, passwords and identifiable trainee data outside GitHub and CI artifacts. All automated regression fixtures should remain synthetic.
- Never run synthetic `db:seed` or destructive integration tests against an existing operational database; preserve Docker named volumes.
- Do not disable failing checks, replace Timefold silently with greedy, or use an external service for user data.

## Residual risk and uncompleted original-mandate controls

- No independently verified security audit/penetration test, secret scan or full software supply-chain assessment.
- No production TLS or organizational SSO; cookie Secure is conditional on local HTTPS configuration.
- Full fine-grained permission matrix, unified resource archival, concurrency isolation across multiple independent API processes and long-running Java job supervision remain limited.
- Complete unmocked E2E, large-scale performance tests and Windows operating-system verification remain mandatory.
- Browser use with real institutional records must not begin until the owner separately authorizes information handling and local hardening.

## Evidence

`src/api/security.ts`, `src/api/create-app.ts`, `src/api/scenarios.ts`, `src/api/bulk-routes.ts`, `src/api/users.ts`, `db/migrations/`, `tests/api-postgres.test.ts`, `docs/TEST_RESULTS.md` and `docs/ACCEPTANCE_MATRIX.md`. No claim of official TVTC security approval is made.
