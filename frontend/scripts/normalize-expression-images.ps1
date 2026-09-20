# Copy raw expression PNGs -> frontend/public/images/{recruiter,manager,hr}/
# Place sources under frontend/assets/expression-source/ using the same folder names
# as the original export (e.g. "uni n rb", "hr m rb"). Run from repo root:
#   .\frontend\scripts\normalize-expression-images.ps1
#
# Folder suffix "n" / "m" = neutral vs stern MOOD packs (not Female/Male voice).
# Each pack must contain exactly 4 PNGs that sort into this frame order:
#   0 = rest (eyes open), 1 = talk (mouth open), 2 = blink (eyes closed), 3 = warm smile

$ErrorActionPreference = "Stop"
$frontendRoot = Split-Path $PSScriptRoot -Parent
$srcBase = Join-Path $frontendRoot "assets\expression-source"
$destBase = Join-Path $frontendRoot "public\images"

$mappings = @(
  @{ Src = "uni n rb"; Char = "recruiter"; Mood = "neutral" },
  @{ Src = "uni m rb"; Char = "recruiter"; Mood = "stern" },
  @{ Src = "senior n rb"; Char = "manager"; Mood = "neutral" },
  @{ Src = "senior m rb"; Char = "manager"; Mood = "stern" },
  @{ Src = "hr n rb"; Char = "hr"; Mood = "neutral" },
  @{ Src = "hr m rb"; Char = "hr"; Mood = "stern" }
)

foreach ($m in $mappings) {
  $dir = Join-Path $srcBase $m.Src
  if (-not (Test-Path $dir)) {
    throw "Missing source folder: $dir (add raw PNGs there before running)"
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
