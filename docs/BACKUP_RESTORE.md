# TPS PostgreSQL — encrypted backup and isolated restore drill

## Scope and safety

The `scripts/backup-restore.mjs` utility uses the current **local Docker Compose** PostgreSQL service, not any remote host. It creates a streamed `pg_dump` custom-format snapshot encrypted with **AES-256-GCM** and a scrypt-derived key. The local archive and temporary files remain under `private-data/backups` (ignored by Git). The original PostgreSQL database and its named Docker Volume are never dropped, restored over, or deleted by this tool.

**A restarted container with its existing Volume is not a backup/restore drill.** Off-device encrypted copy, independent infrastructure restoration, retention, RTO/RPO and security approvals remain production gates.

This tool is an operational development increment, **not authorization to handle real institutional information**. Test on a dedicated synthetic database first.

## Prerequisites

- Windows: Node.js 22+, Docker Desktop with the existing local `postgres` Compose service.
- `.env` with `TPS_DB_USER`, `TPS_DB_NAME`, `TPS_DB_PASSWORD` and `DATABASE_URL`; do not modify existing DB credentials.
- A **random, unique** backup passphrase of at least 24 characters in the **current shell only** as `TPS_BACKUP_PASSPHRASE`. Store it securely **separate from the encrypted file**; a forgotten key makes the backup unrecoverable. Never commit or print the key, store it in `.env`, or put it in command-line flags.

For Windows PowerShell, acquire the passphrase without placing it in shell history:

```powershell
$secret=Read-Host "Unique TPS backup encryption passphrase" -AsSecureString
$handle=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $env:TPS_BACKUP_PASSPHRASE=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($handle)
  npm run db:backup
} finally {
  Remove-Item Env:TPS_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($handle)
}
```

For archive verification or the restoration drill, supply **the same key** to the current shell, then run these commands before removing it again:

```powershell
npm run db:backup:verify -- --file private-data/backups/<archive-name>.tpsbak
npm run db:restore:test -- --file private-data/backups/<archive-name>.tpsbak
```

An archive reports `BACKUP_CREATED` only after the subprocess exits successfully, the ciphertext/tag is finalized and the temporary file is atomically renamed. `ARCHIVE_VERIFIED` means both the authenticated decryption and the `pg_restore --list` structural check passed.

`restore-test` first verifies the archive, then creates a *fresh random database name* `tps_restore_*`, restores within one PostgreSQL transaction, and checks the migration history and principal TPS tables. It prints `RESTORE_TEST_PASSED` and retains the isolated test DB for inspection. It **never has an option to restore over an existing database**.

Only the newly generated drill database may be cleaned up later by a qualified operator, separately and explicitly; neither script nor CI cleans up real user data. The CI ephemeral Docker environment is disposable by design.

## Controls, limits and next release gates

- The archive uses `pg_dump -Fc`, AES-256-GCM (integrity/authentication) and scrypt for a locally supplied passphrase; a corrupted backup or incorrect key must fail verification. The plaintext backup should never be written to the host filesystem.
- Backups are stored locally by default. **Copy only the encrypted archive** to an appropriately authorized off-device location, protect its access/retention, and keep the key separately. Neither off-device copying nor key escrow is automated.
- `restore-test` confirms database objects and essential table access, not full business-process validation. After a restoration drill, independently sample approved snapshots, audit logs, logins and exports and compare expected record counts.
- Database backup includes database-local records, but does **not** back up `.env`, Timefold JAR, source code, OS configuration, encryption keys, secrets or external files. Recovery procedures must cover those separately.
- In the existing local architecture, the Timefold async worker executes in the API process, not a durable multi-process queue. A recovered DB does not resurrect an interrupted Java solve; use audited abandoned-run recovery and rerun as appropriate.
- If restoring operational data were ever authorized, use separate procedures, a verified environment and explicit sign-off, never this testing utility as a shortcut. Distinct TLS/identity boundary, restore times, offsite redundancy, incident recovery and approvals remain mandatory.
- The CI job `backup-restore-drill` uses *synthetic* PostgreSQL 17 only. Green CI proves the scripted drill on the runner, **not** that the user's Windows machine, off-device backup or institutional production was tested.

Record backup timestamp, archive checksum, destination policy, isolated restore name, test result, access-control review, RPO/RTO and operator in the acceptance report. Do not include passphrases or database contents in logs or screenshots.
