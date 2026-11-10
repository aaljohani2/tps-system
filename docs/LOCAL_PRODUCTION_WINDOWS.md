# TPS System — **local Windows production** operating procedure

**Priority: run the real application on the user's workstation, using a clean, persistent, independent operational database. No cloud/LAN deployment is needed.**

## What local production means here

- Built React + Fastify + Java Timefold; persistent PostgreSQL 17 in the existing named Docker Volume; real authenticated users and audit logs, no fake seed.
- The operational database is **always** `tps_operational_local`, separate from the existing `tps_browser_test`, `tps_backup_ci` and `tps_restore_*` databases. The original `.env` stays unchanged. The operational process rewrites its own in-memory DB connection only.
- HTTP listens only at `http://127.0.0.1:8787` and health mode is `local-production`. PostgreSQL remains bound to `127.0.0.1`, never LAN/public.
- Restart resilience is provided through Docker `restart: unless-stopped` and an **optional signed-in-user Windows Scheduled Task** with restart on failure; task startup requires Docker Desktop running. This is local single-machine operation, not a cluster or 24/7 SLA.
- **Do not use real personally identifiable institutional/trainee records without appropriate authorization, access controls and approved retention/backup safeguards.** Local production mode describes the deployment architecture, not institutional data-processing approval.

## Prepare once — without destroying anything

1. Inspect `git status`; retain existing `.env`, Docker Volume, `test-reports`, backups and current synthetic DB. Safely fast-forward `feat/full-stack-tps-v1`. Do not reset/clean/force.
2. Install pinned dependencies, build frontend, API and Java Timefold (build commands below). Check `.env` already points to the **existing** original database (often `tps_browser_test`) and its matching `TPS_DB_NAME`. **Do not edit `.env` to point to `tps_operational_local`.**
3. Inspect `127.0.0.1:8787`: if an older `local-only` test server occupies the port, verify its PID, owner, executable path and active solver jobs, then stop only that verified TPS test API process gracefully. Do not stop PostgreSQL or other programs. If unable to identify it, do not force kill.
4. Create or reuse the empty operational database. This command will never wipe existing records:

```powershell
Set-Location <LOCAL_TPS_DIR>
npm.cmd ci
npm.cmd run web:install
npm.cmd run build
npm.cmd run web:build
npm.cmd run solver:build
npm.cmd run local:production:init
npm.cmd run local:production:check
```

`init` uses the existing local Docker PostgreSQL service, creates `tps_operational_local` only if absent, applies forward-only migrations and checks schema. Re-running it must preserve all operational tables and records. **Never run `db:seed` or integration tests on the operational database.**

## Create initial administrator — only on an empty operational users table

Use `npm.cmd run local:production:bootstrap`. The existing bootstrap routine refuses any database with users. If its user table is empty, an operator may enter the username interactively; provide a private password of at least 16 characters through the current process environment. Never put the password in files, code, arguments or report. Delete `TPS_BOOTSTRAP_PASSWORD` and `TPS_BOOTSTRAP_USERNAME` immediately afterward.

For a prompted password with no command-history exposure:

```powershell
$env:TPS_BOOTSTRAP_USERNAME = "tps_admin_local"
$secret = Read-Host "Operational admin password (16+ characters)" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $env:TPS_BOOTSTRAP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  npm.cmd run local:production:bootstrap
} finally {
  Remove-Item Env:TPS_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:TPS_BOOTSTRAP_USERNAME -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
```

Use a distinct administrator from any synthetic/test credentials and store it through the user's approved secret manager, not in GitHub or these docs.

## Start and verify the actual operational service

```powershell
npm.cmd run local:production:start
```

This command is **foreground and remains running**. In a separate PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
powershell -ExecutionPolicy Bypass -File scripts/local-production.ps1 status
```

Required health fields are `status=ok`, `database=ok`, **`mode=local-production`**. If mode is `local-only`, the old test instance is still serving port 8787: the operational launch has NOT succeeded.

Open `http://127.0.0.1:8787`, log in using the dedicated operational administrator and create institution → college → department → term. The environment should **not** show previously seeded demo courses/scenarios. Check initial user accounts and that the operational database contains only deliberately created records.

## Automatic startup when signing into Windows (optional)

Only after successful manual start, correct `local-production` health and documented readiness, the operator may install **a user-logon Scheduled Task**:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/local-production.ps1 install-autostart
```

This creates the unique task `TPS Local Production`, using the current Windows user without elevation, with attempts to restart on failure. It refuses to overwrite an existing task. Docker Desktop must also be configured to start at sign-in. Confirm both in Task Scheduler and test one controlled logoff/logon or restart **after** making an encrypted backup and ensuring no Timefold job is running.

Installing the task does not automatically stop the current API or switch which DB it uses. A server already running on port 8787 must be handled with a verified, non-destructive changeover.

## Operational database backup — not the original test DB

The legacy commands `npm run db:backup` use the original `.env` and can target the original test DB. For **operational** backups, only use:

```powershell
npm.cmd run local:production:backup
npm.cmd run local:production:backup:verify -- --file private-data/backups/<NAME>.tpsbak
npm.cmd run local:production:restore:test -- --file private-data/backups/<NAME>.tpsbak
```

They route the connection to `tps_operational_local` and never support restoring onto the source. Require the unique `TPS_BACKUP_PASSPHRASE` in the shell for each operation. Follow `docs/BACKUP_RESTORE.md` for secure prompt handling, key custody and retention. Local backup alone does not protect against device/disk failure; arrange an authorized encrypted off-device destination before relying on this for institutional records.

## Acceptance requirements — distinct from past tests

A production-profile acceptance report `test-reports/TPS_LOCAL_PRODUCTION_ACCEPTANCE.md` must show:

- Exact commit, clean Git tracked files, stable Docker named Volume and real local-production health (not local-only).
- Old test DB untouched; operational DB clean, persisted across application and Postgres restarts.
- Only real app stack (Fastify/React/Postgres/Java), no Vite dev server, mock browser or greedy fallback presented as optimized.
- Dedicated local admin login/logout, API/CSRF permissions, curriculum/room/trainer entry, Timefold scheduling, readiness, approve and CSV/XLSX.
- Local encrypted **operational database** backup/verify/isolated restore, plus safe storage of its encryption key and restoration evidence. Do not silently treat the previous `tps_backup_ci` test as proof.
- A working user-logon autostart if enabled, including post-restart health check. Record failure modes plainly.
- Operational decision: `GO — local production mode (loopback)`, `NO-GO — actual institutional personal data` until documented authorization and data protection requirements are met.

**Never merge PR #8, expose a listener on 0.0.0.0, connect Rayat, seed the operational DB or delete/overwrite existing user data merely to make a local test pass.**

## GitHub evidence before on-PC activation

The latest **code** for this operating-mode increment is commit `2789af23fb788265f4da088e299b22e394fb9331`. Its `TPS checks` GitHub Actions run **42309548466 passed 10/10 jobs**, including `local-production-smoke`: independent schema and repeat initialization, dedicated admin bootstrap only once, isolated encrypted operational backup plus restore, and actual Fastify `/health.mode=local-production`. The separate dependency security gate on the same source changes also passed. **The owner's Windows workstation still needs Codex to activate and observe this mode; do not reuse the older V2 report of the synthetic instance as production activation proof.**
