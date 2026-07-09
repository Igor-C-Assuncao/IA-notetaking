# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Igor Cassimiro Assunção
param(
    [string]$Python = "",
    [int]$MaxSizeMiB = 4096
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$pythonRoot = Join-Path $repoRoot "src-python"
$venv = Join-Path $pythonRoot ".venv-sidecar-gpu"
$venvPython = Join-Path $venv "Scripts\python.exe"
$artifact = Join-Path $pythonRoot "dist\ai-notetaking-engine.exe"
$destination = Join-Path $repoRoot "src-tauri\binaries\ai-notetaking-engine-windows-x64-gpu.exe"

if (-not $Python) {
    $candidates = @(
        (Join-Path $pythonRoot ".venv\Scripts\python.exe"),
        "python",
        "python3",
        "py"
    )
    foreach ($candidate in $candidates) {
        if ((Test-Path -LiteralPath $candidate) -or (Get-Command $candidate -ErrorAction SilentlyContinue)) {
            $Python = $candidate
            break
        }
    }
}
if (-not $Python) {
    throw "Python 3.12 was not found. Pass -Python with an interpreter path."
}

if (-not (Test-Path -LiteralPath $venvPython)) {
    if ((Split-Path -Leaf $Python) -eq "py") {
        & $Python -3.12 -m venv $venv
    } else {
        & $Python -m venv $venv
    }
}

& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r (Join-Path $pythonRoot "requirements.txt")
& $venvPython -m pip install pyinstaller==6.16.0

$cudaVersion = & $venvPython -c "import torch; print(torch.version.cuda or '')"
if (-not $cudaVersion.Trim()) {
    throw "GPU sidecar build does not contain CUDA Torch. Delete $venv and rebuild."
}

Push-Location $pythonRoot
try {
    & $venvPython -m PyInstaller --clean --noconfirm build.spec
} finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $artifact)) {
    throw "PyInstaller did not produce $artifact"
}

$sizeMiB = [math]::Round((Get-Item -LiteralPath $artifact).Length / 1MB, 1)
if ($sizeMiB -gt $MaxSizeMiB) {
    throw "Sidecar is $sizeMiB MiB; release budget is $MaxSizeMiB MiB."
}

Copy-Item -LiteralPath $artifact -Destination $destination -Force
Write-Host "Built GPU sidecar: $destination ($sizeMiB MiB, CUDA $cudaVersion)"
