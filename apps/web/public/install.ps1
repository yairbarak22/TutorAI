# TutorAI Local installer for Windows.
#   irm https://yairbarak22.github.io/TutorAI/install.ps1 | iex
# Downloads tutorai.exe from the latest GitHub Release, checks it against the release's
# SHA256SUMS, installs it to %LOCALAPPDATA%\TutorAI, adds Start Menu and Desktop shortcuts,
# and opens TutorAI. No administrator rights needed. Uninstall: tutorai uninstall
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = 'yairbarak22/TutorAI'
$Base = if ($env:TUTORAI_RELEASE_BASE) { $env:TUTORAI_RELEASE_BASE } else { "https://github.com/$Repo/releases/latest/download" }
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$Asset = "tutorai-windows-$Arch.exe"
$Dir = Join-Path $env:LOCALAPPDATA 'TutorAI'
$Exe = Join-Path $Dir 'tutorai.exe'
$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("tutorai-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

# Downloads a URL to a file; a file:// base (local test releases) is copied instead.
function Get-TutorAIFile([string]$Url, [string]$OutFile) {
  if ($Url -like 'file:*') { Copy-Item -Force ([uri]$Url).LocalPath $OutFile }
  else { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile }
}

try {
  Write-Host "Downloading TutorAI (windows, $Arch)..."
  try {
    Get-TutorAIFile "$Base/$Asset" (Join-Path $Tmp 'tutorai.exe')
  } catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) {
      throw "no TutorAI release for $Asset was found yet. Use the browser version for now: https://yairbarak22.github.io/TutorAI/"
    }
    throw
  }
  Get-TutorAIFile "$Base/SHA256SUMS" (Join-Path $Tmp 'SHA256SUMS')

  $Line = Get-Content (Join-Path $Tmp 'SHA256SUMS') | ForEach-Object { $_.TrimEnd("`r") } | Where-Object { $_ -match "\s\*?$([regex]::Escape($Asset))$" } | Select-Object -First 1
  if (-not $Line) { throw "no checksum for $Asset" }
  $Want = ($Line -split '\s+')[0].ToLower()
  $Got = (Get-FileHash -Algorithm SHA256 (Join-Path $Tmp 'tutorai.exe')).Hash.ToLower()
  if ($Want -ne $Got) { throw 'checksum mismatch; the download is not the published file' }

  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  if (Test-Path $Exe) {
    & $Exe stop 2>$null | Out-Null
    # A running .exe can be renamed but not overwritten; the old copy is deleted on the next start.
    Remove-Item -Force "$Exe.old" -ErrorAction SilentlyContinue
    Rename-Item -Force $Exe "tutorai.exe.old"
  }
  Move-Item -Force (Join-Path $Tmp 'tutorai.exe') $Exe
  try { Get-TutorAIFile "$Base/icon.ico" (Join-Path $Dir 'icon.ico') } catch {}

  # Shortcuts in the Start Menu and on the Desktop.
  $Shell = New-Object -ComObject WScript.Shell
  $Targets = @(
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'TutorAI.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'TutorAI.lnk')
  )
  foreach ($Path in $Targets) {
    $Link = $Shell.CreateShortcut($Path)
    $Link.TargetPath = $Exe
    $Link.Arguments = 'open'
    $Link.WindowStyle = 7
    $Link.Description = 'TutorAI study companion'
    if (Test-Path (Join-Path $Dir 'icon.ico')) { $Link.IconLocation = (Join-Path $Dir 'icon.ico') }
    $Link.Save()
  }

  # The tutorai command in new terminals (user PATH, no admin).
  $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not ($UserPath -split ';' | Where-Object { $_ -eq $Dir })) {
    [Environment]::SetEnvironmentVariable('Path', (($UserPath, $Dir) | Where-Object { $_ }) -join ';', 'User')
  }

  Write-Host ''
  Write-Host 'TutorAI is installed.'
  Write-Host '  To open it later: the TutorAI icon on your Desktop or in the Start menu.'
  Write-Host '  When you are done: just close the browser. TutorAI stops by itself after 15 minutes without use.'
  Write-Host 'Opening TutorAI in your browser...'
  if ($env:TUTORAI_NO_OPEN -ne '1') { & $Exe open }
} catch {
  # No `exit`: under `irm | iex` it would close the student's PowerShell window with the message.
  Write-Host "TutorAI install failed: $($_.Exception.Message)" -ForegroundColor Red
  return
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
