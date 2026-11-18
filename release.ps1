# Publishes a new version of Student Tracker.
#
# Usage (in PowerShell, inside the project folder):
#   .\release.ps1            -> 1.0.0 -> 1.0.1  (small fix)
#   .\release.ps1 minor      -> 1.0.1 -> 1.1.0  (new feature)
#   .\release.ps1 major      -> 1.1.0 -> 2.0.0  (big change)
#
# What it does: commits your changes, raises the version number, pushes to GitHub.
# GitHub then builds the installer by itself (about 5 minutes) and publishes it as a release.
# The computer that runs the app sees the new version and offers "Update now".

param([ValidateSet('patch', 'minor', 'major')] [string]$Bump = 'patch')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

git add -A
if (git status --porcelain) {
    $msg = Read-Host 'Short description of the changes'
    if (-not $msg) { $msg = 'Update' }
    git commit -m $msg
}

$newVersion = npm version $Bump -m "Release %s"
if ($LASTEXITCODE -ne 0) { throw 'npm version failed' }

git push
git push --tags

$repo = (git remote get-url origin) -replace '\.git$', ''
Write-Host ''
Write-Host "Released $newVersion. GitHub is building it now (about 5 min)." -ForegroundColor Green
Write-Host "Progress: $repo/actions"
Write-Host "Release:  $repo/releases"
