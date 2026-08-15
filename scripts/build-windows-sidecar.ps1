# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Igor Cassimiro Assunção
param(
    [string]$Python = "",
    [int]$MaxSizeMiB = 1536
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$pythonRoot = Join-Path $repoRoot "src-python"
$venv = Join-Path $pythonRoot ".venv-sidecar-cpu"
$venvPython = Join-Path $venv "Scripts\python.exe"
$artifact = Join-Path $pythonRoot "dist\ai-notetaking-engine"
$destination = Join-Path $repoRoot "src-tauri\binaries\ai-notetaking-engine-windows-x64-cpu.zip"

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
& $venvPython -m pip install -r (Join-Path $pythonRoot "requirements-windows-cpu.txt")

$modelRoot = Join-Path $pythonRoot "models\whisper"
New-Item -ItemType Directory -Force -Path $modelRoot | Out-Null
& $venvPython -c "import whisperx; whisperx.load_model('base', 'cpu', compute_type='int8', download_root=r'$modelRoot')"

$cudaVersion = & $venvPython -c "import torch; print(torch.version.cuda or '')"
if ($cudaVersion.Trim()) {
    throw "CPU sidecar build contains CUDA Torch $cudaVersion. Delete $venv and rebuild."
}

Push-Location $pythonRoot
try {
    & $venvPython -m PyInstaller --clean --noconfirm build.spec
} finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath (Join-Path $artifact "ai-notetaking-engine.exe"))) {
    throw "PyInstaller did not produce $artifact"
}

& (Join-Path $artifact "ai-notetaking-engine.exe") --self-test
if ($LASTEXITCODE -ne 0) { throw "CPU engine self-test failed with exit code $LASTEXITCODE" }

$unpackedBytes = (Get-ChildItem -LiteralPath $artifact -File -Recurse | Measure-Object -Property Length -Sum).Sum
$sizeMiB = [math]::Round($unpackedBytes / 1MB, 1)
if ($sizeMiB -gt $MaxSizeMiB) {
    throw "Sidecar is $sizeMiB MiB; release budget is $MaxSizeMiB MiB."
}

if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }
Compress-Archive -Path (Join-Path $artifact "*") -DestinationPath $destination -CompressionLevel Optimal
$compressedMiB = [math]::Round((Get-Item -LiteralPath $destination).Length / 1MB, 1)
Write-Host "Built CPU sidecar: $destination ($compressedMiB MiB compressed, $sizeMiB MiB unpacked)"
