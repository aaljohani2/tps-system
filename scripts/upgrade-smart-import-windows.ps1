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
function Assert-TpsAppStopped {
    $health=Health
    $listeners=@(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)
    if($health -or $listeners.Count -gt 0){
        throw ('TPS on port 8787 must be stopped gracefully BEFORE npm ci. ' +
          'Stop the TPS Local Production scheduled task or press Ctrl+C in the known TPS server console, ' +
          'check there is no active Timefold solve, then rerun Prepare. ' +
          'Keep Docker/PostgreSQL and all databases running; do not kill unrelated processes.')
    }
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
        # npm ci removes and replaces node_modules, including native argon2.
        # On Windows the running API holds these .node DLLs open and npm ci
        # fails with EPERM. Stop only the TPS API first, never the database.
        # Check before any backup or dependency changes.
        Assert-TpsAppStopped
        # Only source code moves here. The existing PostgreSQL DB and .env are untouched.
        # A named fetch populates FETCH_HEAD even if a narrow Git remote
        # config does not generate refs/remotes/origin/<branch>.
        Checked 'git' @('fetch','--no-tags','origin',"refs/heads/$Branch")
        $fetchedHead=CaptureGit @('rev-parse','--verify','FETCH_HEAD^{commit}')
        if($fetchedHead -notmatch '^[a-f0-9]{40}$'){
            throw 'Fetched branch did not resolve to a valid commit; no merge attempted.'
        }
        Checked 'git' @('merge','--ff-only',$fetchedHead)
        Check-Worktree
        $head=CaptureGit @('rev-parse','HEAD')
        Write-Output "Source updated by safe fast-forward: $head"
        # Retain old built server for the live API until intentionally retired.
        $backup=UpgradeBackup
        Write-Output 'Encrypted operational backup and isolated restore rehearsal passed.'
        # Verify the Windows native DLL cannot be locked by TPS while npm
        # replaces it. A restarted scheduled task must be stopped explicitly.
        Assert-TpsAppStopped
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
            # Windows PowerShell 5.1 strips nested quotes from gh's -q jq
            # expression. Request JSON and validate fields natively instead.
            $runJsonText=(& gh run view $VerifiedRunId -R $Repository --json headSha,conclusion | Out-String).Trim()
            if($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($runJsonText)){
                throw 'Could not retrieve a GitHub Actions run. No solver JAR was replaced.'
            }
            try{
                $verifiedRun=$runJsonText | ConvertFrom-Json -ErrorAction Stop
            }catch{
                throw 'GitHub Actions returned an invalid JSON run response. No solver JAR was replaced.'
            }
            if($verifiedRun.headSha -ne $head -or $verifiedRun.conclusion -ne 'success'){
                throw ("GitHub Actions run is not green for this exact commit: " +
                    "expected=$head; actual=$($verifiedRun.headSha); conclusion=$($verifiedRun.conclusion)")
            }
            # Download in a new staging directory first: never destroy the last
            # working JAR if GitHub artifact retrieval fails.
            $tempJarDir=Join-Path $env:TEMP ('tps-solver-'+[guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Force -Path $tempJarDir | Out-Null
            try{
                Checked 'gh' @('run','download',"$VerifiedRunId",'-R',$Repository,'-n','tps-timefold-jar','-D',$tempJarDir)
                $candidate=Join-Path $tempJarDir 'tps-timefold-0.2.0-jar-with-dependencies.jar'
                if(!(Test-Path $candidate) -or (Get-Item $candidate).Length -lt 1000000){
                    throw 'GitHub Timefold artifact missing or implausibly small; original JAR preserved.'
                }
                New-Item -ItemType Directory -Force -Path (Split-Path $jar -Parent) | Out-Null
                Copy-Item -LiteralPath $candidate -Destination $jar -Force
            }finally{
                Remove-Item -LiteralPath $tempJarDir -Recurse -Force -ErrorAction SilentlyContinue
            }
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
        Write-Output 'The original TPS API was stopped by the operator before npm ci; Docker/PostgreSQL stayed running.'
        Write-Output 'After confirming no Timefold work is active, start the updated API:'
        Write-Output 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts\upgrade-smart-import-windows.ps1 -Action Start'
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