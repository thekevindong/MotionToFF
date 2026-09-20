# Step 5 - Presage "hello vitals" smoke test (Windows).
# Official guide: SmartSpectra cpp/docs/windows/index.md

param(
    [switch]$DownloadSdk,
    [switch]$BuildOnly,
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
        if ($line -match '^\s*(PRESAGE_API_KEY|SMARTSPECTRA_API_KEY|PRESALE_API_KEY)\s*=\s*(.+)\s*$') {
            if ($Matches[1] -eq 'PRESALE_API_KEY') {
                Write-Warning "backend/.env uses PRESALE_API_KEY — rename to PRESAGE_API_KEY (typo)."
            }
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

function Find-CMakeBin {
    if (Get-Command cmake -ErrorAction SilentlyContinue) {
        return (Split-Path (Get-Command cmake).Source -Parent)
    }
    $roots = @(
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Professional",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Enterprise",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools"
    )
    foreach ($root in $roots) {
        $cmake = Join-Path $root "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
        if (Test-Path $cmake) {
            return (Split-Path $cmake -Parent)
        }
    }
    return $null
}

function Test-PresageKeyConfigured {
    if ($env:SMARTSPECTRA_API_KEY) { return $true }
    if ($env:PRESAGE_API_KEY) { return $true }
    return [bool](Load-DotEnvKey)
}

function Get-SmartSpectraConfigPath([string]$RootDir) {
    return Join-Path $RootDir "lib\cmake\SmartSpectra\SmartSpectraConfig.cmake"
}

function Resolve-SdkLayout([string]$SearchRoot) {
    $direct = Get-SmartSpectraConfigPath $SearchRoot
    if (Test-Path $direct) { return $SearchRoot }
    $found = Get-ChildItem -Path $SearchRoot -Recurse -Filter SmartSpectraConfig.cmake -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($found) {
        return (Split-Path (Split-Path (Split-Path $found.FullName -Parent) -Parent) -Parent)
    }
    return $null
}

function Find-VcVars64([string]$VsDevCmdPath) {
    $vsRoot = Split-Path (Split-Path (Split-Path $VsDevCmdPath -Parent) -Parent) -Parent
    $vcvars = Join-Path $vsRoot "VC\Auxiliary\Build\vcvars64.bat"
    if (Test-Path $vcvars) { return $vcvars }
    return $null
}

function Import-VcVars64([string]$VcVarsPath) {
    cmd.exe /c "`"$VcVarsPath`" >nul && set" | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            Set-Item -Path "env:$($Matches[1])" -Value $Matches[2] -ErrorAction SilentlyContinue
        }
    }
}

function Get-InstalledMsvcVersion {
    $roots = @(
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Professional\VC\Tools\MSVC",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Enterprise\VC\Tools\MSVC",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"
    )
    $versions = @()
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $versions += Get-ChildItem $root -Directory | ForEach-Object { $_.Name }
    }
    return ($versions | Sort-Object -Descending | Select-Object -First 1)
}

function Invoke-HelloVitalsBuild([string]$ProjectRoot, [string]$SdkRoot, [string]$CmakeBin, [string]$VsDevCmd) {
    $ninjaBin = Join-Path (Split-Path $CmakeBin -Parent) "..\Ninja"
    $ninjaBin = (Resolve-Path $ninjaBin -ErrorAction SilentlyContinue)
    if ($ninjaBin) { $ninjaBin = $ninjaBin.Path } else { $ninjaBin = $CmakeBin }

    $vcvars = Find-VcVars64 $VsDevCmd
    if (-not $vcvars) {
        Write-Log "BLOCKED: vcvars64.bat not found next to Visual Studio install."
        return $false
    }

    Import-VcVars64 $vcvars
    $env:PATH = (($env:PATH -split ';') | Where-Object { $_ -and $_ -notmatch 'MinGW' }) -join ';'
    $env:PATH = "$CmakeBin;$ninjaBin;$env:PATH"
    $env:SMARTSPECTRA_SDK_PATH = $SdkRoot

    $msvcVer = Get-InstalledMsvcVersion
    if ($msvcVer) {
        Write-Log "MSVC toolset: $msvcVer (SmartSpectra 3.3.0 needs 14.38+; upgrade via VS Installer if link fails)."
    }

    $buildDir = Join-Path $ProjectRoot "build"
    if (Test-Path $buildDir) {
        Remove-Item -Path $buildDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Push-Location $ProjectRoot
    try {
        $steps = @(
            @("cmake", "-S", ".", "-B", "build", "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_COMPILER=cl"),
            @("cmake", "--build", "build")
        )
        foreach ($args in $steps) {
            $out = & $args[0] $args[1..($args.Length - 1)] 2>&1
            $out | ForEach-Object { Write-Log $_ }
            if ($LASTEXITCODE -ne 0) {
                if ($out -match '__std_find_last_trivial|__std_find_first_of_trivial|__std_search_1') {
                    Write-Log "HINT: MSVC STL mismatch — open Visual Studio Installer, update Desktop C++ workload to MSVC v143 14.38 or newer, then re-run."
                }
                return $false
            }
        }
        return (Test-Path (Join-Path $buildDir "hello_vitals.exe"))
    } finally {
        Pop-Location
    }
}

function Sync-SdkToExtracted([string]$SourceRoot, [string]$DestRoot) {
    if (-not (Test-Path (Get-SmartSpectraConfigPath $SourceRoot))) { return $false }
    if (Test-Path $DestRoot) {
        Remove-Item -Path $DestRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Force -Path $DestRoot | Out-Null
    Copy-Item -Path (Join-Path $SourceRoot "*") -Destination $DestRoot -Recurse -Force
    return (Test-Path (Get-SmartSpectraConfigPath $DestRoot))
}

Remove-Item -Path $LogPath -ErrorAction SilentlyContinue
Write-Log "Presage smoke test starting (SDK path: $SdkRoot)"

$keyConfigured = Test-PresageKeyConfigured
if ($keyConfigured) {
    Write-Log "API key: loaded from backend/.env or environment."
} else {
    Write-Log "API key: not configured (set PRESAGE_API_KEY in backend/.env)."
    if (-not $BuildOnly) {
        Write-Log "BLOCKED: no PRESAGE_API_KEY / SMARTSPECTRA_API_KEY in backend/.env or environment."
        exit 2
    }
}

$configMarker = Get-SmartSpectraConfigPath $SdkRoot
if ($DownloadSdk -and -not (Test-Path $configMarker)) {
    $cacheDir = Join-Path $Root ".sdk"
    New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
    $zipPath = Join-Path $cacheDir $ZipName
    $url = "https://github.com/Presage-Security/SmartSpectra/releases/download/v$SdkVersion/$ZipName"
    if (-not (Test-Path $zipPath)) {
        Write-Log "Downloading SDK from GitHub releases..."
        Invoke-WebRequest -Uri $url -OutFile $zipPath
    } else {
        Write-Log "Using cached SDK zip at $zipPath"
    }
    $unzipDir = Join-Path $cacheDir "unzipped"
    if (-not (Test-Path (Get-SmartSpectraConfigPath $unzipDir))) {
        if (Test-Path $unzipDir) {
            Remove-Item -Path $unzipDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        New-Item -ItemType Directory -Force -Path $unzipDir | Out-Null
        Expand-Archive -Path $zipPath -DestinationPath $unzipDir -Force
    }
    $resolved = Resolve-SdkLayout $unzipDir
    if (-not $resolved) {
        Write-Log "BLOCKED: SDK zip unpacked but SmartSpectraConfig.cmake not found."
        exit 8
    }
    if (-not (Sync-SdkToExtracted $resolved $SdkRoot)) {
        Write-Log "BLOCKED: failed to copy SDK layout into $SdkRoot"
        exit 8
    }
    Write-Log "SDK extracted to $SdkRoot"
}

if (-not (Test-Path $configMarker)) {
    Write-Log "BLOCKED: SmartSpectra SDK not found. Run: .\run_smoke.ps1 -DownloadSdk"
    Write-Log "Or extract the Windows ZIP and set SMARTSPECTRA_SDK_PATH to that folder."
    exit 3
}

$vsDev = Find-VsDevCmd
if (-not $vsDev) {
    Write-Log "BLOCKED: Visual Studio 2022 (Desktop C++) not found - need VsDevCmd.bat + NMake."
    exit 4
}

$cmakeBin = Find-CMakeBin
if (-not $cmakeBin) {
    Write-Log "BLOCKED: cmake not on PATH and not found under Visual Studio CMake extension."
    Write-Log "Install: VS Installer -> Modify -> Desktop development with C++ -> CMake tools for Windows."
    exit 7
}
Write-Log "Using cmake from: $cmakeBin"

$buildDir = Join-Path $Root "build"
$exe = Join-Path $buildDir "hello_vitals.exe"

Write-Log "Configuring and building hello_vitals (Ninja + MSVC cl)..."
if (-not (Invoke-HelloVitalsBuild -ProjectRoot $Root -SdkRoot $SdkRoot -CmakeBin $cmakeBin -VsDevCmd $vsDev)) {
    Write-Log "BLOCKED: build failed - hello_vitals.exe missing."
    exit 5
}

if ($BuildOnly) {
    Write-Log "BUILD OK: hello_vitals.exe built (run without -BuildOnly after adding API key + webcam)."
    exit 0
}

$apiKey = $env:SMARTSPECTRA_API_KEY
if (-not $apiKey) { $apiKey = $env:PRESAGE_API_KEY }
if (-not $apiKey) { $apiKey = Load-DotEnvKey }

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
