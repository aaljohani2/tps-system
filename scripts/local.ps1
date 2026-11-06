param([ValidateSet("setup","start","dev","test","stop","db:migrate","db:check","solver:build")][string]$Action="start")
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
if (!(Test-Path .env)) { throw "Create .env from .env.example and set a unique database password." }
switch ($Action) {
 "setup" { npm install; python -m pip install -r scripts/requirements.txt; docker compose up -d postgres; npm run db:migrate; npm run solver:build; npm run web:install; npm run web:build; npm run build }
 "start" { docker compose up -d postgres; npm run build; npm run web:build; npm start }
 "dev" { docker compose up -d postgres; npm run dev }
 "test" { npm test; python -m unittest discover -s scripts -p test_*.py -v; npm run web:build; npm run solver:build; npm run db:check }
 "stop" { docker compose stop postgres }
 "db:migrate" { npm run db:migrate }
 "db:check" { npm run db:check }
 "solver:build" { npm run solver:build }
}
