# One-time copy: repo-root images/* rb/ -> frontend/public/images/{recruiter,manager,hr}/
# Run from repo root: .\scripts\normalize-expression-images.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$destBase = Join-Path $root "frontend\public\images"

$mappings = @(
  @{ Src = "uni n rb"; Char = "recruiter"; Mood = "neutral" },
  @{ Src = "uni m rb"; Char = "recruiter"; Mood = "stern" },
  @{ Src = "senior n rb"; Char = "manager"; Mood = "neutral" },
  @{ Src = "senior m rb"; Char = "manager"; Mood = "stern" },
  @{ Src = "hr n rb"; Char = "hr"; Mood = "neutral" },
  @{ Src = "hr m rb"; Char = "hr"; Mood = "stern" }
)

foreach ($m in $mappings) {
  $dir = Join-Path (Join-Path $root "images") $m.Src
  if (-not (Test-Path $dir)) {
    throw "Missing source folder: $dir"
  }
  $files = Get-ChildItem $dir -Filter *.png | Sort-Object Name
  if ($files.Count -ne 4) {
    throw "Expected 4 PNGs in $dir, found $($files.Count)"
  }
  $outDir = Join-Path $destBase $m.Char
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  for ($i = 0; $i -lt $files.Count; $i++) {
    $dest = Join-Path $outDir ("{0}-{1}.png" -f $m.Mood, $i)
    Copy-Item $files[$i].FullName $dest -Force
    Write-Host "Wrote $dest"
  }
}

Write-Host "Done. Expression assets under $destBase"
