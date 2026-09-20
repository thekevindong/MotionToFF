# Step 5 - Presage "hello vitals" smoke test (Windows).
# Official guide: SmartSpectra cpp/docs/windows/index.md

param(
    [switch]$DownloadSdk,
    [int]$RunSeconds = 20
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$SdkVersion = "3.3.0"
$ZipName = "smartspectra-sdk-$SdkVersion-windows-x64.zip"
$SdkRoot = if ($env:SMARTSPECTRA_SDK_PATH) { $env:SMARTSPECTRA_SDK_PATH } else { Join-Path $Root ".sdk\extracted" }
$LogPath = Join-Path $Root "smoke_last_run.log"

function Write-Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $LogPath -Value $line
}

function Load-DotEnvKey {
    $envFile = Join-Path (Split-Path $Root -Parent) "backend\.env"
    if (-not (Test-Path $envFile)) { return $null }
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*#') { continue }
        if ($line -match '^\s*(PRESAGE_API_KEY|SMARTSPECTRA_API_KEY)\s*=\s*(.+)\s*$') {
            return $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

function Find-VsDevCmd {
    $candidates = @(
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

Remove-Item -Path $LogPath -ErrorAction SilentlyContinue
Write-Log "Presage smoke test starting (SDK path: $SdkRoot)"

$apiKey = $env:SMARTSPECTRA_API_KEY
if (-not $apiKey) { $apiKey = Load-DotEnvKey }
if (-not $apiKey) {
    Write-Log "BLOCKED: no PRESAGE_API_KEY / SMARTSPECTRA_API_KEY in backend/.env or environment."
    exit 2
}

if ($DownloadSdk -and -not (Test-Path (Join-Path $SdkRoot "lib\cmake\SmartSpectra\SmartSpectraConfig.cmake"))) {
    $cacheDir = Join-Path $Root ".sdk"
    New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
    $zipPath = Join-Path $cacheDir $ZipName
    $url = "https://github.com/Presage-Security/SmartSpectra/releases/download/v$SdkVersion/$ZipName"
    Write-Log "Downloading SDK from GitHub releases..."
    Invoke-WebRequest -Uri $url -OutFile $zipPath
    New-Item -ItemType Directory -Force -Path $SdkRoot | Out-Null
    Expand-Archive -Path $zipPath -DestinationPath (Join-Path $cacheDir "unzipped") -Force
    $inner = Get-ChildItem (Join-Path $cacheDir "unzipped") -Directory | Select-Object -First 1
    if ($inner) {
        Copy-Item -Path (Join-Path $inner.FullName "*") -Destination $SdkRoot -Recurse -Force
    }
    Write-Log "SDK extracted to $SdkRoot"
}

if (-not (Test-Path (Join-Path $SdkRoot "lib\cmake\SmartSpectra\SmartSpectraConfig.cmake"))) {
    Write-Log "BLOCKED: SmartSpectra SDK not found. Run: .\run_smoke.ps1 -DownloadSdk"
    Write-Log "Or extract the Windows ZIP and set SMARTSPECTRA_SDK_PATH to that folder."
    exit 3
}

$vsDev = Find-VsDevCmd
if (-not $vsDev) {
    Write-Log "BLOCKED: Visual Studio 2022 Build Tools (Desktop C++) not found - need VsDevCmd.bat + NMake."
    exit 4
}

$buildDir = Join-Path $Root "build"
$exe = Join-Path $buildDir "hello_vitals.exe"

Write-Log "Configuring and building hello_vitals..."
$buildCmd = @"
call "$vsDev" -arch=x64 -host_arch=x64
set SMARTSPECTRA_SDK_PATH=$SdkRoot
cd /d "$Root"
cmake -S . -B build -G "NMake Makefiles" -DCMAKE_BUILD_TYPE=Release
cmake --build build
"@
cmd.exe /c $buildCmd 2>&1 | ForEach-Object { Write-Log $_ }

if (-not (Test-Path $exe)) {
    Write-Log "BLOCKED: build failed - hello_vitals.exe missing."
    exit 5
}

Write-Log "Running hello_vitals for up to $RunSeconds seconds (look for Cardio/Breathing metrics)..."
$env:SMARTSPECTRA_API_KEY = $apiKey
$env:PATH = "$(Join-Path $SdkRoot 'bin');$env:PATH"

$proc = Start-Process -FilePath $exe -ArgumentList @($apiKey) -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $Root "smoke_stdout.txt") -RedirectStandardError (Join-Path $Root "smoke_stderr.txt")
Start-Sleep -Seconds $RunSeconds
if (-not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}

$stderr = Get-Content (Join-Path $Root "smoke_stderr.txt") -ErrorAction SilentlyContinue
$stdout = Get-Content (Join-Path $Root "smoke_stdout.txt") -ErrorAction SilentlyContinue
$stderr | ForEach-Object { Write-Log "stderr: $_" }
$stdout | ForEach-Object { Write-Log "stdout: $_" }

$gotMetrics = ($stderr + $stdout | Where-Object { $_ -match 'Cardio metrics:|Breathing metrics:' }) -ne $null
if ($gotMetrics) {
    Write-Log "SUCCESS: at least one vitals metric line printed."
    exit 0
}

Write-Log "INCONCLUSIVE: process ran but no Cardio/Breathing lines yet (camera, lighting, or warmup)."
exit 6
