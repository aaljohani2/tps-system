param(
  [ValidateSet("serve","status","install-autostart")][string]$Action="status"
)
$ErrorActionPreference="Stop"
$Root=Split-Path $PSScriptRoot -Parent
$TaskName="TPS Local Production"
Set-Location $Root
if (!(Test-Path (Join-Path $Root ".env"))) {
  throw "Existing .env is required. Do not generate or overwrite it automatically."
}
function Invoke-Checked {
  param([string]$Program,[string[]]$Arguments)
  & $Program @Arguments
  if($LASTEXITCODE -ne 0) {
    throw "$Program exited nonzero ($LASTEXITCODE). Check local production prerequisites."
  }
}
function Get-TpsHealth {
  try {
    $response=Invoke-RestMethod -Uri "http://127.0.0.1:8787/health" -TimeoutSec 5
    return $response
  }catch { return $null }
}
switch($Action){
  "serve" {
    # Intended to run in the signed-in user's context via Task Scheduler.
    # Never touches named volumes and never points at the browser test database.
    Invoke-Checked "docker" @("compose","up","-d","postgres")
    Invoke-Checked "npm.cmd" @("run","local:production:start")
  }
  "status" {
    $health=Get-TpsHealth
    if($null -eq $health){
      Write-Output "TPS application is not responding on 127.0.0.1:8787."
    }elseif($health.mode -ne "local-production"){
      Write-Output "Port 8787 is serving a NON-production TPS profile ($($health.mode))."
      exit 2
    }else{
      Write-Output "LOCAL PRODUCTION ACTIVE: 127.0.0.1:8787; database health: $($health.database)."
    }
    $task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if($null -eq $task){
      Write-Output "Logon auto-start has not been installed."
    }else{
      Write-Output "Logon scheduled task: $($task.State)"
    }
  }
  "install-autostart" {
    $health=Get-TpsHealth
    if($null -ne $health -and $health.mode -ne "local-production"){
      throw "A non-production instance is using 8787. Stop that process safely first; do not kill unrelated processes."
    }
    Invoke-Checked "npm.cmd" @("run","local:production:check")
    if(Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue){
      throw "Task already exists. Refusing to overwrite an existing scheduled task."
    }
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    $scriptFile=Join-Path $Root "scripts\local-production.ps1"
    $actionArgs="-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$scriptFile`" -Action serve"
    $taskAction=New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs -WorkingDirectory $Root
    $trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity
    $principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
    $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
      -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 12 `
      -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger `
      -Settings $settings -Principal $principal -Description "TPS loopback-only local production" | Out-Null
    Write-Output "Registered user-logon auto-start (no elevated run level): $TaskName"
    Write-Output "Verify Docker Desktop is configured to start after login and the task reports Running."
  }
}
