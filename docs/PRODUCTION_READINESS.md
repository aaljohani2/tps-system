# TPS — Production readiness and controlled rollout (2026-11-06)

## Decision
**Do not expose this branch to the internet or load actual institutional/trainee records merely because CI is green.** The current API is intentionally loopback-only. Production deployment, institutional identity integration, Rayat publishing, and processing identifiable user data are separate approvals outside the local acceptance scope.

## Verified local context
Codex's Windows local acceptance report, supplied 2026-11-06, verified React/Fastify/PostgreSQL/Java Timefold, saved approved schedules, CSV/XLSX/PDF and persistence after a PostgreSQL restart. Its baseline recorded **A01–A59: 57 pass / 2 fail**, both Arabic XLSX import without UTF-8 environment overrides. It also identified unsafe PowerShell 5.1 exit handling, npm advisories, an npm 11 manifest mutation, NTFS case-colliding docs, a stale Playwright selector and piped bootstrap input. Remediation was undertaken on GitHub; **the Windows machine must retest the new HEAD, not reuse the old report**.

## Release gates (all must be evidenced)
1. **Code and dependencies:** latest GitHub `TPS checks` including **Windows regression** and unmocked Chromium/Timefold pass; `TPS production dependency security gate` passes with zero reported high/critical advisories. Record both workflow IDs and commit SHA. No force upgrades or suppressed failures.
2. **Reproducibility:** tracked, reviewed `package-lock.json` and `frontend/package-lock.json`; `npm ci` succeeds on Node 22/24 without changing manifests. Capture tested Java/Python/Docker versions and dependency integrity.
3. **Windows acceptance:** in `H:\tps_system`, Codex confirms `git status` and preserves all untracked reports, snapshots and volumes. Run A01–A59 on **an isolated synthetic test DB**, with no `PYTHONUTF8`/ `PYTHONIOENCODING` workaround. Include the complete real XLSX preview/commit, PowerShell setup failure, login E2E and restarted DB persistence. New report must state actual pass/fail/skipped.
4. **Operating model:** choose explicit single-workstation, LAN or hosted deployment boundary. The current `127.0.0.1` restriction permits a **synthetic local pilot** only. Any LAN/public ingress requires a separate TLS termination/reverse-proxy design, secure-cookie configuration, strict firewall/host policy and fresh threat review.
5. **Data governance:** an institutional data controller authorizes account provisioning and any actual trainer/trainee details. Confirm that qualification and room equipment codes represent reviewed records; system internal approval is not official TVTC authorization. Do not connect to Rayat without documented, separate authority.
6. **Reliability:** define and test encrypted off-device PostgreSQL backup, restored snapshot (not just service restart), restore-time objectives, retention and audit access. Never run synthetic seed/integration tests against operational data.
7. **Operational security:** confirm limited admin accounts, secret storage, least privilege, access audit, incident recovery and vulnerability response. Perform independent security review appropriate to the deployment boundary. A clean npm audit is only one input.
8. **Scheduling risk:** timefold optimizer selects among bounded candidates. It has a local in-process async Java job; it is **not** a restart-proof distributed queue. Verify correct abandoned-run recovery and never mark results optimized after an interrupted process.

## Recommended rollout stages
- **Stage A — synthetic local pilot (permitted now):** loopback-only, existing saved example, no real users or student data; run smoke tests and observe logs.
- **Stage B — controlled institutional pilot (blocked pending above gates):** formally approved, limited set of authorized staff; carefully reviewed synthetic or approved low-risk data; monitor audit, backups, schedule gaps and export accuracy.
- **Stage C — production (not authorized here):** only after the owner records host, access boundary, TLS/identity architecture, data approvals, signed backup/restore evidence, final acceptance matrix and security sign-off. Never deploy solely by changing HOST to 0.0.0.0.

## Codex handoff (strictly local)
After GitHub engineering CI passes, Codex may **only** inspect local changes, safely update the development checkout if non-destructive, install and test in the isolated Windows environment. It must not commit, push, merge, alter source, publish to any network, delete volumes, overwrite the existing `.env` or use actual institutional records. Save a new dated report under `test-reports/`; report defects back to GitHub engineering rather than patching code locally.

## Final go/no-go fields
Record source commit, Actions run IDs, Windows result A01–A59, npm audit summary, full backup/restore evidence, scope/host, authorized staff, confidentiality and security sign-off, then explicitly mark `GO: synthetic-local`, `GO: controlled-pilot` or `NO-GO: production` with signatory and date. **Absent evidence means NO-GO for real-data production.**
