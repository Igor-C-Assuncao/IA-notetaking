// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
use fs2::available_space;
use keyring::Entry;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri::{LogicalSize, Window};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

// Parses a stored structured_summary JSON blob, falling back to an empty
// object so read-modify-write persistence never loses the rest of the summary.
fn parse_structured_summary(raw: Option<&str>) -> serde_json::Value {
    raw.and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

#[cfg(target_os = "linux")]
fn sanitize_snap_runtime_env() {
    // When VS Code is installed as Snap, these vars can leak Snap GTK/GIO paths
    // into child processes and crash Tauri with GLIBC symbol lookup errors.
    let vars = [
        ("GTK_PATH", "GTK_PATH_VSCODE_SNAP_ORIG"),
        ("GTK_EXE_PREFIX", "GTK_EXE_PREFIX_VSCODE_SNAP_ORIG"),
        ("GTK_IM_MODULE_FILE", "GTK_IM_MODULE_FILE_VSCODE_SNAP_ORIG"),
        ("GTK_MODULES", "GTK_MODULES_VSCODE_SNAP_ORIG"),
        ("GTK3_MODULES", "GTK3_MODULES_VSCODE_SNAP_ORIG"),
        ("GIO_MODULE_DIR", "GIO_MODULE_DIR_VSCODE_SNAP_ORIG"),
        (
            "GSETTINGS_SCHEMA_DIR",
            "GSETTINGS_SCHEMA_DIR_VSCODE_SNAP_ORIG",
        ),
        ("LOCPATH", "LOCPATH_VSCODE_SNAP_ORIG"),
        ("XDG_DATA_DIRS", "XDG_DATA_DIRS_VSCODE_SNAP_ORIG"),
        ("XDG_CONFIG_DIRS", "XDG_CONFIG_DIRS_VSCODE_SNAP_ORIG"),
        ("XDG_DATA_HOME", "XDG_DATA_HOME_VSCODE_SNAP_ORIG"),
    ];

    for (var, orig_var) in vars {
        if let Ok(orig) = std::env::var(orig_var) {
            if orig.is_empty() {
                std::env::remove_var(var);
            } else {
                std::env::set_var(var, orig);
            }
        } else {
            std::env::remove_var(var);
        }
    }
}

// ── 1. Data structures ────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct Meeting {
    id: Option<i32>,
    date: String,
    title: String,
    raw_transcript: String,
    markdown_summary: String,
    speakers: Option<String>,            // JSON array of speaker names
    tags: Option<String>,                // JSON array of tag strings
    structured_summary: Option<String>,  // Full structured JSON from LangGraph
    transcript_segments: Option<String>, // Versioned transcript evidence JSON
    schema_version: i32,
}

// ── 2. Global application state ───────────────────────────────

struct AppState {
    db: Arc<Mutex<Connection>>,
    python_stdin: Arc<Mutex<Option<ChildStdin>>>,
    python_child: Arc<Mutex<Option<Child>>>,
    // Monotonic supervisor generation: every (re)start claims a new value and
    // stale supervisor loops exit instead of respawning. Prevents two
    // supervisors (e.g. React StrictMode double-invoking start_sidecar) from
    // endlessly overwriting each other's stdin and restarting each other.
    supervisor_gen: Arc<AtomicU64>,
    engine_download: Arc<Mutex<Option<EngineDownloadControl>>>,
    diagnostics: Arc<Mutex<Vec<DiagnosticEvent>>>,
    runtime_status: Arc<Mutex<serde_json::Value>>,
}

#[derive(Clone)]
struct EngineDownloadControl {
    kind: String,
    cancelled: Arc<AtomicBool>,
}

#[derive(serde::Serialize, Clone)]
struct DiagnosticEvent {
    timestamp: String,
    source: String,
    level: String,
    code: String,
    message: String,
    attempt: Option<u32>,
    exit_code: Option<i32>,
}

#[derive(serde::Serialize)]
struct RuntimeDiagnostics {
    status: serde_json::Value,
    events: Vec<DiagnosticEvent>,
}

fn push_diagnostic(store: &Arc<Mutex<Vec<DiagnosticEvent>>>, event: DiagnosticEvent) {
    if let Ok(mut events) = store.lock() {
        events.push(event);
        let excess = events.len().saturating_sub(200);
        if excess > 0 {
            events.drain(0..excess);
        }
    }
}

fn sanitized_diagnostic_message(message: &str) -> String {
    let lowered = message.to_ascii_lowercase();
    if [
        "api_key",
        "token",
        "authorization",
        "raw_transcript",
        "markdown",
        "prompt",
    ]
    .iter()
    .any(|needle| lowered.contains(needle))
    {
        return "Sensitive diagnostic detail was redacted.".to_string();
    }
    message.chars().take(500).collect()
}

const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
const ENGINE_MANIFEST_FILE: &str = "engines-manifest.json";

#[derive(serde::Serialize)]
struct EngineStatus {
    installed: bool,
    kind: String,
    version: String,
    path: Option<String>,
    size_bytes: Option<u64>,
    dev_mode: bool,
    download_supported: bool,
}

#[derive(serde::Deserialize)]
struct EngineManifest {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    version: String,
    engines: Vec<EngineManifestEntry>,
}

#[derive(serde::Deserialize, Clone)]
struct EngineManifestEntry {
    kind: String,
    #[serde(default)]
    architecture: String,
    #[serde(default)]
    archive: String,
    file_name: String,
    #[serde(default)]
    entrypoint: String,
    sha256: String,
    #[serde(default, alias = "size_bytes")]
    compressed_size: u64,
    #[serde(default)]
    unpacked_size: u64,
    url: Option<String>,
    chunks: Option<Vec<EngineManifestChunk>>,
    #[serde(default)]
    model: Option<EngineModelManifest>,
}

#[derive(serde::Deserialize, Clone)]
struct EngineModelManifest {
    name: String,
    relative_path: String,
    sha256: Option<String>,
    size_bytes: u64,
}

#[derive(serde::Deserialize, Clone)]
struct EngineManifestChunk {
    file_name: String,
    sha256: String,
    size_bytes: u64,
    url: Option<String>,
}

struct EngineAssetDownload<'a> {
    kind: &'a str,
    url: &'a str,
    expected_size: u64,
    expected_sha256: Option<&'a str>,
    package_size: u64,
    message: &'a str,
}

#[derive(serde::Serialize)]
struct EngineCapabilities {
    architecture: String,
    nvidia_available: bool,
    gpu_supported: bool,
    recommended_kind: String,
    reason: String,
}

#[derive(serde::Serialize)]
struct OllamaStatus {
    installed: bool,
    running: bool,
    models: Vec<String>,
    active_models: Vec<String>,
    state: String,
    message: String,
}

fn engine_archive_file_name(kind: &str) -> &'static str {
    match kind {
        "gpu" => "ai-notetaking-engine-windows-x64-gpu.zip",
        _ => "ai-notetaking-engine-windows-x64-cpu.zip",
    }
}

fn default_engine_entrypoint() -> &'static str {
    if cfg!(target_os = "windows") {
        "ai-notetaking-engine.exe"
    } else {
        "ai-notetaking-engine"
    }
}

fn engine_release_base() -> String {
    format!(
        "https://github.com/Igor-C-Assuncao/IA-notetaking/releases/download/{}",
        option_env!("AI_NOTETAKING_ENGINE_RELEASE_TAG")
            .unwrap_or(concat!("v", env!("CARGO_PKG_VERSION")))
    )
}

fn engine_download_url(kind: &str) -> String {
    format!(
        "{}/{}",
        engine_release_base(),
        engine_archive_file_name(kind)
    )
}

fn engine_asset_url(file_name: &str) -> String {
    format!("{}/{}", engine_release_base(), file_name)
}

fn engine_manifest_url() -> String {
    format!("{}/{}", engine_release_base(), ENGINE_MANIFEST_FILE)
}

fn fetch_engine_manifest() -> Result<EngineManifest, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(None)
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(engine_manifest_url())
        .send()
        .map_err(|e| format!("Failed to fetch engine manifest: {}", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "Engine manifest download failed with HTTP {}",
            response.status()
        ));
    }
    let manifest = response
        .json::<EngineManifest>()
        .map_err(|e| format!("Invalid engine manifest: {}", e))?;
    if manifest.schema_version != 2 {
        return Err(format!(
            "Engine manifest v{} is no longer executable. Update to v0.3.2 or later to install the recoverable engine package.",
            manifest.schema_version.max(1)
        ));
    }
    if manifest.version != ENGINE_VERSION {
        return Err(format!(
            "Engine manifest version {} does not match application version {}.",
            manifest.version, ENGINE_VERSION
        ));
    }
    Ok(manifest)
}

fn manifest_entry_for(kind: &str) -> Result<EngineManifestEntry, String> {
    let manifest = fetch_engine_manifest()?;
    manifest
        .engines
        .into_iter()
        .find(|entry| entry.kind == kind)
        .ok_or_else(|| format!("Engine manifest does not contain a '{}' package.", kind))
}

fn engine_dir(app: &AppHandle, kind: &str) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("engines").join(ENGINE_VERSION).join(kind))
}

fn engine_download_dir(app: &AppHandle, kind: &str) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data_dir
        .join("engines")
        .join(ENGINE_VERSION)
        .join(format!("{}.download", kind)))
}

fn engine_path(app: &AppHandle, kind: &str) -> Result<PathBuf, String> {
    let directory = engine_dir(app, kind)?;
    let entrypoint = std::fs::read_to_string(directory.join("installation.json"))
        .ok()
        .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
        .and_then(|value| {
            value
                .get("entrypoint")
                .and_then(|item| item.as_str())
                .map(str::to_string)
        })
        .filter(|value| !value.contains("..") && !Path::new(value).is_absolute())
        .unwrap_or_else(|| default_engine_entrypoint().to_string());
    Ok(directory.join(entrypoint))
}

fn find_downloaded_engine(app: &AppHandle, kind: &str) -> Option<PathBuf> {
    let path = engine_path(app, kind).ok()?;
    let marker = engine_dir(app, kind).ok()?.join("installation.json");
    let is_nonempty = path
        .metadata()
        .map(|metadata| metadata.len() > 0)
        .unwrap_or(false);
    if is_nonempty && marker.is_file() {
        Some(path)
    } else {
        None
    }
}

fn find_bundled_engine(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let executable_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from));
    let expected_names: &[&str] = if cfg!(target_os = "macos") {
        &[
            "ai-notetaking-engine-aarch64-apple-darwin",
            "ai-notetaking-engine",
        ]
    } else if cfg!(target_os = "linux") {
        &[
            "ai-notetaking-engine-x86_64-unknown-linux-gnu",
            "ai-notetaking-engine",
        ]
    } else {
        &["ai-notetaking-engine-x86_64-pc-windows-msvc.exe"]
    };
    [
        Some(resource_dir.clone()),
        Some(resource_dir.join("engine")),
        Some(resource_dir.join("binaries")),
        executable_dir,
    ]
    .into_iter()
    .flatten()
    .flat_map(|directory| expected_names.iter().map(move |name| directory.join(name)))
    .find(|path| {
        path.metadata()
            .map(|metadata| metadata.len() > 0)
            .unwrap_or(false)
    })
}

