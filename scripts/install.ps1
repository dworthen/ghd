<#
.SYNOPSIS
  Installs ghd on Windows.

.DESCRIPTION
  This script downloads the latest release of ghd from GitHub, extracts the binary, and adds it to the user PATH.

.PARAMETER version
  Optional. Specify version to install.
  Defaults to the latest version

.PARAMETER to
  Optional. Specify location to install the binary.
  Defaults to ~/bin/

.EXAMPLE
  install-ghd.ps1

.EXAMPLE
  install.ps1 -Version v0.1.0 -To ./local/dir

.NOTES
  View help with
  Get-Help ./PATH_TO_SCRIPT -Full

  Requires gh CLI to be installed and authenticated with EMU account. 
  Install it from https://cli.github.com/ then run gh auth login to authenticate.

.LINK
  https://cli.github.com/
#>
param(
  [Parameter(
    Mandatory = $false,
    ValueFromPipeline = $false,
    ValueFromPipelineByPropertyName = $true,
    HelpMessage = "Specify version to install. Defaults to latest version."
  )]
  [string] $Version = "latest",

  [Parameter(
    Mandatory = $false,
    ValueFromPipeline = $false,
    ValueFromPipelineByPropertyName = $true,
    HelpMessage = "Specify install location."
  )]
  [string] $To = "$HOME\.ghd\bin"
)
$ErrorActionPreference = "Stop"

$repo = "dworthen/ghd"

# Check requirements
$ghPath = Get-Command gh -ErrorAction SilentlyContinue
if (-not $ghPath) {
  Write-Error "gh CLI is required but not found. Install it from https://cli.github.com/ then run gh auth login to authenticate with EMU account."
  exit 1
}

if (-not $IsWindows -or $PSVersionTable.PSVersion.Major -lt 6) {
  Write-Error "This installer only supports Windows and PowerShell 6 or later."
  exit 1
}

function Get-Platform {
  $arch = $env:PROCESSOR_ARCHITECTURE
  switch ($arch) {
    "AMD64" { return "win-x64" }
    "ARM64" { return "win-arm64" }
    default {
      Write-Error "Unsupported architecture: $arch"
      exit 1
    }
  }
}

function Resolve-Tag {
  $tag = $Version
  if ($tag -eq "latest") {
    try {
      $tag = (gh release view --repo $Repo --json tagName --jq '.tagName' 2>$null)
    }
    catch {
      $tag = $null
    }
    if (-not $tag -or $tag -eq "null" -or $tag.StartsWith("{")) {
      Write-Error "Could not resolve latest release tag for $Repo"
      exit 1
    }
  }
  return $tag
}

function Download-Binary {
  $asset = "$platform.zip"
  $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ghd-download-" + [System.Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $tempDir | Out-Null


  try {
    $archive = Join-Path $tempDir $asset
    Write-Host "Downloading $asset ..."

    try {
      & gh release download $tag --repo $repo --pattern $asset --dir $tempDir --clobber 2>$null
    }
    catch {
      Write-Error "Failed to download $asset"
      exit 1
    }

    if (-not (Test-Path $archive)) {
      Write-Error "Download produced no file"
      exit 1
    }

    Write-Host "Extracting ..."
    Expand-Archive -Path $archive -DestinationPath $tempDir -Force
    $exe = Get-ChildItem -Path $tempDir -Filter "ghd.exe" -Recurse | Select-Object -First 1

    if ($exe) {
      New-Item -ItemType Directory -Force -Path $To | Out-Null
      Move-Item -Force $exe.FullName $To
      Write-Host "ghd.exe installed to $To"
    }
    else {
      Write-Error "ghd.exe not found inside $asset"
      exit 1
    }
  }
  finally {
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
  }
}

function Add-To-Path {
  $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
  $binDirResolved = (Resolve-Path $To).Path

  if ($userPath -split ";" | ForEach-Object { $_.TrimEnd("\") } | Where-Object { $_ -eq $binDirResolved.TrimEnd("\") }) {
    Write-Host "$binDirResolved is already in user PATH."
  }
  else {
    $newPath = if ($userPath) { "$userPath;$binDirResolved" } else { $binDirResolved }
    [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
    $env:PATH = "$env:PATH;$binDirResolved"
    Write-Host "Added $binDirResolved to user PATH."
  }
}

$platform = Get-Platform
$tag = Resolve-Tag
Write-Host "Detected platform: $platform"
Write-Host "Resolved version to download: $tag"

Download-Binary
Add-To-Path

Write-Host "ghd installed successfully! You can run 'ghd --help' to get started."

