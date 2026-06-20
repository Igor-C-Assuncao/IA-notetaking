# Windows Sidecar Size

The 3.26 GB sidecar was built from a CUDA-enabled Torch environment. The current
development environment uses Torch `2.8.0+cu128`; its CUDA DLLs and libraries
account for several gigabytes before PyInstaller compression.

## Release profile

Build the Windows release sidecar from the repository root:

```powershell
npm run sidecar:build:windows
npm run sidecar:check
```

The build script:

- creates an isolated `.venv-sidecar-cpu`;
- installs the CPU-only Torch profile;
- aborts if `torch.version.cuda` is set;
- builds the one-file PyInstaller executable;
- copies it to the filename expected by Tauri;
- rejects artifacts larger than 1536 MiB.

Models are not embedded unless `src-python/models/` exists. Keep model weights
out of that directory for release builds and download/cache them at runtime.

## GPU distribution

Do not mix CUDA libraries into the default installer. If GPU acceleration is a
release requirement, publish it as a separate optional package and measure its
installer size independently. Deleting CUDA DLLs after PyInstaller collection
is not supported because Torch may fail during import.

Override the size gate only for an explicitly approved build:

```powershell
$env:SIDECAR_MAX_MIB = "2048"
npm run sidecar:check
```
