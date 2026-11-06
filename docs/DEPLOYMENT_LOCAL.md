# TPS local-only installation — Windows 11

## Prerequisites and safety

- Work only inside the existing checkout `H:\\tps_system`; record `git status`, preserve uncommitted work before switching branches.
- Node 22+, Java 21, Maven, Python 3, Docker Desktop and PowerShell 5.1+.
- Do not publish local port 8787 or PostgreSQL 54329 to another host. Do not add cloud DNS, public reverse proxies, containers on remote servers or Rayat integration.
- Do not remove PostgreSQL named volumes or databases.

## Configure

Copy `.env.example` to `.env` (gitignored); create a unique random 24+ character password. Set both `TPS_DB_PASSWORD` and the corresponding URL-encoded value in `DATABASE_URL`. If using Docker, `TPS_DB_PORT=54329`. Check availability of ports 54329 and 8787 before starting.

## Install and migrate

```powershell
git status --short
# After safely selecting the development branch:
npm install
npm run web:install
python -m pip install -r scripts/requirements.txt
docker compose up -d postgres
npm run db:migrate
npm run db:check
npm run solver:build
npm run build
npm run web:build
```

Create an initial administrator only when the user table is empty:

```powershell
$env:TPS_BOOTSTRAP_PASSWORD = "<ENTER_A_UNIQUE_16_PLUS_CHAR_PASSWORD>"
npm run db:bootstrap
Remove-Item Env:TPS_BOOTSTRAP_PASSWORD
```

Run `npm start`, then visit `http://127.0.0.1:8787`. Default service binding is loopback only. Register a fictional institution/college/department/term first. The `/health` endpoint tests the database.

## Tests

```powershell
npm test
python -m unittest discover -s scripts -p 'test_*.py' -v
npm run web:build
npm run solver:build
npm run db:check
```

Integration test `tests/api-postgres.test.ts` should run only in a **dedicated empty synthetic testing database**. Never run the test directly against the operational database because it creates test records. Set `TPS_DB_INTEGRATION=1` with a dedicated `DATABASE_URL` and run `node --test dist/tests/api-postgres.test.js` after migration and solver build.

For browser tests, install Playwright browser binaries locally and configure `TPS_TEST_USERNAME` and `TPS_TEST_PASSWORD` for a dedicated test administrator. Tests never create real trainee records.

## Recovery and persistence

Restart PostgreSQL container without removing its named volume and verify that the same scenario record remains. Re-running `npm run db:migrate` must not modify existing records. Document pass/fail explicitly. Do not perform destructive recovery tests on user data.