#[tauri::command]
fn get_engine_status(app: AppHandle, kind: Option<String>) -> Result<EngineStatus, String> {
    let kind = kind.unwrap_or_else(|| "cpu".to_string());

    if cfg!(debug_assertions) {
        return Ok(EngineStatus {
            installed: true,
            kind,
            version: ENGINE_VERSION.to_string(),
            path: None,
            size_bytes: None,
            dev_mode: true,
            download_supported: cfg!(target_os = "windows"),
        });
    }

    let path = find_downloaded_engine(&app, &kind).or_else(|| find_bundled_engine(&app));
    let size_bytes = path
        .as_ref()
        .and_then(|p| p.metadata().ok().map(|metadata| metadata.len()));

    Ok(EngineStatus {
        installed: path.is_some(),
        kind,
        version: ENGINE_VERSION.to_string(),
        path: path.map(|p| p.to_string_lossy().to_string()),
        size_bytes,
        dev_mode: false,
        download_supported: cfg!(target_os = "windows"),
    })
}

#[tauri::command]
async fn download_engine(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: String,
) -> Result<EngineStatus, String> {
    if kind != "cpu" && kind != "gpu" {
        return Err("Unknown engine kind. Choose CPU or GPU.".to_string());
    }
    if cfg!(debug_assertions) {
        return get_engine_status(app, Some(kind));
    }
    if !cfg!(target_os = "windows") {
        return get_engine_status(app, Some(kind)).and_then(|status| {
            if status.installed {
                Ok(status)
            } else {
                Err(
                    "The bundled transcription component is missing. Reinstall the application."
                        .to_string(),
                )
            }
        });
    }

    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut active = state
            .engine_download
            .lock()
            .map_err(|_| "Download state is unavailable.")?;
        if let Some(existing) = active.as_ref() {
            return Err(format!(
                "A {} engine download is already running.",
                existing.kind
            ));
        }
        *active = Some(EngineDownloadControl {
            kind: kind.clone(),
            cancelled: Arc::clone(&cancelled),
        });
    }

    let active_download = Arc::clone(&state.engine_download);
    let worker_app = app.clone();
    let worker_kind = kind.clone();
    let result = match tauri::async_runtime::spawn_blocking(move || {
        download_engine_blocking(worker_app, worker_kind, cancelled)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => Err(format!("Engine download worker failed: {error}")),
    };
    if let Ok(mut active) = active_download.lock() {
        *active = None;
    }
    result
}

