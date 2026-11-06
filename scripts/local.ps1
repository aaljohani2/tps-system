param([ValidateSet("setup","start","dev","test","stop","db:migrate","db:check","solver:build")][string]$Action="start")
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
if (!(Test-Path .env)) { throw "Create .env from .env.example and set a unique database password." }

# Windows PowerShell 5.1 does not turn a failing native executable into a
# terminating error under $ErrorActionPreference='Stop'. Check EVERY exit code.
function Invoke-Checked {
  param([Parameter(Mandatory=$true)][string]$Command,
        [string[]]$CommandArgs=@())
  & $Command @CommandArgs
  $exit = $LASTEXITCODE
  if ($exit -ne 0) {
    throw ("TPS local action failed: " + $Command + " " + ($CommandArgs -join " ") + " (exit " + $exit + ")")
  }
}

switch ($Action) {
  "setup" {
    Invoke-Checked "npm" @("ci")
    Invoke-Checked "python" @("-m","pip","install","-r","scripts/requirements.txt")
    Invoke-Checked "docker" @("compose","up","-d","postgres")
    Invoke-Checked "npm" @("run","db:migrate")
    Invoke-Checked "npm" @("run","db:check")
    Invoke-Checked "npm" @("run","solver:build")
    Invoke-Checked "npm" @("run","web:install")
    Invoke-Checked "npm" @("run","web:build")
    Invoke-Checked "npm" @("run","build")
  }
  "start" {
    Invoke-Checked "docker" @("compose","up","-d","postgres")
    Invoke-Checked "npm" @("run","db:check")
    Invoke-Checked "npm" @("run","build")
    Invoke-Checked "npm" @("run","web:build")
    Invoke-Checked "npm" @("start")
  }
  "dev" {
    Invoke-Checked "docker" @("compose","up","-d","postgres")
    Invoke-Checked "npm" @("run","dev")
  }
  "test" {
    Invoke-Checked "npm" @("test")
    Invoke-Checked "python" @("-m","unittest","discover","-s","scripts","-p","test_*.py","-v")
    Invoke-Checked "npm" @("run","web:build")
    Invoke-Checked "npm" @("run","solver:build")
    Invoke-Checked "npm" @("run","db:check")
  }
  "stop" { Invoke-Checked "docker" @("compose","stop","postgres") }
  "db:migrate" { Invoke-Checked "npm" @("run","db:migrate") }
  "db:check" { Invoke-Checked "npm" @("run","db:check") }
  "solver:build" { Invoke-Checked "npm" @("run","solver:build") }
}
