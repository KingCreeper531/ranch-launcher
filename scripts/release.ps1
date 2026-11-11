# Publishes a Ranch Launcher release on GitHub (KingCreeper531/ranch-launcher):
#   - Ranch-Launcher-Setup-<version>.exe     Windows installer
#   - Ranch-Launcher-Android-<version>.apk   Android
#   - Ranch-Launcher-iOS-<version>.ipa       added a few minutes later by GitHub's Mac build (.github/workflows/ios.yml)
#
# Run from the launcher folder:  npm run release   (or: npm run release -- -Bump minor)
# The launcher's source lives in the YouTube Music project (branch ranch-launcher, folder launcher/)
# and is published to its own repo by splitting that folder out.
param(
  [ValidateSet('patch', 'minor', 'major')] [string]$Bump = 'patch',
  [string]$Notes = ''
)
# Native tools write progress to stderr; failures are caught by exit codes in Run() instead.
$ErrorActionPreference = 'Continue'
$launcher = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $launcher
Set-Location $launcher

function Run($exe, [string[]]$argv) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "$exe $($argv -join ' ') failed (exit $LASTEXITCODE)" }
}

$repo = 'KingCreeper531/ranch-launcher'
$branch = (& git -C $root rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'ranch-launcher') { throw "Launcher releases come from the ranch-launcher branch (you're on '$branch'). Run: git checkout ranch-launcher" }

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
& gh release view "v$version" --repo $repo *> $null
if ($LASTEXITCODE -eq 0) {
  Run npm @('version', $Bump, '--no-git-tag-version')
  $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
}
Write-Host "Releasing Ranch Launcher v$version" -ForegroundColor Green

# ---------------------------------------------------------------- Windows
if (Test-Path dist) { Remove-Item -Recurse -Force dist }
Run npm @('run', 'build:ui')
Run npx @('electron-builder', '--win', '--publish', 'never')
$exe = "dist\Ranch-Launcher-Setup-$version.exe"

# ---------------------------------------------------------------- Android
# If ~\.gradle isn't writable here, use a Gradle folder inside the project and pass the signing settings along.
$gradleHome = Join-Path $env:USERPROFILE '.gradle'
$canWrite = $true
try { $probe = Join-Path $gradleHome '.ranch-write-test'; [IO.File]::WriteAllText($probe, 'x'); Remove-Item $probe -Force } catch { $canWrite = $false }
if (-not $canWrite) {
  $env:GRADLE_USER_HOME = Join-Path $launcher 'android\.gradle-home'
  Get-Content (Join-Path $gradleHome 'gradle.properties') -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^(YTM_[A-Z_]+)=(.*)$' } |
    ForEach-Object { Set-Item -Path "env:ORG_GRADLE_PROJECT_$($Matches[1])" -Value $Matches[2] }
}
Push-Location android
try { Run '.\gradlew.bat' @('assembleRelease', '--no-daemon', '-q') } finally { Pop-Location }
$apk = Get-ChildItem "android\app\build\outputs\apk\release\*.apk" | Select-Object -First 1
if (-not $apk) { throw 'Android build produced no APK' }
Copy-Item $apk.FullName "dist\Ranch-Launcher-Android-$version.apk" -Force
$apk = "dist\Ranch-Launcher-Android-$version.apk"

# The Windows launcher updates itself from these two files
$latestYml = 'dist\latest.yml'
$blockmap = "$exe.blockmap"

foreach ($f in $exe, $apk, $latestYml, $blockmap) { if (-not (Test-Path $f)) { throw "Missing build output: $f" } }

# ---------------------------------------------------------------- source to GitHub
Run git @('-C', $root, 'add', 'launcher')
& git -C $root diff --cached --quiet
if ($LASTEXITCODE -ne 0) { Run git @('-C', $root, 'commit', '-q', '-m', "Ranch Launcher v$version") }
Run git @('-C', $root, 'subtree', 'split', '--prefix=launcher', '-b', 'ranch-launcher-standalone')
Run git @('-C', $root, 'push', '-q', "https://github.com/$repo.git", 'ranch-launcher-standalone:main')

# ---------------------------------------------------------------- the release
if (-not $Notes) {
  $Notes = @"
## Download
- **Ranch-Launcher-Setup-$version.exe**: Windows. Installs, updates and opens your apps, and edits their settings.
- **Ranch-Launcher-Android-$version.apk**: Android. Open it on your phone to install; Android asks you to confirm each app it installs.
- **Ranch-Launcher-iOS-$version.ipa**: iPhone and iPad (appears a few minutes after this release). Install it with AltStore or Sideloadly. iPhones can't install apps from another app, so on iPhone the launcher shows your apps and takes you to their download pages.

Windows may show a SmartScreen warning because the launcher isn't code-signed. Click **More info**, then **Run anyway**.
"@
}
$ghArgs = @('release', 'create', "v$version", '--repo', $repo, '--target', 'main', '--title', "Ranch Launcher v$version", '--notes', $Notes, $exe, $blockmap, $latestYml, $apk)
Run gh $ghArgs
Write-Host "Published https://github.com/$repo/releases/tag/v$version (the .ipa follows in a few minutes)" -ForegroundColor Green
