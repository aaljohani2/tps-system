param(
    [ValidateSet('Prepare','Start','Status')][string]$Action='Prepare',
    [long]$VerifiedRunId=0
)
$ErrorActionPreference='Stop'
$Root=Split-Path $PSScriptRoot -Parent
$Branch='feat/unified-smart-import-from-local-20261107'
$Repository='aaljohani2/tps-system'
$Receipt=Join-Path $Root 'private-data\smart-import-upgrade.json'
Set-Location $Root

function Checked([string]$Program,[string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit $LASTEXITCODE; nothing was reset or deleted."
    }
}
function CaptureGit([string[]]$Arguments) {
    $text=(& git @Arguments | Out-String).Trim()
    if($LASTEXITCODE -ne 0){throw "Git command failed; no force or reset attempted."}
    return $text
}
function Health {
    try { return Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5 }
    catch { return $null }
}
function Check-Worktree {
    if(!(Test-Path (Join-Path $Root '.git'))) {throw 'Git checkout not found.'}
    $branch=CaptureGit @('branch','--show-current')
    if($branch -ne $Branch) {throw "Local branch $branch is not the prepared feature branch $Branch. No checkout/reset performed."}
    $dirty=CaptureGit @('status','--porcelain','--untracked-files=no')
    if($dirty){throw "Tracked local edits exist. Preserve/review them before upgrade: $dirty"}
}
function Jar-Ready {
    $jar=Join-Path $Root 'solver\target\tps-timefold-0.2.0-jar-with-dependencies.jar'
    if(!(Test-Path $jar)){throw 'Timefold JAR missing. Maven or GitHub artifact is required before starting.'}
    if((Get-Item $jar).Length -lt 1000000){throw 'Downloaded Timefold JAR is unexpectedly small.'}
    return $jar
}
function UpgradeBackup {
    $before=Get-Date
    $secret=Read-Host 'Operational encrypted-backup passphrase (24+ characters)' -AsSecureString
    $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try{
        $env:TPS_BACKUP_PASSPHRASE=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        if($env:TPS_BACKUP_PASSPHRASE.Length -lt 24){throw 'Backup passphrase must contain 24 or more characters.'}
        Checked 'npm.cmd' @('run','local:production:backup')
        $archive=Get-ChildItem (Join-Path $Root 'private-data\backups') -Filter '*.tpsbak' -File |
            Where-Object {$_.LastWriteTime -ge $before.AddSeconds(-10)} |
            Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
        if(!$archive){throw 'Could not identify the new encrypted operational backup.'}
        Checked 'npm.cmd' @('run','local:production:backup:verify','--','--file',$archive.FullName)
        Checked 'npm.cmd' @('run','local:production:restore:test','--','--file',$archive.FullName)
        return [pscustomobject]@{
            archive=$archive.FullName
            sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $archive.FullName).Hash
        }
    }finally{
        Remove-Item Env:TPS_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

switch($Action){
    'Prepare' {
        Check-Worktree
        $health=Health
        if($health -and $health.mode -ne 'local-production'){
            throw "Port 8787 is not operational TPS: $($health.mode). Refusing preparation."
        }
        # Only source code moves here. The existing PostgreSQL DB and .env are untouched.
        Checked 'git' @('fetch','--no-tags','origin',$Branch)
        Checked 'git' @('merge','--ff-only',"origin/$Branch")
        Check-Worktree
        $head=CaptureGit @('rev-parse','HEAD')
        Write-Output "Source updated by safe fast-forward: $head"
        # Retain old built server for the live API until intentionally retired.
        $backup=UpgradeBackup
        Write-Output 'Encrypted operational backup and isolated restore rehearsal passed.'
        Checked 'npm.cmd' @('ci')
        Checked 'npm.cmd' @('run','web:install')
        Checked 'npm.cmd' @('run','build')
        Checked 'npm.cmd' @('run','web:build')
        $jar=Join-Path $Root 'solver\target\tps-timefold-0.2.0-jar-with-dependencies.jar'
        $maven=Get-Command mvn.cmd,mvn -ErrorAction SilentlyContinue | Select-Object -First 1
        if($maven){
            Checked 'npm.cmd' @('run','solver:build')
        }else{
            if($VerifiedRunId -le 0){throw 'Maven is not installed. Supply -VerifiedRunId <successful GitHub Actions TPS checks run id> and an authenticated gh CLI.'}
            $gh=Get-Command gh.exe,gh -ErrorAction SilentlyContinue | Select-Object -First 1
            if(!$gh){throw 'Neither Maven nor GitHub CLI exists. Install GitHub CLI or Maven; do not use an old Timefold JAR.'}
            $details=(& gh run view $VerifiedRunId -R $Repository --json headSha,conclusion -q '.headSha + "|" + .conclusion' | Out-String).Trim()
            if($LASTEXITCODE -ne 0 -or $details -ne "$head|success"){
                throw "GitHub Actions run is not green for this exact commit. Got: $details"
            }
            if(Test-Path $jar){Remove-Item -LiteralPath $jar -Force}
            Checked 'gh' @('run','download',"$VerifiedRunId",'-R',$Repository,'-n','tps-timefold-jar','-D',(Join-Path $Root 'solver\target'))
        }
        $jarPath=Jar-Ready
        Checked 'npm.cmd' @('test')
        $receiptInfo=[pscustomobject]@{
            head=$head
            backupPath=$backup.archive
            backupSha256=$backup.sha256
            jarSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $jarPath).Hash
            utc=(Get-Date).ToUniversalTime().ToString('o')
        }
        $receiptInfo | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -LiteralPath $Receipt
        Write-Output 'PREPARE_SUCCESS: code, dependencies, front end and Timefold built, Node tests passed.'
        Write-Output 'Backup verified and restored in a NEW isolated database.'
        Write-Output 'The current TPS application process has NOT been stopped or redeployed.'
        Write-Output 'Stop only the current TPS API foreground window with Ctrl+C; ensure no Timefold run is active.'
        Write-Output 'Then execute: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\upgrade-smart-import-windows.ps1 -Action Start'
    }
    'Start' {
        Check-Worktree
        if(!(Test-Path $Receipt)){throw 'No successful Prepare receipt. Refusing to apply migrations.'}
        $receiptInfo=Get-Content -Raw -LiteralPath $Receipt | ConvertFrom-Json
        $head=CaptureGit @('rev-parse','HEAD')
        if($head -ne $receiptInfo.head){throw 'Source changed after Prepare. Re-run Prepare.'}
        if(!(Test-Path $receiptInfo.backupPath)){throw 'Verified operational backup is missing.'}
        $backupHash=(Get-FileHash -Algorithm SHA256 -LiteralPath $receiptInfo.backupPath).Hash
        if($backupHash -ne $receiptInfo.backupSha256){throw 'Operational backup hash has changed.'}
        $jar=Jar-Ready
        if((Get-FileHash -Algorithm SHA256 -LiteralPath $jar).Hash -ne $receiptInfo.jarSha256){
            throw 'Timefold JAR differs from the one checked in Prepare.'
        }
        $listeners=Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
        if($listeners){throw 'Port 8787 is occupied. Stop only the known TPS service (or signed-in task) after verifying no active Timefold work. Never force-kill another process.'}
        Checked 'npm.cmd' @('run','local:production:init')
        Checked 'npm.cmd' @('run','local:production:check')
        Write-Output 'TPS local production migrations and validation passed. Starting on loopback port 8787.'
        Checked 'npm.cmd' @('run','local:production:start')
    }
    'Status' {
        $health=Health
        if(!$health){Write-Output 'OFFLINE: TPS does not respond on loopback 8787';exit 2}
        $health | ConvertTo-Json -Depth 8 | Write-Output
        if($health.mode -ne 'local-production'){throw 'Unexpected profile: not local-production'}
        Write-Output 'LOCAL_PRODUCTION_PROFILE_OK'
    }
}