#[tauri::command]
fn cancel_engine_download(state: State<'_, AppState>) -> Result<bool, String> {
    let active = state
        .engine_download
        .lock()
        .map_err(|_| "Download state is unavailable.")?;
    if let Some(download) = active.as_ref() {
        download.cancelled.store(true, AtomicOrdering::SeqCst);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn get_engine_capabilities() -> EngineCapabilities {
    let architecture = std::env::consts::ARCH.to_string();
    let nvidia_available = cfg!(target_os = "windows")
        && Command::new("nvidia-smi")
            .args(["--query-gpu=name", "--format=csv,noheader"])
            .output()
            .map(|output| output.status.success() && !output.stdout.is_empty())
            .unwrap_or(false);
    let gpu_supported = nvidia_available && architecture == "x86_64";
    EngineCapabilities {
        architecture,
        nvidia_available,
        gpu_supported,
        recommended_kind: if gpu_supported { "gpu" } else { "cpu" }.to_string(),
        reason: if gpu_supported {
            "A compatible NVIDIA GPU was detected.".to_string()
        } else {
            "No compatible NVIDIA CUDA device was detected; CPU is the reliable choice.".to_string()
        },
    }
}

fn download_engine_blocking(
    app: AppHandle,
    kind: String,
    cancelled: Arc<AtomicBool>,
) -> Result<EngineStatus, String> {
    if find_downloaded_engine(&app, &kind).is_some() {
        return get_engine_status(app, Some(kind));
    }
    let entry = manifest_entry_for(&kind)?;
    validate_manifest_entry(&entry)?;
    let download_dir = engine_download_dir(&app, &kind)?;
    std::fs::create_dir_all(&download_dir).map_err(actionable_disk_error)?;

    let cached_bytes = directory_size(&download_dir)
        .unwrap_or(0)
        .min(entry.compressed_size);
    let required = entry
        .compressed_size
        .saturating_sub(cached_bytes)
        .saturating_add(entry.unpacked_size)
        .saturating_add(entry.unpacked_size / 10);
    let free = available_space(&download_dir).map_err(actionable_disk_error)?;
    if free < required {
        return Err(format!("Not enough disk space. Free at least {} MB and retry; valid partial downloads were preserved.", (required - free).div_ceil(1024 * 1024)));
    }

    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(None)
        .build()
        .map_err(|error| format!("Could not initialize the network client: {error}"))?;
    let package_path = download_dir.join(&entry.file_name);
    let chunks = entry.chunks.clone().unwrap_or_default();

    if chunks.is_empty() {
        let url = entry
            .url
            .clone()
            .unwrap_or_else(|| engine_download_url(&kind));
        download_resumable_asset(
            Some(&app),
            &client,
            &package_path,
            &cancelled,
            EngineAssetDownload {
                kind: &kind,
                url: &url,
                expected_size: entry.compressed_size,
                expected_sha256: Some(&entry.sha256),
                package_size: entry.compressed_size,
                message: "Downloading local engine",
            },
            1,
            1,
            0,
        )?;
    } else {
        let total = chunks
            .iter()
            .try_fold(0_u64, |sum, chunk| sum.checked_add(chunk.size_bytes))
            .ok_or_else(|| "Engine chunk sizes overflowed.".to_string())?;
        if total != entry.compressed_size {
            return Err(
                "Invalid engine manifest: chunk sizes do not match compressed_size.".to_string(),
            );
        }
        let mut completed = 0_u64;
        for (index, chunk) in chunks.iter().enumerate() {
            let part_path = download_dir.join(&chunk.file_name);
            let url = chunk
                .url
                .clone()
                .unwrap_or_else(|| engine_asset_url(&chunk.file_name));
            download_resumable_asset(
                Some(&app),
                &client,
                &part_path,
                &cancelled,
                EngineAssetDownload {
                    kind: &kind,
                    url: &url,
                    expected_size: chunk.size_bytes,
                    expected_sha256: Some(&chunk.sha256),
                    package_size: entry.compressed_size,
                    message: "Downloading local engine package",
                },
                index + 1,
                chunks.len(),
                completed,
            )?;
            completed += chunk.size_bytes;
        }
        combine_chunks(&chunks, &download_dir, &package_path)?;
    }

    check_cancelled(&cancelled)?;
    emit_download_progress(
        Some(&app),
        &kind,
        "verifying",
        entry.compressed_size,
        entry.compressed_size,
        0,
        0,
        None,
        None,
        "Verifying package checksum",
    );
    verify_file(&package_path, entry.compressed_size, &entry.sha256)
        .map_err(|_| "Checksum verification failed. Retry the download; antivirus or a proxy may have modified the package.".to_string())?;

    let target_dir = engine_dir(&app, &kind)?;
    let staging_dir = target_dir.with_file_name(format!("{}.installing", kind));
    if staging_dir.exists() {
        std::fs::remove_dir_all(&staging_dir).map_err(actionable_disk_error)?;
    }
    std::fs::create_dir_all(&staging_dir).map_err(actionable_disk_error)?;
    emit_download_progress(
        Some(&app),
        &kind,
        "extracting",
        entry.compressed_size,
        entry.compressed_size,
        0,
        0,
        None,
        None,
        "Installing verified engine package",
    );
    extract_zip(&package_path, &staging_dir, entry.unpacked_size, &cancelled)?;
    let entrypoint = staging_dir.join(&entry.entrypoint);
    if !entrypoint.is_file() {
        return Err(format!(
            "The verified archive is missing its entrypoint: {}",
            entry.entrypoint
        ));
    }
    verify_bundled_model(&staging_dir, entry.model.as_ref())?;
    make_executable(&entrypoint)?;
    std::fs::write(staging_dir.join("installation.json"), serde_json::to_vec_pretty(&serde_json::json!({
        "schema_version": 2, "version": ENGINE_VERSION, "kind": kind, "entrypoint": entry.entrypoint,
        "archive_sha256": entry.sha256, "installed_at": chrono::Utc::now().to_rfc3339()
    })).map_err(|error| error.to_string())?).map_err(actionable_disk_error)?;

    if target_dir.exists() {
        let backup = target_dir.with_file_name(format!("{}.incomplete", kind));
        if backup.exists() {
            std::fs::remove_dir_all(&backup).map_err(actionable_disk_error)?;
        }
        std::fs::rename(&target_dir, &backup).map_err(actionable_disk_error)?;
    }
    std::fs::rename(&staging_dir, &target_dir).map_err(|error| {
        format!("Antivirus or disk policy blocked the final atomic install: {error}")
    })?;
    emit_download_progress(
        Some(&app),
        &kind,
        "completed",
        entry.compressed_size,
        entry.compressed_size,
        0,
        0,
        Some(0),
        Some(0),
        "Engine installed and ready",
    );
    app.emit(
        "engine-download-completed",
        serde_json::json!({
            "kind": kind, "path": target_dir.join(&entry.entrypoint).to_string_lossy(),
            "sha256": entry.sha256, "sizeBytes": entry.compressed_size
        }),
    )
    .ok();
    get_engine_status(app, Some(kind))
}

fn validate_manifest_entry(entry: &EngineManifestEntry) -> Result<(), String> {
    if entry.archive != "zip"
        || entry.entrypoint.is_empty()
        || entry.compressed_size == 0
        || entry.unpacked_size == 0
    {
        return Err("Invalid EngineManifest v2: archive, entrypoint, compressed_size and unpacked_size are required.".to_string());
    }
    if entry.architecture != "x86_64"
        || Path::new(&entry.entrypoint).is_absolute()
        || entry.entrypoint.contains("..")
    {
        return Err("This engine package has an invalid architecture or entrypoint.".to_string());
    }
    if entry
        .model
        .as_ref()
        .and_then(|model| model.sha256.as_ref())
        .is_none()
    {
        return Err(
            "This engine package does not declare a bundled Whisper model checksum.".to_string(),
        );
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn download_resumable_asset(
    app: Option<&AppHandle>,
    client: &reqwest::blocking::Client,
    path: &Path,
    cancelled: &AtomicBool,
    asset: EngineAssetDownload<'_>,
    current_part: usize,
    total_parts: usize,
    completed_before: u64,
) -> Result<(), String> {
    if verify_file(
        path,
        asset.expected_size,
        asset.expected_sha256.unwrap_or(""),
    )
    .is_ok()
    {
        return Ok(());
    }
    for attempt in 1..=5_u32 {
        check_cancelled(cancelled)?;
        let mut offset = path
            .metadata()
            .map(|meta| meta.len())
            .unwrap_or(0)
            .min(asset.expected_size);
        let mut request = client.get(asset.url);
        if offset > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={offset}-"));
        }
        match request.send() {
            Ok(response) if response.status().is_success() => {
                let resumed =
                    offset > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
                if offset > 0 && !resumed {
                    offset = 0;
                }
                let mut output = OpenOptions::new()
                    .create(true)
                    .write(true)
                    .read(true)
                    .truncate(false)
                    .open(path)
                    .map_err(actionable_disk_error)?;
                if resumed {
                    output
                        .seek(SeekFrom::End(0))
                        .map_err(actionable_disk_error)?;
                } else {
                    output.set_len(0).map_err(actionable_disk_error)?;
                }
                let started = Instant::now();
                let mut last_data = Instant::now();
                let mut written = offset;
                let mut last_emit = Instant::now() - Duration::from_secs(1);
                let (sender, receiver) =
                    std::sync::mpsc::sync_channel::<Result<Vec<u8>, String>>(2);
                std::thread::spawn(move || {
                    let mut response = response;
                    let mut buffer = [0_u8; 256 * 1024];
                    loop {
                        match response.read(&mut buffer) {
                            Ok(0) => {
                                let _ = sender.send(Ok(Vec::new()));
                                break;
                            }
                            Ok(read) => {
                                if sender.send(Ok(buffer[..read].to_vec())).is_err() {
                                    break;
                                }
                            }
                            Err(error) => {
                                let _ = sender.send(Err(error.to_string()));
                                break;
                            }
                        }
                    }
                });
                loop {
                    check_cancelled(cancelled)?;
                    match receiver.recv_timeout(Duration::from_millis(250)) {
                        Ok(Ok(bytes)) if bytes.is_empty() => break,
                        Ok(Ok(bytes)) => {
                            last_data = Instant::now();
                            output.write_all(&bytes).map_err(actionable_disk_error)?;
                            written += bytes.len() as u64;
                            if written > asset.expected_size {
                                break;
                            }
                            if last_emit.elapsed() >= Duration::from_millis(250) {
                                let elapsed = started.elapsed().as_secs_f64().max(0.001);
                                let speed = ((written - offset) as f64 / elapsed) as u64;
                                let total_downloaded = completed_before + written;
                                let eta = asset
                                    .package_size
                                    .saturating_sub(total_downloaded)
                                    .checked_div(speed);
                                emit_download_progress(
                                    app,
                                    asset.kind,
                                    "downloading",
                                    total_downloaded,
                                    asset.package_size,
                                    current_part,
                                    total_parts,
                                    Some(speed),
                                    eta,
                                    asset.message,
                                );
                                last_emit = Instant::now();
                            }
                        }
                        Ok(Err(error)) => {
                            emit_download_progress(
                                app,
                                asset.kind,
                                "retrying",
                                completed_before + written,
                                asset.package_size,
                                current_part,
                                total_parts,
                                None,
                                None,
                                &format!("Network interrupted; retrying ({attempt}/5): {error}"),
                            );
                            break;
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                            if last_data.elapsed() >= Duration::from_secs(60) {
                                emit_download_progress(
                                    app,
                                    asset.kind,
                                    "retrying",
                                    completed_before + written,
                                    asset.package_size,
                                    current_part,
                                    total_parts,
                                    None,
                                    None,
                                    &format!(
                                        "No data received for 60 seconds; retrying ({attempt}/5)"
                                    ),
                                );
                                break;
                            }
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
                output.flush().map_err(actionable_disk_error)?;
                if verify_file(
                    path,
                    asset.expected_size,
                    asset.expected_sha256.unwrap_or(""),
                )
                .is_ok()
                {
                    return Ok(());
                }
            }
            Ok(response) => {
                emit_download_progress(
                    app,
                    asset.kind,
                    "retrying",
                    completed_before + offset,
                    asset.package_size,
                    current_part,
                    total_parts,
                    None,
                    None,
                    &format!(
                        "Server returned HTTP {}; retrying ({attempt}/5)",
                        response.status()
                    ),
                );
            }
            Err(error) => {
                emit_download_progress(
                    app,
                    asset.kind,
                    "retrying",
                    completed_before + offset,
                    asset.package_size,
                    current_part,
                    total_parts,
                    None,
                    None,
                    &format!("Network unavailable; retrying ({attempt}/5): {error}"),
                );
            }
        }
        if attempt < 5 {
            for _ in 0..(1_u64 << (attempt - 1)) * 4 {
                check_cancelled(cancelled)?;
                std::thread::sleep(Duration::from_millis(250));
            }
        }
    }
    Err("Download failed after 5 attempts. Check your network, proxy, or antivirus and retry; valid partial data was preserved.".to_string())
}

#[allow(clippy::too_many_arguments)]
fn emit_download_progress(
    app: Option<&AppHandle>,
    kind: &str,
    stage: &str,
    downloaded: u64,
    total: u64,
    current_part: usize,
    total_parts: usize,
    speed: Option<u64>,
    eta: Option<u64>,
    message: &str,
) {
    let attempt = if stage == "retrying" {
        message
            .split("retrying (")
            .nth(1)
            .and_then(|tail| tail.split('/').next())
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(1)
    } else {
        0
    };
    let Some(app) = app else { return };
    app.emit(
        "engine-download-progress",
        serde_json::json!({
            "kind": kind, "stage": stage, "currentPart": current_part, "totalParts": total_parts,
            "attempt": attempt, "downloadedBytes": downloaded,
            "totalBytes": total, "speedBytesPerSecond": speed, "etaSeconds": eta, "message": message
        }),
    )
    .ok();
}

fn check_cancelled(cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(AtomicOrdering::SeqCst) {
        Err(
            "Download cancelled. Valid partial data was preserved for the next attempt."
                .to_string(),
        )
    } else {
        Ok(())
    }
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn verify_file(path: &Path, size: u64, expected_hash: &str) -> Result<(), String> {
    if path.metadata().map(|meta| meta.len()).unwrap_or(0) != size {
        return Err("size mismatch".to_string());
    }
    let hash = sha256_file(path)?;
    if !expected_hash.is_empty() && !hash.eq_ignore_ascii_case(expected_hash) {
        return Err("checksum mismatch".to_string());
    }
    Ok(())
}

fn combine_chunks(
    chunks: &[EngineManifestChunk],
    dir: &Path,
    package: &Path,
) -> Result<(), String> {
    let temp = package.with_extension("assembling");
    let mut output = File::create(&temp).map_err(actionable_disk_error)?;
    for chunk in chunks {
        std::io::copy(
            &mut File::open(dir.join(&chunk.file_name)).map_err(actionable_disk_error)?,
            &mut output,
        )
        .map_err(actionable_disk_error)?;
    }
    output.flush().map_err(actionable_disk_error)?;
    if package.exists() {
        std::fs::remove_file(package).map_err(actionable_disk_error)?;
    }
    std::fs::rename(temp, package).map_err(actionable_disk_error)
}

fn extract_zip(
    package: &Path,
    destination: &Path,
    expected_unpacked: u64,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let file = File::open(package).map_err(actionable_disk_error)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Invalid engine ZIP archive: {error}"))?;
    let mut unpacked = 0_u64;
    for index in 0..archive.len() {
        check_cancelled(cancelled)?;
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| "Unsafe path in engine archive.".to_string())?;
        let output_path = destination.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&output_path).map_err(actionable_disk_error)?;
            continue;
        }
        if let Some(parent) = output_path.parent() {
            std::fs::create_dir_all(parent).map_err(actionable_disk_error)?;
        }
        let mut output = File::create(&output_path).map_err(actionable_disk_error)?;
        unpacked = unpacked
            .checked_add(std::io::copy(&mut entry, &mut output).map_err(actionable_disk_error)?)
            .ok_or_else(|| "Unpacked size overflow.".to_string())?;
        if unpacked > expected_unpacked {
            return Err("Archive expands beyond its declared unpacked_size.".to_string());
        }
    }
    if unpacked != expected_unpacked {
        return Err(format!(
            "Unpacked size mismatch: expected {expected_unpacked}, got {unpacked}."
        ));
    }
    Ok(())
}

fn directory_size(path: &Path) -> Result<u64, String> {
    let mut total = 0_u64;
    if !path.exists() {
        return Ok(0);
    }
    for entry in std::fs::read_dir(path).map_err(actionable_disk_error)? {
        let entry = entry.map_err(actionable_disk_error)?;
        total = total.saturating_add(if entry.path().is_dir() {
            directory_size(&entry.path())?
        } else {
            entry.metadata().map_err(actionable_disk_error)?.len()
        });
    }
    Ok(total)
}

fn collect_files(root: &Path, current: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in std::fs::read_dir(current).map_err(actionable_disk_error)? {
        let entry = entry.map_err(actionable_disk_error)?;
        if entry.path().is_dir() {
            collect_files(root, &entry.path(), files)?;
        } else {
            files.push(
                entry
                    .path()
                    .strip_prefix(root)
                    .map_err(|error| error.to_string())?
                    .to_path_buf(),
            );
        }
    }
    Ok(())
}

fn directory_sha256(root: &Path) -> Result<String, String> {
    let mut files = Vec::new();
    collect_files(root, root, &mut files)?;
    files.sort();
    let mut hasher = Sha256::new();
    for relative in files {
        hasher.update(relative.to_string_lossy().replace('\\', "/").as_bytes());
        hasher.update([0]);
        let mut file = File::open(root.join(relative)).map_err(actionable_disk_error)?;
        let mut buffer = [0_u8; 1024 * 1024];
        loop {
            let read = file.read(&mut buffer).map_err(actionable_disk_error)?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn verify_bundled_model(root: &Path, model: Option<&EngineModelManifest>) -> Result<(), String> {
    let model = model
        .ok_or_else(|| "The engine manifest does not include Whisper base metadata.".to_string())?;
    if model.name != "base" || model.relative_path.contains("..") {
        return Err("The engine contains invalid Whisper model metadata.".to_string());
    }
    let model_path = root.join(&model.relative_path);
    let actual_size = directory_size(&model_path)?;
    if !model_path.is_dir() || actual_size != model.size_bytes {
        return Err("The bundled Whisper base model is missing or incomplete.".to_string());
    }
    // The archive checksum authenticates every model byte; the per-model checksum remains
    // in the installation contract for independent release smoke tests.
    let expected_hash = model.sha256.as_deref().unwrap_or("");
    if expected_hash.len() != 64
        || !directory_sha256(&model_path)?.eq_ignore_ascii_case(expected_hash)
    {
        return Err("The bundled model checksum is invalid.".to_string());
    }
    Ok(())
}

fn actionable_disk_error(error: impl std::fmt::Display) -> String {
    format!("Disk operation failed: {error}. Check free space, permissions, and antivirus quarantine, then retry.")
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = path
        .metadata()
        .map_err(actionable_disk_error)?
        .permissions();
    permissions.set_mode(permissions.mode() | 0o755);
    std::fs::set_permissions(path, permissions).map_err(actionable_disk_error)
}
#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn validate_sidecar_architecture(path: &Path) -> Result<(), String> {
    let mut file = File::open(path).map_err(actionable_disk_error)?;
    let mut header = [0_u8; 4096];
    let read = file.read(&mut header).map_err(actionable_disk_error)?;
    if read < 8 {
        return Err("The sidecar executable is empty or truncated.".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        let is_macho64 = header[..4] == [0xcf, 0xfa, 0xed, 0xfe];
        let expected_cpu = if cfg!(target_arch = "aarch64") {
            [0x0c, 0x00, 0x00, 0x01]
        } else {
            [0x07, 0x00, 0x00, 0x01]
        };
        if !is_macho64 || header[4..8] != expected_cpu {
            return Err(format!(
                "The bundled sidecar architecture does not match {}.",
                std::env::consts::ARCH
            ));
        }
    }
    #[cfg(target_os = "windows")]
    {
        if read < 64 || &header[..2] != b"MZ" {
            return Err("The engine is not a valid Windows executable.".to_string());
        }
        let pe_offset = u32::from_le_bytes(header[60..64].try_into().unwrap()) as usize;
        if pe_offset + 6 > read
            || &header[pe_offset..pe_offset + 4] != b"PE\0\0"
            || header[pe_offset + 4..pe_offset + 6] != [0x64, 0x86]
        {
            return Err("The engine executable is not Windows x86_64.".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod engine_download_tests {
    use super::*;
    use std::net::TcpListener;

    fn temp_test_dir(name: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("ai-notetaking-{name}-{unique}"));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn sha256_bytes(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        format!("{:x}", hasher.finalize())
    }

    fn serve_once(
        status: &'static str,
        body: &'static [u8],
        expected_header: Option<&'static str>,
    ) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let read = stream.read(&mut buffer).unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
            }
            if let Some(header) = expected_header {
                assert!(String::from_utf8_lossy(&request)
                    .to_ascii_lowercase()
                    .contains(&header.to_ascii_lowercase()));
            }
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(body).unwrap();
        });
        (format!("http://{address}/engine"), handle)
    }

    fn test_client() -> reqwest::blocking::Client {
        reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(2))
            .timeout(None)
            .build()
            .unwrap()
    }

    #[test]
    fn v1_manifest_is_read_only_compatibility() {
        let manifest: EngineManifest = serde_json::from_str(
            r#"{"version":"0.3.1","engines":[{"kind":"cpu","file_name":"engine.exe","sha256":"00","size_bytes":12}]}"#,
        ).unwrap();
        assert_eq!(manifest.schema_version, 0);
        assert_eq!(manifest.engines[0].compressed_size, 12);
    }

    #[test]
    fn v2_manifest_rejects_missing_archive_contract() {
        let entry: EngineManifestEntry = serde_json::from_str(
            r#"{"kind":"cpu","file_name":"engine.zip","sha256":"00","compressed_size":12,"unpacked_size":30}"#,
        ).unwrap();
        assert!(validate_manifest_entry(&entry)
            .unwrap_err()
            .contains("EngineManifest v2"));
    }

    #[test]
    fn checksum_and_size_must_both_match() {
        let dir = temp_test_dir("checksum");
        let file = dir.join("asset.bin");
        std::fs::write(&file, b"recoverable").unwrap();
        let hash = sha256_file(&file).unwrap();
        assert!(verify_file(&file, 11, &hash).is_ok());
        assert!(verify_file(&file, 10, &hash).is_err());
        assert!(verify_file(&file, 11, &"0".repeat(64)).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn controlled_http_download_completes_and_verifies() {
        let body = b"complete engine archive";
        let (url, server) = serve_once("200 OK", body, None);
        let dir = temp_test_dir("http-normal");
        let path = dir.join("engine.zip");
        let hash = sha256_bytes(body);
        download_resumable_asset(
            None,
            &test_client(),
            &path,
            &AtomicBool::new(false),
            EngineAssetDownload {
                kind: "cpu",
                url: &url,
                expected_size: body.len() as u64,
                expected_sha256: Some(&hash),
                package_size: body.len() as u64,
                message: "test",
            },
            1,
            1,
            0,
        )
        .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), body);
        server.join().unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn controlled_http_range_resumes_partial_file() {
        let full = b"hello world";
        let (url, server) = serve_once("206 Partial Content", b" world", Some("Range: bytes=5-"));
        let dir = temp_test_dir("http-range");
        let path = dir.join("engine.zip");
        std::fs::write(&path, b"hello").unwrap();
        let hash = sha256_bytes(full);
        download_resumable_asset(
            None,
            &test_client(),
            &path,
            &AtomicBool::new(false),
            EngineAssetDownload {
                kind: "cpu",
                url: &url,
                expected_size: full.len() as u64,
                expected_sha256: Some(&hash),
                package_size: full.len() as u64,
                message: "test",
            },
            1,
            1,
            0,
        )
        .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), full);
        server.join().unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn server_without_range_restarts_file_instead_of_appending() {
        let full = b"fresh complete archive";
        let (url, server) = serve_once("200 OK", full, Some("Range: bytes=5-"));
        let dir = temp_test_dir("http-no-range");
        let path = dir.join("engine.zip");
        std::fs::write(&path, b"stale").unwrap();
        let hash = sha256_bytes(full);
        download_resumable_asset(
            None,
            &test_client(),
            &path,
            &AtomicBool::new(false),
            EngineAssetDownload {
                kind: "cpu",
                url: &url,
                expected_size: full.len() as u64,
                expected_sha256: Some(&hash),
                package_size: full.len() as u64,
                message: "test",
            },
            1,
            1,
            0,
        )
        .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), full);
        server.join().unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn cancelled_download_does_not_discard_partial_data() {
        let dir = temp_test_dir("http-cancel");
        let path = dir.join("engine.zip");
        std::fs::write(&path, b"valid partial bytes").unwrap();
        let cancelled = AtomicBool::new(true);
        let result = download_resumable_asset(
            None,
            &test_client(),
            &path,
            &cancelled,
            EngineAssetDownload {
                kind: "cpu",
                url: "http://127.0.0.1:1/unused",
                expected_size: 100,
                expected_sha256: Some(&"0".repeat(64)),
                package_size: 100,
                message: "test",
            },
            1,
            1,
            0,
        );
        assert!(result.unwrap_err().contains("cancelled"));
        assert_eq!(std::fs::read(&path).unwrap(), b"valid partial bytes");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn zip_extraction_rejects_declared_size_mismatch_and_honors_cancel() {
        let dir = temp_test_dir("zip");
        let archive_path = dir.join("engine.zip");
        let file = File::create(&archive_path).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        archive
            .start_file(
                "ai-notetaking-engine.exe",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
        archive.write_all(b"binary").unwrap();
        archive.finish().unwrap();

        let cancelled = AtomicBool::new(false);
        assert!(extract_zip(&archive_path, &dir.join("ok"), 6, &cancelled).is_ok());
        assert!(extract_zip(&archive_path, &dir.join("bad-size"), 7, &cancelled).is_err());
        cancelled.store(true, AtomicOrdering::SeqCst);
        assert!(
            extract_zip(&archive_path, &dir.join("cancelled"), 6, &cancelled)
                .unwrap_err()
                .contains("cancelled")
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[tauri::command]
fn check_ollama() -> Result<OllamaStatus, String> {
    let winget_available = Command::new("winget")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);

    let installed = winget_available
        && Command::new("winget")
            .args(["list", "--id", "Ollama.Ollama", "-e"])
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false);

    let response = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?
        .get("http://localhost:11434/api/tags")
        .send();

    match response {
        Ok(resp) if resp.status().is_success() => {
            let json = resp
                .json::<serde_json::Value>()
                .map_err(|e| e.to_string())?;
            let models = json
                .get("models")
                .and_then(|v| v.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.get("name").and_then(|name| name.as_str()))
                        .map(|name| name.to_string())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let active_models = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(2))
                .build()
                .ok()
                .and_then(|client| client.get("http://localhost:11434/api/ps").send().ok())
                .and_then(|response| response.json::<serde_json::Value>().ok())
                .and_then(|value| {
                    value
                        .get("models")
                        .and_then(|items| items.as_array())
                        .cloned()
                })
                .map(|items| {
                    items
                        .into_iter()
                        .filter_map(|item| {
                            item.get("name")
                                .and_then(|name| name.as_str())
                                .map(str::to_string)
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Ok(OllamaStatus {
                installed: true,
                running: true,
                models,
                state: if active_models.is_empty() {
                    "ready"
                } else {
                    "loading_model"
                }
                .to_string(),
                message: if active_models.is_empty() {
                    "Ollama is ready."
                } else {
                    "Ollama has an active model."
                }
                .to_string(),
                active_models,
            })
        }
        _ => Ok(OllamaStatus {
            installed,
            running: false,
            models: Vec::new(),
            active_models: Vec::new(),
            state: "offline".to_string(),
            message: if !winget_available {
                "Windows Package Manager (winget) is not available. Install Ollama manually from ollama.com/download, then open Ollama and re-check.".to_string()
            } else if installed {
                "Ollama is installed but the local service is not running. Open the Ollama app, then re-check.".to_string()
            } else {
                "Ollama is not installed. You can install it automatically with winget.".to_string()
            },
        }),
    }
}

#[tauri::command]
fn install_ollama_winget(app: AppHandle) -> Result<(), String> {
    let winget_available = Command::new("winget")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    if !winget_available {
        return Err("winget is not available on this Windows installation.".to_string());
    }

    app.emit(
        "ollama-install-progress",
        serde_json::json!({
            "stage": "starting",
            "message": "Starting Ollama installer with winget"
        }),
    )
    .ok();

    let status = Command::new("winget")
        .args([
            "install",
            "--id",
            "Ollama.Ollama",
            "-e",
            "--accept-package-agreements",
            "--accept-source-agreements",
        ])
        .status()
        .map_err(|e| format!("Failed to start winget: {}", e))?;

    if status.success() {
        app.emit(
            "ollama-install-progress",
            serde_json::json!({
                "stage": "completed",
                "message": "Ollama installation completed"
            }),
        )
        .ok();
        Ok(())
    } else {
        Err(format!("winget exited with status {}", status))
    }
}

#[tauri::command]
fn pull_ollama_model(app: AppHandle, model: String) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(None)
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .post("http://localhost:11434/api/pull")
        .json(&serde_json::json!({ "name": model }))
        .send()
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Ollama pull failed with HTTP {}",
            response.status()
        ));
    }

    let mut buffer = [0_u8; 1024 * 16];
    let mut pending = String::new();
    loop {
        let read = response.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        pending.push_str(&String::from_utf8_lossy(&buffer[..read]));
        while let Some(pos) = pending.find('\n') {
            let line = pending[..pos].trim().to_string();
            pending = pending[pos + 1..].to_string();
            if line.is_empty() {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                app.emit("ollama-pull-progress", value).ok();
            }
        }
    }

    if !pending.trim().is_empty() {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(pending.trim()) {
            app.emit("ollama-pull-progress", value).ok();
        }
    }

    Ok(())
}

// ── 3. Database commands ──────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn save_meeting(
    state: State<'_, AppState>,
    date: String,
    title: String,
    raw_transcript: String,
    markdown_summary: String,
    speakers: Option<String>,
    tags: Option<String>,
    structured_summary: Option<String>,
    transcript_segments: Option<String>,
    schema_version: Option<i32>,
) -> Result<i64, String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO meetings
         (date, title, raw_transcript, markdown_summary, speakers, tags, structured_summary,
          transcript_segments, schema_version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            &date,
            &title,
            &raw_transcript,
            &markdown_summary,
            &speakers,
            &tags,
            &structured_summary,
            &transcript_segments,
            schema_version.unwrap_or(1),
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    Ok(id)
}

#[tauri::command]
fn get_meetings(state: State<'_, AppState>) -> Result<Vec<Meeting>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, date, title, raw_transcript, markdown_summary,
                speakers, tags, structured_summary, transcript_segments, schema_version
         FROM meetings ORDER BY id DESC",
        )
        .map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            Ok(Meeting {
                id: Some(row.get(0)?),
                date: row.get(1)?,
                title: row.get(2)?,
                raw_transcript: row.get(3)?,
                markdown_summary: row.get(4)?,
                speakers: row.get(5)?,
                tags: row.get(6)?,
                structured_summary: row.get(7)?,
                transcript_segments: row.get(8)?,
                schema_version: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut meetings = Vec::new();
    for m in iter {
        meetings.push(m.map_err(|e| e.to_string())?)
    }
    Ok(meetings)
}

// FTS5 full-text search — appends * for prefix matching so partial words work.
// Falls back to get_meetings() when the query is empty.
#[tauri::command]
fn search_meetings(state: State<'_, AppState>, query: String) -> Result<Vec<Meeting>, String> {
    if query.trim().is_empty() {
        return get_meetings(state);
    }

    let db = state.db.lock().unwrap();
    let fts_query = format!("{}*", query.trim().replace('"', ""));

    let mut stmt = db
        .prepare(
            "SELECT m.id, m.date, m.title, m.raw_transcript, m.markdown_summary,
                m.speakers, m.tags, m.structured_summary,
                m.transcript_segments, m.schema_version
         FROM meetings m
         JOIN meetings_fts fts ON fts.rowid = m.id
         WHERE meetings_fts MATCH ?1
         ORDER BY m.id DESC",
        )
        .map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map(rusqlite::params![fts_query], |row| {
            Ok(Meeting {
                id: Some(row.get(0)?),
                date: row.get(1)?,
                title: row.get(2)?,
                raw_transcript: row.get(3)?,
                markdown_summary: row.get(4)?,
                speakers: row.get(5)?,
                tags: row.get(6)?,
                structured_summary: row.get(7)?,
                transcript_segments: row.get(8)?,
                schema_version: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut meetings = Vec::new();
    for m in iter {
        meetings.push(m.map_err(|e| e.to_string())?)
    }
    Ok(meetings)
}

// ── 4. IPC bridge — forwards commands to the Python engine ────

#[tauri::command]
fn send_command_to_python(state: State<'_, AppState>, payload: String) -> Result<(), String> {
    let log_payload = serde_json::from_str::<serde_json::Value>(&payload)
        .map(|mut value| {
            redact_secret_field(&mut value, "api_key");
            redact_secret_field(&mut value, "hf_token");
            value.to_string()
        })
        .unwrap_or_else(|_| "<non-json payload>".to_string());
    println!("[RUST DEBUG] Sending to Python: {}", log_payload);
    let lock = state.python_stdin.lock().unwrap();
    if let Some(mut stdin) = lock.as_ref() {
        writeln!(stdin, "{}", payload).map_err(|e| e.to_string())?;
        return Ok(());
    }
    Err("Python process not initialized or stdin unavailable".to_string())
}

fn redact_secret_field(value: &mut serde_json::Value, key: &str) {
    if let Some(secret) = value.get_mut(key) {
        if secret.as_str().map(|s| !s.is_empty()).unwrap_or(false) {
            *secret = serde_json::Value::String("<redacted>".to_string());
        }
    }
}

// ── 5. Window mode commands ───────────────────────────────────

#[tauri::command]
async fn set_compact_mode(window: Window) -> Result<(), String> {
    window
        .set_size(LogicalSize::new(400.0, 120.0))
        .map_err(|e| e.to_string())?;
    window.set_decorations(false).map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window.set_resizable(false).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn set_expanded_mode(window: Window) -> Result<(), String> {
    window
        .set_size(LogicalSize::new(1024.0, 720.0))
        .map_err(|e| e.to_string())?;
    window.set_decorations(false).map_err(|e| e.to_string())?;
    window.set_always_on_top(false).map_err(|e| e.to_string())?;
    window.set_resizable(true).map_err(|e| e.to_string())?;
    window.center().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn set_wizard_mode(window: Window) -> Result<(), String> {
    window
        .set_size(LogicalSize::new(720.0, 540.0))
        .map_err(|e| e.to_string())?;
    window.set_decorations(false).map_err(|e| e.to_string())?;
    window.set_always_on_top(false).map_err(|e| e.to_string())?;
    window.set_resizable(false).map_err(|e| e.to_string())?;
    window.center().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn set_bootstrap_mode(window: Window) -> Result<(), String> {
    window
        .set_size(LogicalSize::new(720.0, 540.0))
        .map_err(|e| e.to_string())?;
    window.set_decorations(false).map_err(|e| e.to_string())?;
    window.set_always_on_top(false).map_err(|e| e.to_string())?;
    window.set_resizable(false).map_err(|e| e.to_string())?;
    window.center().map_err(|e| e.to_string())?;
    Ok(())
}

// ── 6. Audio device enumeration ───────────────────────────────
// Sends LIST_DEVICES to Python; the response arrives as a python-event
// on the frontend via the stdout reader thread.

#[tauri::command]
fn request_audio_devices(state: State<'_, AppState>) -> Result<(), String> {
    let lock = state.python_stdin.lock().unwrap();
    if let Some(mut stdin) = lock.as_ref() {
        let payload = serde_json::json!({"action": "LIST_DEVICES"});
        writeln!(stdin, "{}", payload).map_err(|e| e.to_string())?;
        return Ok(());
    }
    Err("Python process not available".to_string())
}

#[tauri::command]
fn reprocess_meeting(
    state: State<'_, AppState>,
    meeting_id: i32,
    system_prompt: String,
    provider: String,
    model: String,
    api_key: String,
) -> Result<(), String> {
    println!(
        "[RUST DEBUG] Reprocess requested for meeting {}",
        meeting_id
    );

    // Fetch raw_transcript, structured_summary and transcript_segments from the DB
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT raw_transcript, structured_summary, transcript_segments FROM meetings WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let (raw_transcript, structured_summary, transcript_segments): (
        String,
        Option<String>,
        Option<String>,
    ) = stmt
        .query_row(rusqlite::params![meeting_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|e| e.to_string())?;

    // Detected transcription language, persisted inside structured_summary.metadata.
    // Re-sending it keeps reprocessed output in the meeting's original language.
    let language = structured_summary
        .as_deref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|v| {
            v.get("metadata")
                .and_then(|m| m.get("language"))
                .and_then(|l| l.as_str())
                .map(|l| l.to_string())
        })
        .filter(|l| !l.is_empty());

    // Persisted segments carry speakers/timestamps; without them the Python side
    // rebuilds bare segments and chapters/participation come back degraded.
    let segments_value = transcript_segments
        .as_deref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .filter(|v| v.is_array());

    // Dispatch to Python stdin
    let lock = state.python_stdin.lock().unwrap();
    if let Some(mut stdin) = lock.as_ref() {
        let payload = serde_json::json!({
            "action": "REPROCESS_REQUESTED",
            "meeting_id": meeting_id,
            "raw_transcript": raw_transcript,
            "system_prompt": system_prompt,
            "provider": provider,
            "model": model,
            "api_key": api_key,
            "structured_summary": structured_summary,
            "language": language,
            "transcript_segments": segments_value,
        });
        writeln!(stdin, "{}", payload).map_err(|e| e.to_string())?;
        return Ok(());
    }
    Err("Python process not initialized or stdin unavailable".to_string())
}

#[derive(serde::Serialize)]
struct BackfillMeeting {
    id: i32,
    title: String,
    date: String,
    raw_transcript: String,
}

#[tauri::command]
fn trigger_index_backfill(
    state: State<'_, AppState>,
    provider: String,
    model: String,
) -> Result<(), String> {
    println!(
        "[RUST DEBUG] Index backfill requested for RAG using {} ({})",
        provider, model
    );

    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT id, title, date, raw_transcript FROM meetings")
        .map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            Ok(BackfillMeeting {
                id: row.get(0)?,
                title: row.get(1)?,
                date: row.get(2)?,
                raw_transcript: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut meetings = Vec::new();
    for m in iter {
        meetings.push(m.map_err(|e| e.to_string())?);
    }

    let lock = state.python_stdin.lock().unwrap();
    if let Some(mut stdin) = lock.as_ref() {
        let payload = serde_json::json!({
            "action": "BACKFILL_INDEX_REQUESTED",
            "meetings": meetings,
            "embedding_provider": provider,
            "embedding_model": model,
        });
        writeln!(stdin, "{}", payload).map_err(|e| e.to_string())?;
        return Ok(());
    }
    Err("Python process not initialized or stdin unavailable".to_string())
}

#[tauri::command]
fn set_secret(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new("com.opensource.ainotetaker", &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_secret(key: String) -> Result<Option<String>, String> {
    let entry = Entry::new("com.opensource.ainotetaker", &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pass) => Ok(Some(pass)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn delete_secret(key: String) -> Result<(), String> {
    let entry = Entry::new("com.opensource.ainotetaker", &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let logs_dir = app_data_dir.join("logs");
    let _ = std::fs::create_dir_all(&logs_dir);

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(logs_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(logs_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(logs_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_runtime_diagnostics(state: State<'_, AppState>) -> Result<RuntimeDiagnostics, String> {
    let status = state
        .runtime_status
        .lock()
        .map_err(|_| "Runtime status is unavailable.")?
        .clone();
    let events = state
        .diagnostics
        .lock()
        .map_err(|_| "Diagnostics are unavailable.")?
        .clone();
    Ok(RuntimeDiagnostics { status, events })
}

// ── 7. Settings popover window ────────────────────────────────
// The popover is a separate frameless OS window (label: "popover"),
// positioned above the compact widget by Rust. Toggled on each call.

#[tauri::command]
async fn open_popover_window(app: AppHandle, window: Window) -> Result<(), String> {
    // Toggle: close if already open
    if let Some(existing) = app.get_webview_window("popover") {
        existing.close().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let popover_w = 380.0_f64;
    let popover_h = 620.0_f64;
    let gap = 8.0_f64;

    let scale_factor = window.scale_factor().map_err(|e| e.to_string())?;

    // Convert physical widget position & size to logical coordinates
    let widget_x_logical = pos.x as f64 / scale_factor;
    let widget_y_logical = pos.y as f64 / scale_factor;
    let widget_w_logical = size.width as f64 / scale_factor;
    let widget_h_logical = size.height as f64 / scale_factor;

    // Calculate logical x and y for popover
    let mut x_logical = widget_x_logical + widget_w_logical - popover_w - gap;
    let mut y_logical = if widget_y_logical >= popover_h + gap {
        widget_y_logical - popover_h - gap
    } else {
        widget_y_logical + widget_h_logical + gap
    };

    // Constrain to monitor boundaries in logical coordinates to prevent screen cutoff
    if let Some(monitor) = window.current_monitor().map_err(|e| e.to_string())? {
        let m_pos = monitor.position();
        let m_size = monitor.size();

        let m_pos_x_logical = m_pos.x as f64 / scale_factor;
        let m_pos_y_logical = m_pos.y as f64 / scale_factor;
        let m_size_w_logical = m_size.width as f64 / scale_factor;
        let m_size_h_logical = m_size.height as f64 / scale_factor;

        let min_x = m_pos_x_logical;
        let max_x = m_pos_x_logical + m_size_w_logical - popover_w;
        let min_y = m_pos_y_logical;
        let max_y = m_pos_y_logical + m_size_h_logical - popover_h;

        x_logical = x_logical.clamp(min_x, max_x);
        y_logical = y_logical.clamp(min_y, max_y);
    }

    WebviewWindowBuilder::new(
        &app,
        "popover",
        WebviewUrl::App(PathBuf::from("index.html")),
    )
    .title("")
    .decorations(false)
    .always_on_top(true)
    .resizable(false)
    .inner_size(popover_w, popover_h)
    .position(x_logical, y_logical)
    .skip_taskbar(true)
    .shadow(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn close_popover_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("popover") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn migrate_settings_to_keychain(app: &tauri::App) {
    if let Ok(config_dir) = app.path().app_config_dir() {
        let settings_path = config_dir.join("settings.json");
        if settings_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&settings_path) {
                if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                    let mut modified = false;

                    let provider = json
                        .get("provider")
                        .and_then(|v| v.as_str())
                        .unwrap_or("openai");
                    let provider_key = format!("{}_api_key", provider.to_lowercase());

                    // Keys to migrate: (json_key, keychain_key)
                    let keys_to_migrate = [
                        ("apiKey", provider_key.clone()),
                        ("notionToken", "notion_token".to_string()),
                        ("hf_token", "hf_token".to_string()),
                    ];

                    for (json_key, keychain_key) in keys_to_migrate.iter() {
                        if let Some(val_str) = json.get(*json_key).and_then(|v| v.as_str()) {
                            if !val_str.is_empty() {
                                // Save to keychain
                                if let Ok(entry) =
                                    Entry::new("com.opensource.ainotetaker", keychain_key)
                                {
                                    if let Err(e) = entry.set_password(val_str) {
                                        eprintln!("[Keychain Migration Error] Failed to set password for {}: {}", keychain_key, e);
                                    } else {
                                        println!("[Keychain Migration] Successfully migrated {} to OS keychain", keychain_key);
                                    }
                                }
                                // Clear from JSON
                                json[*json_key] = serde_json::json!("");
                                modified = true;
                            }
                        }
                    }

                    if modified {
                        if let Ok(updated_content) = serde_json::to_string_pretty(&json) {
                            if let Err(e) = std::fs::write(&settings_path, updated_content) {
                                eprintln!(
                                    "[Keychain Migration Error] Failed to write settings.json: {}",
                                    e
                                );
                            } else {
                                println!("[Keychain Migration] Atomically updated settings.json and cleared plaintext keys.");
                            }
                        }
                    }
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_and_supervise_python(
    app_handle: AppHandle,
    db: Arc<Mutex<Connection>>,
    python_stdin: Arc<Mutex<Option<ChildStdin>>>,
    python_child: Arc<Mutex<Option<Child>>>,
    requested_engine_path: Option<PathBuf>,
    supervisor_gen: Arc<AtomicU64>,
    diagnostics: Arc<Mutex<Vec<DiagnosticEvent>>>,
    runtime_status: Arc<Mutex<serde_json::Value>>,
    my_gen: u64,
) {
    std::thread::spawn(move || {
        let mut restart_attempts = 0;
        let max_attempts = 3;

        loop {
            // A newer supervisor claimed the sidecar (start_sidecar/reconnect):
            // this loop must stop instead of respawning and stealing stdin back.
            if supervisor_gen.load(AtomicOrdering::SeqCst) != my_gen {
                println!(
                    "[Supervisor] Generation {} superseded; supervisor exiting.",
                    my_gen
                );
                break;
            }

            println!(
                "[Supervisor] Spawning Python sidecar (Attempt {})...",
                restart_attempts + 1
            );
            if restart_attempts > 0 {
                app_handle
                    .emit(
                        "python-event",
                        serde_json::json!({
                            "event": "SIDECAR_RESTARTING",
                            "data": { "attempt": restart_attempts }
                        })
                        .to_string(),
                    )
                    .ok();
            }

            let project_dir = app_handle.path().resource_dir().unwrap_or_default();
            let app_data_dir = app_handle
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let repo_root = manifest_dir
                .parent()
                .map(PathBuf::from)
                .unwrap_or_else(|| manifest_dir.clone());
            let dev_python_script = repo_root.join("src-python").join("main.py");
            let dev_python = repo_root
                .join("src-python")
                .join(".venv")
                .join("Scripts")
                .join("python.exe");
            let is_dev = cfg!(debug_assertions) && dev_python_script.exists();

            let mut sidecar_path = requested_engine_path.clone();
            let search_dirs = [
                project_dir.clone(),
                project_dir.join("binaries"),
                std::env::current_exe()
                    .ok()
                    .and_then(|path| path.parent().map(PathBuf::from))
                    .unwrap_or_default(),
            ];
            if sidecar_path.is_none() {
                for binaries_dir in search_dirs {
                    if let Ok(entries) = std::fs::read_dir(binaries_dir) {
                        for entry in entries.flatten() {
                            let path = entry.path();
                            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                                let is_engine = file_name.starts_with("ai-notetaking-engine")
                                    && !file_name.ends_with(".pdb");
                                let is_nonempty = path
                                    .metadata()
                                    .map(|metadata| metadata.len() > 0)
                                    .unwrap_or(false);
                                if is_engine && is_nonempty {
                                    sidecar_path = Some(path);
                                    break;
                                }
                            }
                        }
                    }
                    if sidecar_path.is_some() {
                        break;
                    }
                }
            }

            let child_res = if is_dev {
                if cfg!(target_os = "windows") {
                    Command::new(&dev_python)
                        .arg(&dev_python_script)
                        .env("AI_NOTETAKING_DATA_DIR", &app_data_dir)
                        .stdin(Stdio::piped())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .spawn()
                } else {
                    Command::new("bash")
                        .current_dir("../")
                        .arg("src-python/run.sh")
                        .env("AI_NOTETAKING_DATA_DIR", &app_data_dir)
                        .stdin(Stdio::piped())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .spawn()
                }
            } else if let Some(path) = sidecar_path {
                println!("[Supervisor] Spawning production sidecar: {:?}", path);
                let audio_tap_name = if cfg!(target_arch = "aarch64") {
                    "audio-tap-aarch64-apple-darwin"
                } else {
                    "audio-tap-x86_64-apple-darwin"
                };
                let audio_tap = std::env::current_exe()
                    .ok()
                    .and_then(|executable| {
                        executable
                            .parent()
                            .map(|directory| directory.join(audio_tap_name))
                    })
                    .filter(|candidate| candidate.is_file())
                    .unwrap_or_else(|| project_dir.join(audio_tap_name));
                match validate_sidecar_architecture(&path).and_then(|_| make_executable(&path)) {
                    Ok(()) => Command::new(path)
                        .env("AI_NOTETAKING_DATA_DIR", &app_data_dir)
                        .env("AI_NOTETAKING_REQUIRE_BUNDLED_MODEL", "1")
                        .env("AI_NOTETAKING_AUDIO_TAP_PATH", audio_tap)
                        .stdin(Stdio::piped())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .spawn(),
                    Err(error) => Err(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
                }
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "Sidecar binary not found in production build",
                ))
            };

            let mut failure_cause = "spawn_failed".to_string();
            let mut failure_exit_code = None;
            match child_res {
                Ok(mut child) => {
                    // Re-check before touching shared state: if another
                    // supervisor took over while we were spawning, discard
                    // this child instead of overwriting its stdin.
                    if supervisor_gen.load(AtomicOrdering::SeqCst) != my_gen {
                        println!(
                            "[Supervisor] Generation {} superseded during spawn; killing extra child.",
                            my_gen
                        );
                        let _ = child.kill();
                        break;
                    }

                    let stdin = child.stdin.take().expect("Failed to open Python stdin");
                    let stdout = child.stdout.take().expect("Failed to open Python stdout");
                    let stderr = child.stderr.take();
                    let healthy = Arc::new(AtomicBool::new(false));
                    let model_settled = Arc::new(AtomicBool::new(false));
                    let started_at = Instant::now();

                    // Update global AppState
                    {
                        let mut stdin_lock = python_stdin.lock().unwrap();
                        *stdin_lock = Some(stdin);
                    }
                    {
                        let mut child_lock = python_child.lock().unwrap();
                        *child_lock = Some(child);
                    }

                    if let Ok(mut status) = runtime_status.lock() {
                        status["sidecar"] = serde_json::json!("starting");
                        status["operationStartedAt"] =
                            serde_json::json!(chrono::Utc::now().to_rfc3339());
                    }

                    if let Some(stderr) = stderr {
                        let diagnostics_for_stderr = Arc::clone(&diagnostics);
                        std::thread::spawn(move || {
                            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                                let message = sanitized_diagnostic_message(&line);
                                tracing::warn!(target: "sidecar", "{}", message);
                                push_diagnostic(
                                    &diagnostics_for_stderr,
                                    DiagnosticEvent {
                                        timestamp: chrono::Utc::now().to_rfc3339(),
                                        source: "sidecar".to_string(),
                                        level: "warning".to_string(),
                                        code: "SIDECAR_STDERR".to_string(),
                                        message,
                                        attempt: None,
                                        exit_code: None,
                                    },
                                );
                            }
                        });
                    }

                    // Start the stdout reader thread for this child
                    let app_handle_clone = app_handle.clone();
                    let db_clone = Arc::clone(&db);
                    let python_child_clone = Arc::clone(&python_child);
                    let healthy_for_reader = Arc::clone(&healthy);
                    let model_settled_for_reader = Arc::clone(&model_settled);
                    let runtime_for_reader = Arc::clone(&runtime_status);
                    let diagnostics_for_reader = Arc::clone(&diagnostics);
                    std::thread::spawn(move || {
                        let reader = BufReader::new(stdout);
                        for content in reader.lines().map_while(Result::ok) {
                            // Parse JSON to check for DB-persisted events
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                                let event_name = json["event"].as_str().unwrap_or("");
                                if event_name != "VAD_TELEMETRY" {
                                    tracing::info!(target: "sidecar", event = event_name, "sidecar event");
                                }
                                if event_name == "ENGINE_STATE" || event_name == "AI_RUNTIME_STATUS"
                                {
                                    if let Some(data) = json.get("data") {
                                        if let Ok(mut status) = runtime_for_reader.lock() {
                                            status["sidecar"] = serde_json::json!("running");
                                            status["engine"] = data.clone();
                                            if event_name == "AI_RUNTIME_STATUS" {
                                                status["provider"] = data
                                                    .get("provider")
                                                    .cloned()
                                                    .unwrap_or(serde_json::Value::Null);
                                                status["model"] = data
                                                    .get("model")
                                                    .cloned()
                                                    .unwrap_or(serde_json::Value::Null);
                                                status["elapsedMs"] = data
                                                    .get("elapsed_ms")
                                                    .cloned()
                                                    .unwrap_or(serde_json::json!(0));
                                                if data
                                                    .get("provider")
                                                    .and_then(|value| value.as_str())
                                                    == Some("ollama")
                                                {
                                                    status["ollama"] = data
                                                        .get("state")
                                                        .cloned()
                                                        .unwrap_or(serde_json::json!("offline"));
                                                }
                                            }
                                            if let Some(phase) =
                                                data.get("phase").and_then(|value| value.as_str())
                                            {
                                                status["audio"] = serde_json::json!(if phase
                                                    == "audio_ready"
                                                    || phase == "model_loading"
                                                    || phase == "transcription_ready"
                                                {
                                                    "ready"
                                                } else if phase == "failed" {
                                                    "failed"
                                                } else {
                                                    "pending"
                                                });
                                                status["whisper"] = serde_json::json!(if phase
                                                    == "transcription_ready"
                                                {
                                                    "ready"
                                                } else if phase == "degraded" || phase == "failed" {
                                                    "failed"
                                                } else {
                                                    "loading"
                                                });
                                                if phase == "audio_ready"
                                                    && !healthy_for_reader
                                                        .swap(true, AtomicOrdering::SeqCst)
                                                {
                                                    app_handle_clone.emit("python-event", serde_json::json!({"event":"SIDECAR_UP","data":{"readiness":"audio_ready"}}).to_string()).ok();
                                                }
                                                if phase == "transcription_ready"
                                                    || phase == "degraded"
                                                    || phase == "failed"
                                                {
                                                    model_settled_for_reader
                                                        .store(true, AtomicOrdering::SeqCst);
                                                }
                                            }
                                        }
                                    }
                                }
                                if event_name == "DIAGNOSTIC_EVENT" {
                                    let data = json
                                        .get("data")
                                        .cloned()
                                        .unwrap_or_else(|| serde_json::json!({}));
                                    push_diagnostic(
                                        &diagnostics_for_reader,
                                        DiagnosticEvent {
                                            timestamp: chrono::Utc::now().to_rfc3339(),
                                            source: "python".to_string(),
                                            level: data
                                                .get("level")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("info")
                                                .to_string(),
                                            code: data
                                                .get("code")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("RUNTIME_EVENT")
                                                .to_string(),
                                            message: sanitized_diagnostic_message(
                                                data.get("message")
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or("Runtime state changed."),
                                            ),
                                            attempt: data
                                                .get("attempt")
                                                .and_then(|v| v.as_u64())
                                                .map(|v| v as u32),
                                            exit_code: None,
                                        },
                                    );
                                }

                                // Save newly generated meeting notes directly to DB
                                // (bypasses fragile frontend roundtrip that can lose data
                                //  if the app closes or Python restarts before the React
                                //  handler fires)
                                if event_name == "NOTES_GENERATED" {
                                    if let Some(data) = json["data"].as_object() {
                                        let raw_transcript = data
                                            .get("raw_transcript")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("");
                                        let markdown = data
                                            .get("markdown")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("");
                                        let structured =
                                            data.get("structured").map(|v| v.to_string());
                                        let transcript_segments =
                                            data.get("transcript_segments").map(|v| v.to_string());
                                        let schema_version = data
                                            .get("schema_version")
                                            .and_then(|v| v.as_i64())
                                            .unwrap_or(1);

                                        if !raw_transcript.is_empty() {
                                            let now = chrono::Local::now();
                                            let date_str =
                                                now.format("%Y-%m-%d %H:%M:%S").to_string();
                                            let title_str =
                                                format!("Meeting {}", now.format("%d/%m/%Y"));

                                            // Extract speakers and tags from structured summary
                                            let speakers = data
                                                .get("structured")
                                                .and_then(|s| s.get("participants"))
                                                .map(|v| v.to_string());
                                            let tags = data
                                                .get("structured")
                                                .and_then(|s| s.get("metadata"))
                                                .and_then(|m| m.get("tags"))
                                                .map(|v| v.to_string());

                                            let db_lock = db_clone.lock().unwrap();
                                            match db_lock.execute(
                                                "INSERT INTO meetings (
                                                    date, title, raw_transcript, markdown_summary,
                                                    speakers, tags, structured_summary,
                                                    transcript_segments, schema_version
                                                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                                                rusqlite::params![
                                                    date_str,
                                                    title_str,
                                                    raw_transcript,
                                                    markdown,
                                                    speakers,
                                                    tags,
                                                    structured,
                                                    transcript_segments,
                                                    schema_version,
                                                ],
                                            ) {
                                                Ok(_) => {
                                                    let meeting_id = db_lock.last_insert_rowid();
                                                    println!("[RUST SUCCESS] Auto-saved meeting {} to DB from NOTES_GENERATED", meeting_id);
                                                    // Inject the meeting_id into the event so frontend can skip its own save
                                                    let mut enriched = json.clone();
                                                    enriched["data"]["saved_meeting_id"] =
                                                        serde_json::json!(meeting_id);
                                                    let enriched_str = enriched.to_string();
                                                    app_handle_clone
                                                        .emit("python-event", enriched_str)
                                                        .ok();
                                                    continue; // skip the default emit below
                                                }
                                                Err(e) => {
                                                    eprintln!("[RUST ERROR] Failed to auto-save meeting from NOTES_GENERATED: {}", e);
                                                }
                                            }
                                        }
                                    }
                                }

                                // Persist on-demand follow-up email drafts into the meeting's
                                // structured_summary (read-modify-write so the rest of the
                                // summary is untouched). No `continue`: the event must still
                                // reach the frontend below so the UI can react.
                                if event_name == "FOLLOWUP_GENERATED" {
                                    if let Some(data) = json["data"].as_object() {
                                        let meeting_id =
                                            data.get("meeting_id").and_then(|v| v.as_i64());
                                        let email_draft = data.get("email_draft").cloned();

                                        if let (Some(id), Some(draft)) = (meeting_id, email_draft) {
                                            let db_lock = db_clone.lock().unwrap();
                                            let existing: Result<Option<String>, _> = db_lock
                                                .query_row(
                                                    "SELECT structured_summary FROM meetings WHERE id = ?1",
                                                    rusqlite::params![id],
                                                    |row| row.get(0),
                                                );
                                            match existing {
                                                Ok(existing) => {
                                                    let mut structured = parse_structured_summary(
                                                        existing.as_deref(),
                                                    );
                                                    structured["email_draft"] = draft;
                                                    if let Err(e) = db_lock.execute(
                                                        "UPDATE meetings SET structured_summary = ?1 WHERE id = ?2",
                                                        rusqlite::params![structured.to_string(), id],
                                                    ) {
                                                        eprintln!("[RUST ERROR] Failed to persist follow-up email: {}", e);
                                                    } else {
                                                        println!("[RUST SUCCESS] Follow-up email persisted for meeting {}", id);
                                                    }
                                                }
                                                Err(e) => {
                                                    eprintln!("[RUST ERROR] Failed to load meeting {} for follow-up persist: {}", id, e);
                                                }
                                            }
                                        } else {
                                            println!("[RUST DEBUG] FOLLOWUP_GENERATED without meeting_id; skipping persistence");
                                        }
                                    }
                                }

                                // Persist on-demand continuity reports the same way as
                                // follow-up drafts. No `continue`: the frontend must
                                // still receive the event.
                                if event_name == "CONTINUITY_GENERATED" {
                                    if let Some(data) = json["data"].as_object() {
                                        let meeting_id =
                                            data.get("meeting_id").and_then(|v| v.as_i64());
                                        let continuity = data.get("continuity").cloned();

                                        if let (Some(id), Some(report)) = (meeting_id, continuity) {
                                            let db_lock = db_clone.lock().unwrap();
                                            let existing: Result<Option<String>, _> = db_lock
                                                .query_row(
                                                    "SELECT structured_summary FROM meetings WHERE id = ?1",
                                                    rusqlite::params![id],
                                                    |row| row.get(0),
                                                );
                                            match existing {
                                                Ok(existing) => {
                                                    let mut structured = parse_structured_summary(
                                                        existing.as_deref(),
                                                    );
                                                    structured["continuity"] = report;
                                                    if let Err(e) = db_lock.execute(
                                                        "UPDATE meetings SET structured_summary = ?1 WHERE id = ?2",
                                                        rusqlite::params![structured.to_string(), id],
                                                    ) {
                                                        eprintln!("[RUST ERROR] Failed to persist continuity report: {}", e);
                                                    } else {
                                                        println!("[RUST SUCCESS] Continuity report persisted for meeting {}", id);
                                                    }
                                                }
                                                Err(e) => {
                                                    eprintln!("[RUST ERROR] Failed to load meeting {} for continuity persist: {}", id, e);
                                                }
                                            }
                                        } else {
                                            println!("[RUST DEBUG] CONTINUITY_GENERATED without meeting_id; skipping persistence");
                                        }
                                    }
                                }

                                if event_name == "REPROCESS_COMPLETED" {
                                    if let Some(data) = json["data"].as_object() {
                                        let meeting_id =
                                            data.get("meeting_id").and_then(|v| v.as_i64());
                                        let markdown =
                                            data.get("markdown").and_then(|v| v.as_str());
                                        let structured =
                                            data.get("structured").map(|v| v.to_string());

                                        if let (Some(id), Some(md)) = (meeting_id, markdown) {
                                            let db_lock = db_clone.lock().unwrap();
                                            if let Err(e) = db_lock.execute(
                                                "UPDATE meetings SET markdown_summary = ?1, structured_summary = ?2 WHERE id = ?3",
                                                rusqlite::params![md, structured, id],
                                            ) {
                                                eprintln!("[RUST ERROR] Failed to update reprocessed meeting: {}", e);
                                            } else {
                                                println!("[RUST SUCCESS] Reprocessed meeting {} updated in DB", id);
                                            }
                                        }
                                    }
                                }
                            }

                            app_handle_clone.emit("python-event", content).ok();
                        }
                    });

                    let app_for_model_watchdog = app_handle.clone();
                    let runtime_for_model_watchdog = Arc::clone(&runtime_status);
                    let diagnostics_for_model_watchdog = Arc::clone(&diagnostics);
                    let generation_for_model_watchdog = Arc::clone(&supervisor_gen);
                    std::thread::spawn(move || {
                        for _ in 0..180 {
                            if model_settled.load(AtomicOrdering::SeqCst)
                                || generation_for_model_watchdog.load(AtomicOrdering::SeqCst)
                                    != my_gen
                            {
                                return;
                            }
                            std::thread::sleep(Duration::from_secs(1));
                        }
                        if let Ok(mut status) = runtime_for_model_watchdog.lock() {
                            status["whisper"] = serde_json::json!("failed");
                        }
                        push_diagnostic(
                            &diagnostics_for_model_watchdog,
                            DiagnosticEvent {
                                timestamp: chrono::Utc::now().to_rfc3339(),
                                source: "watchdog".to_string(),
                                level: "error".to_string(),
                                code: "MODEL_READINESS_TIMEOUT".to_string(),
                                message: "Whisper did not report readiness within 180 seconds."
                                    .to_string(),
                                attempt: None,
                                exit_code: None,
                            },
                        );
                        app_for_model_watchdog.emit("python-event", serde_json::json!({
                            "event":"AI_RUNTIME_STATUS", "data": {"state":"failed", "provider":"local", "model":"base", "elapsed_ms":180000, "message":"Whisper readiness timed out. Retry the service."}
                        }).to_string()).ok();
                    });

                    // Wait for the child to exit
                    let mut child_to_wait = None;
                    {
                        // Safely take child ownership to wait on it
                        let mut child_lock = python_child_clone.lock().unwrap();
                        if let Some(c) = child_lock.take() {
                            child_to_wait = Some(c);
                        }
                    }
                    if let Some(mut c) = child_to_wait {
                        loop {
                            match c.try_wait() {
                                Ok(Some(status)) => {
                                    failure_cause = "process_exit".to_string();
                                    failure_exit_code = status.code();
                                    println!(
                                        "[Supervisor] Python process exited with status: {}",
                                        status
                                    );
                                    break;
                                }
                                Ok(None)
                                    if !healthy.load(AtomicOrdering::SeqCst)
                                        && started_at.elapsed() >= Duration::from_secs(45) =>
                                {
                                    failure_cause = "audio_readiness_timeout".to_string();
                                    let _ = c.kill();
                                    failure_exit_code =
                                        c.wait().ok().and_then(|status| status.code());
                                    break;
                                }
                                Ok(None) => std::thread::sleep(Duration::from_millis(200)),
                                Err(error) => {
                                    failure_cause = "process_wait_failed".to_string();
                                    eprintln!(
                                        "[Supervisor Error] Failed to wait on child process: {}",
                                        error
                                    );
                                    break;
                                }
                            }
                        }
                    }

                    if healthy.load(AtomicOrdering::SeqCst)
                        && started_at.elapsed() >= Duration::from_secs(30)
                    {
                        restart_attempts = 0;
                    }
                    if let Ok(mut status) = runtime_status.lock() {
                        status["sidecar"] = serde_json::json!("down");
                    }
                    push_diagnostic(
                        &diagnostics,
                        DiagnosticEvent {
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            source: "supervisor".to_string(),
                            level: "error".to_string(),
                            code: "SIDECAR_EXIT".to_string(),
                            message: "The transcription service exited unexpectedly.".to_string(),
                            attempt: Some(restart_attempts + 1),
                            exit_code: failure_exit_code,
                        },
                    );

                    // Ensure the stdin handle is cleared
                    {
                        let mut stdin_lock = python_stdin.lock().unwrap();
                        *stdin_lock = None;
                    }

                    // Expected exit: a newer supervisor replaced this child's
                    // stdin (EOF -> clean exit). Not a crash — leave silently.
                    if supervisor_gen.load(AtomicOrdering::SeqCst) != my_gen {
                        println!(
                            "[Supervisor] Generation {} superseded; not restarting.",
                            my_gen
                        );
                        break;
                    }

                    // Sidecar went down
                    app_handle
                        .emit(
                            "python-event",
                            serde_json::json!({
                                "event": "SIDECAR_DOWN",
                                "data": { "cause": failure_cause, "exitCode": failure_exit_code, "attempt": restart_attempts + 1 }
                            })
                            .to_string(),
                        )
                        .ok();
                }
                Err(e) => {
                    failure_cause = format!(
                        "spawn_failed: {}",
                        sanitized_diagnostic_message(&e.to_string())
                    );
                    eprintln!("[Supervisor Error] Failed to spawn Python sidecar: {}", e);
                    app_handle
                        .emit(
                            "python-event",
                            serde_json::json!({
                                "event": "SIDECAR_DOWN",
                                "data": { "error": e.to_string() }
                            })
                            .to_string(),
                        )
                        .ok();
                }
            }

            // Increment restart attempts and wait with exponential backoff
            restart_attempts += 1;
            if restart_attempts > max_attempts {
                eprintln!(
                    "[Supervisor] Maximum restart attempts reached. Process marked as FAILED."
                );
                app_handle
                    .emit(
                        "python-event",
                        serde_json::json!({
                            "event": "SIDECAR_FAILED",
                            "data": { "cause": failure_cause, "exitCode": failure_exit_code, "attempt": restart_attempts }
                        })
                        .to_string(),
                    )
                    .ok();
                break;
            }

            let backoff_secs = match restart_attempts {
                1 => 1,
                2 => 2,
                _ => 4,
            };
            println!(
                "[Supervisor] Waiting {}s before auto-restarting...",
                backoff_secs
            );
            std::thread::sleep(std::time::Duration::from_secs(backoff_secs));
        }
    });
}

#[tauri::command]
fn start_sidecar(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: Option<String>,
) -> Result<(), String> {
    {
        let stdin_lock = state.python_stdin.lock().unwrap();
        if stdin_lock.is_some() {
            return Ok(());
        }
    }

    let kind = kind.unwrap_or_else(|| "cpu".to_string());
    let engine_path = if cfg!(debug_assertions) {
        None
    } else {
        Some(
            find_downloaded_engine(&app, &kind)
                .or_else(|| find_bundled_engine(&app))
                .ok_or_else(|| format!("{} engine is not installed.", kind))?,
        )
    };

    println!("[RUST INFO] Starting sidecar through bootstrap flow.");
    app.emit("sidecar-starting", serde_json::json!({ "kind": kind }))
        .ok();

    // Claim a new supervisor generation: any previous supervisor loop becomes
    // stale and exits instead of fighting this one over the stdin handle.
    let my_gen = state.supervisor_gen.fetch_add(1, AtomicOrdering::SeqCst) + 1;
    spawn_and_supervise_python(
        app,
        Arc::clone(&state.db),
        Arc::clone(&state.python_stdin),
        Arc::clone(&state.python_child),
        engine_path,
        Arc::clone(&state.supervisor_gen),
        Arc::clone(&state.diagnostics),
        Arc::clone(&state.runtime_status),
        my_gen,
    );
    Ok(())
}

#[tauri::command]
fn reconnect_sidecar(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: Option<String>,
) -> Result<(), String> {
    println!("[RUST INFO] Manual sidecar reconnection triggered.");
    // Clear any existing child just in case
    {
        let mut child_lock = state.python_child.lock().unwrap();
        if let Some(mut child) = child_lock.take() {
            let _ = child.kill();
        }
    }
    {
        let mut stdin_lock = state.python_stdin.lock().unwrap();
        *stdin_lock = None;
    }

    let engine_path = if cfg!(debug_assertions) {
        None
    } else {
        let preferred = kind.unwrap_or_else(|| "cpu".to_string());
        Some(
            find_downloaded_engine(&app, &preferred)
                .or_else(|| {
                    find_downloaded_engine(&app, if preferred == "cpu" { "gpu" } else { "cpu" })
                })
                .or_else(|| find_bundled_engine(&app))
                .ok_or_else(|| {
                    "No complete engine installation is available to retry.".to_string()
                })?,
        )
    };

    // Spawn supervisor thread under a fresh generation (retires the old one)
    let my_gen = state.supervisor_gen.fetch_add(1, AtomicOrdering::SeqCst) + 1;
    spawn_and_supervise_python(
        app,
        Arc::clone(&state.db),
        Arc::clone(&state.python_stdin),
        Arc::clone(&state.python_child),
        engine_path,
        Arc::clone(&state.supervisor_gen),
        Arc::clone(&state.diagnostics),
        Arc::clone(&state.runtime_status),
        my_gen,
    );
    Ok(())
}

pub fn initialize_db_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Create the meetings table with the full schema (new installs)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS meetings (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            date               TEXT NOT NULL,
            title              TEXT NOT NULL,
            raw_transcript     TEXT NOT NULL,
            markdown_summary   TEXT NOT NULL,
            speakers           TEXT,
            tags               TEXT,
            structured_summary TEXT,
            transcript_segments TEXT,
            schema_version     INTEGER NOT NULL DEFAULT 1
        )",
        [],
    )?;

    // Migrate existing databases — SQLite has no IF NOT EXISTS for ALTER TABLE,
    // so we attempt each column and silently ignore "duplicate column name" errors.
    for sql in &[
        "ALTER TABLE meetings ADD COLUMN speakers TEXT",
        "ALTER TABLE meetings ADD COLUMN tags TEXT",
        "ALTER TABLE meetings ADD COLUMN structured_summary TEXT",
        "ALTER TABLE meetings ADD COLUMN transcript_segments TEXT",
        "ALTER TABLE meetings ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1",
    ] {
        if let Err(e) = conn.execute(sql, []) {
            if !e.to_string().contains("duplicate column name") {
                eprintln!("[DB Migration] {}: {}", sql, e);
            }
        }
    }

    // FTS5 virtual table — content= links to meetings without duplicating data.
    // Three triggers keep the index in sync automatically.
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS meetings_fts
         USING fts5(title, raw_transcript, markdown_summary,
                    content='meetings', content_rowid='id');

         CREATE TRIGGER IF NOT EXISTS meetings_fts_insert
         AFTER INSERT ON meetings BEGIN
             INSERT INTO meetings_fts(rowid, title, raw_transcript, markdown_summary)
             VALUES (new.id, new.title, new.raw_transcript, new.markdown_summary);
         END;

         CREATE TRIGGER IF NOT EXISTS meetings_fts_update
         AFTER UPDATE ON meetings BEGIN
             UPDATE meetings_fts
             SET title = new.title,
                 raw_transcript = new.raw_transcript,
                 markdown_summary = new.markdown_summary
             WHERE rowid = new.id;
         END;

         CREATE TRIGGER IF NOT EXISTS meetings_fts_delete
         AFTER DELETE ON meetings BEGIN
             DELETE FROM meetings_fts WHERE rowid = old.id;
         END;",
    )?;

    Ok(())
}

// Register testing modules
#[cfg(test)]
mod db_tests;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    sanitize_snap_runtime_env();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            // 1. Initialize persistent application data.
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            std::fs::create_dir_all(&app_data_dir)?;

            let database_path = app_data_dir.join("notetaker.db");
            let legacy_database_path = PathBuf::from("notetaker.db");
            if !database_path.exists() && legacy_database_path.exists() {
                std::fs::copy(&legacy_database_path, &database_path)?;
            }

            let conn = Connection::open(&database_path)?;
            initialize_db_schema(&conn)?;

            app.manage(AppState {
                db: Arc::new(Mutex::new(conn)),
                python_stdin: Arc::new(Mutex::new(None)),
                python_child: Arc::new(Mutex::new(None)),
                supervisor_gen: Arc::new(AtomicU64::new(0)),
                engine_download: Arc::new(Mutex::new(None)),
                diagnostics: Arc::new(Mutex::new(Vec::new())),
                runtime_status: Arc::new(Mutex::new(serde_json::json!({
                    "sidecar": "stopped", "audio": "pending", "whisper": "pending",
                    "ollama": "offline", "operationStartedAt": chrono::Utc::now().to_rfc3339()
                }))),
            });

            // 2. Initialize Daily Rotating Logs
            let logs_dir = app_data_dir.join("logs");
            let _ = std::fs::create_dir_all(&logs_dir);

            let file_appender = tracing_appender::rolling::daily(&logs_dir, "app.log");
            let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
            std::mem::forget(_guard); // Leak guard so logging remains active

            use tracing_subscriber::{fmt, prelude::*, Registry};
            let filter = tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

            let _ = Registry::default()
                .with(filter)
                .with(fmt::layer().with_writer(non_blocking))
                .try_init();

            println!(
                "[RUST INFO] Daily rotating logs initialized at: {:?}",
                logs_dir.join("app.log")
            );

            // 3. Atomically Migrate settings.json secrets to OS Keychain
            migrate_settings_to_keychain(app);

            // 4. The Python engine is started by the frontend bootstrap after
            // it verifies or downloads the selected local engine.

            // Register global keyboard shortcuts.
            // Use Cmd+Shift on macOS, Ctrl+Shift on Windows/Linux.
            // Registering only one modifier set per platform avoids the
            // "HotKey already registered" panic that occurs when the same
            // physical key combination is registered twice on Windows.
            let shortcut_handle = app.handle().clone();
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |_app, shortcut, event| {
                        if event.state() != ShortcutState::Pressed {
                            return;
                        }
                        let m = if cfg!(target_os = "macos") {
                            Modifiers::SUPER | Modifiers::SHIFT
                        } else {
                            Modifiers::CONTROL | Modifiers::SHIFT
                        };
                        let cmd = if shortcut.matches(m, Code::KeyR) {
                            Some("shortcut:toggle-recording")
                        } else if shortcut.matches(m, Code::KeyP) {
                            Some("shortcut:toggle-pause")
                        } else if shortcut.matches(m, Code::KeyE) {
                            Some("shortcut:toggle-expand")
                        } else {
                            None
                        };
                        if let Some(name) = cmd {
                            shortcut_handle.emit(name, ()).ok();
                        }
                    })
                    .build(),
            )?;

            let modifier = if cfg!(target_os = "macos") {
                Modifiers::SUPER | Modifiers::SHIFT
            } else {
                Modifiers::CONTROL | Modifiers::SHIFT
            };
            app.global_shortcut().register_multiple([
                Shortcut::new(Some(modifier), Code::KeyR), // toggle recording
                Shortcut::new(Some(modifier), Code::KeyP), // pause / resume
                Shortcut::new(Some(modifier), Code::KeyE), // expand / collapse
            ])?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_meeting,
            get_meetings,
            search_meetings,
            send_command_to_python,
            set_compact_mode,
            set_expanded_mode,
            set_wizard_mode,
            set_bootstrap_mode,
            open_popover_window,
            close_popover_window,
            request_audio_devices,
            reprocess_meeting,
            trigger_index_backfill,
            get_engine_status,
            download_engine,
            cancel_engine_download,
            get_engine_capabilities,
            check_ollama,
            install_ollama_winget,
            pull_ollama_model,
            set_secret,
            get_secret,
            delete_secret,
            start_sidecar,
            reconnect_sidecar,
            open_logs_folder,
            get_runtime_diagnostics,
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("Error while building tauri application");

    app.run(move |app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            println!("[RUST INFO] Tauri application exiting, terminating Python engine...");
            let state = app_handle.state::<AppState>();
            let mut lock = state.python_child.lock().unwrap();
            if let Some(mut child) = lock.take() {
                let _ = child.kill();
                println!("[RUST SUCCESS] Python child process terminated.");
            }
        }
    });
}
