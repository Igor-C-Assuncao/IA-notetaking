use keyring::Entry;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri::{LogicalSize, Window};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

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
}

const ENGINE_VERSION: &str = "0.1.0";
const ENGINE_RELEASE_BASE: &str =
    "https://github.com/Igor-C-Assuncao/IA-notetaking/releases/download/v0.1.0";
const ENGINE_MANIFEST_FILE: &str = "engines-manifest.json";

#[derive(serde::Serialize)]
struct EngineStatus {
    installed: bool,
    kind: String,
    version: String,
    path: Option<String>,
    size_bytes: Option<u64>,
    dev_mode: bool,
}

#[derive(serde::Deserialize)]
struct EngineManifest {
    engines: Vec<EngineManifestEntry>,
}

#[derive(serde::Deserialize, Clone)]
struct EngineManifestEntry {
    kind: String,
    file_name: String,
    sha256: String,
    size_bytes: u64,
    url: Option<String>,
    chunks: Option<Vec<EngineManifestChunk>>,
}

#[derive(serde::Deserialize, Clone)]
struct EngineManifestChunk {
    file_name: String,
    sha256: String,
    size_bytes: u64,
    url: Option<String>,
}

#[derive(serde::Serialize)]
struct OllamaStatus {
    installed: bool,
    running: bool,
    models: Vec<String>,
    message: String,
}

fn engine_file_name(kind: &str) -> &'static str {
    match kind {
        "gpu" => "ai-notetaking-engine-windows-x64-gpu.exe",
        _ => "ai-notetaking-engine-windows-x64-cpu.exe",
    }
}

fn engine_download_url(kind: &str) -> String {
    format!("{}/{}", ENGINE_RELEASE_BASE, engine_file_name(kind))
}

fn engine_asset_url(file_name: &str) -> String {
    format!("{}/{}", ENGINE_RELEASE_BASE, file_name)
}

fn engine_manifest_url() -> String {
    format!("{}/{}", ENGINE_RELEASE_BASE, ENGINE_MANIFEST_FILE)
}

fn fetch_engine_manifest() -> Result<EngineManifest, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
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
    response
        .json::<EngineManifest>()
        .map_err(|e| format!("Invalid engine manifest: {}", e))
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

fn engine_path(app: &AppHandle, kind: &str) -> Result<PathBuf, String> {
    Ok(engine_dir(app, kind)?.join(engine_file_name(kind)))
}

fn find_downloaded_engine(app: &AppHandle, kind: &str) -> Option<PathBuf> {
    let path = engine_path(app, kind).ok()?;
    let is_nonempty = path
        .metadata()
        .map(|metadata| metadata.len() > 0)
        .unwrap_or(false);
    if is_nonempty {
        Some(path)
    } else {
        None
    }
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
        });
    }

    let path = find_downloaded_engine(&app, &kind);
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
    })
}

#[tauri::command]
fn download_engine(app: AppHandle, kind: String) -> Result<EngineStatus, String> {
    if cfg!(debug_assertions) {
        return get_engine_status(app, Some(kind));
    }

    let target_dir = engine_dir(&app, &kind)?;
    std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let manifest_entry = manifest_entry_for(&kind)?;
    let target_path = engine_dir(&app, &kind)?.join(&manifest_entry.file_name);
    let partial_path = target_path.with_extension("download");
    let _ = std::fs::remove_file(&partial_path);

    app.emit(
        "engine-download-progress",
        serde_json::json!({
            "kind": kind,
            "stage": "downloading",
            "downloadedBytes": 0,
            "totalBytes": null,
            "message": "Starting engine download"
        }),
    )
    .ok();

    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(60 * 45))
        .build()
        .map_err(|e| e.to_string())?;
    let mut file = File::create(&partial_path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;

    if let Some(chunks) = manifest_entry.chunks.clone() {
        let chunk_total = chunks
            .iter()
            .try_fold(0_u64, |sum, chunk| sum.checked_add(chunk.size_bytes))
            .ok_or_else(|| "Engine chunk sizes overflowed.".to_string())?;
        if chunk_total != manifest_entry.size_bytes {
            let _ = std::fs::remove_file(&partial_path);
            return Err(format!(
                "Engine manifest chunk sizes do not match package size. Expected {} bytes, got {} bytes.",
                manifest_entry.size_bytes, chunk_total
            ));
        }

        for (index, chunk) in chunks.iter().enumerate() {
            let url = chunk
                .url
                .clone()
                .unwrap_or_else(|| engine_asset_url(&chunk.file_name));
            download_engine_asset(
                &app,
                &client,
                &kind,
                &url,
                chunk.size_bytes,
                Some(&chunk.sha256),
                &mut file,
                &mut hasher,
                &mut downloaded,
                manifest_entry.size_bytes,
                &format!(
                    "Downloading local engine part {} of {}",
                    index + 1,
                    chunks.len()
                ),
            )?;
        }
    } else {
        let url = manifest_entry
            .url
            .clone()
            .unwrap_or_else(|| engine_download_url(&kind));
        download_engine_asset(
            &app,
            &client,
            &kind,
            &url,
            manifest_entry.size_bytes,
            None,
            &mut file,
            &mut hasher,
            &mut downloaded,
            manifest_entry.size_bytes,
            "Downloading local engine",
        )?;
    }

    file.flush().map_err(|e| e.to_string())?;
    let hash = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();
    if downloaded != manifest_entry.size_bytes {
        let _ = std::fs::remove_file(&partial_path);
        return Err(format!(
            "Engine package size mismatch. Expected {} bytes, got {} bytes.",
            manifest_entry.size_bytes, downloaded
        ));
    }

    if hash.to_lowercase() != manifest_entry.sha256.to_lowercase() {
        let _ = std::fs::remove_file(&partial_path);
        return Err("Engine package integrity check failed. The downloaded file did not match the expected SHA-256.".to_string());
    }

    app.emit(
        "engine-download-progress",
        serde_json::json!({
            "kind": kind,
            "stage": "verifying",
            "downloadedBytes": downloaded,
            "totalBytes": manifest_entry.size_bytes,
            "sha256": hash,
            "message": "Verifying engine package"
        }),
    )
    .ok();

    std::fs::rename(&partial_path, &target_path).map_err(|e| e.to_string())?;

    app.emit(
        "engine-download-completed",
        serde_json::json!({
            "kind": kind,
            "path": target_path.to_string_lossy(),
            "sha256": hash,
            "sizeBytes": downloaded
        }),
    )
    .ok();

    get_engine_status(app, Some(kind))
}

fn download_engine_asset(
    app: &AppHandle,
    client: &reqwest::blocking::Client,
    kind: &str,
    url: &str,
    expected_size: u64,
    expected_sha256: Option<&str>,
    output: &mut File,
    package_hasher: &mut Sha256,
    downloaded_total: &mut u64,
    package_size: u64,
    message: &str,
) -> Result<(), String> {
    let mut response = client.get(url).send().map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Engine download failed with HTTP {} from {}",
            response.status(),
            url
        ));
    }

    if let Some(total) = response.content_length() {
        if total != expected_size {
            return Err(format!(
                "Engine asset size mismatch before download. Expected {} bytes, got {} bytes from {}.",
                expected_size, total, url
            ));
        }
    }

    let mut chunk_hasher = Sha256::new();
    let mut downloaded_asset = 0_u64;
    let mut buffer = [0_u8; 1024 * 256];

    loop {
        let read = response.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|e| e.to_string())?;
        package_hasher.update(&buffer[..read]);
        chunk_hasher.update(&buffer[..read]);
        downloaded_asset += read as u64;
        *downloaded_total += read as u64;

        app.emit(
            "engine-download-progress",
            serde_json::json!({
                "kind": kind,
                "stage": "downloading",
                "downloadedBytes": *downloaded_total,
                "totalBytes": package_size,
                "message": message
            }),
        )
        .ok();
    }

    if downloaded_asset != expected_size {
        return Err(format!(
            "Engine asset size mismatch. Expected {} bytes, got {} bytes from {}.",
            expected_size, downloaded_asset, url
        ));
    }

    if let Some(expected_hash) = expected_sha256 {
        let hash = chunk_hasher
            .finalize()
            .iter()
            .map(|byte| format!("{:02x}", byte))
            .collect::<String>();
        if hash.to_lowercase() != expected_hash.to_lowercase() {
            return Err(format!(
                "Engine asset integrity check failed for {}. The downloaded chunk did not match the expected SHA-256.",
                url
            ));
        }
    }

    Ok(())
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
            Ok(OllamaStatus {
                installed: true,
                running: true,
                models,
                message: "Ollama is running.".to_string(),
            })
        }
        _ => Ok(OllamaStatus {
            installed,
            running: false,
            models: Vec::new(),
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
        .set_size(LogicalSize::new(760.0, 640.0))
        .map_err(|e| e.to_string())?;
    window.set_decorations(false).map_err(|e| e.to_string())?;
    window.set_always_on_top(false).map_err(|e| e.to_string())?;
    window.set_resizable(true).map_err(|e| e.to_string())?;
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

    // Fetch raw_transcript and structured_summary from the DB
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT raw_transcript, structured_summary FROM meetings WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let (raw_transcript, structured_summary): (String, Option<String>) = stmt
        .query_row(rusqlite::params![meeting_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|e| e.to_string())?;

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

fn spawn_and_supervise_python(
    app_handle: AppHandle,
    db: Arc<Mutex<Connection>>,
    python_stdin: Arc<Mutex<Option<ChildStdin>>>,
    python_child: Arc<Mutex<Option<Child>>>,
    requested_engine_path: Option<PathBuf>,
) {
    std::thread::spawn(move || {
        let mut restart_attempts = 0;
        let max_attempts = 3;

        loop {
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
                        .stderr(Stdio::inherit())
                        .spawn()
                } else {
                    Command::new("bash")
                        .current_dir("../")
                        .arg("src-python/run.sh")
                        .env("AI_NOTETAKING_DATA_DIR", &app_data_dir)
                        .stdin(Stdio::piped())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::inherit())
                        .spawn()
                }
            } else if let Some(path) = sidecar_path {
                println!("[Supervisor] Spawning production sidecar: {:?}", path);
                Command::new(path)
                    .env("AI_NOTETAKING_DATA_DIR", &app_data_dir)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::inherit())
                    .spawn()
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "Sidecar binary not found in production build",
                ))
            };

            match child_res {
                Ok(mut child) => {
                    let stdin = child.stdin.take().expect("Failed to open Python stdin");
                    let stdout = child.stdout.take().expect("Failed to open Python stdout");

                    // Update global AppState
                    {
                        let mut stdin_lock = python_stdin.lock().unwrap();
                        *stdin_lock = Some(stdin);
                    }
                    {
                        let mut child_lock = python_child.lock().unwrap();
                        *child_lock = Some(child);
                    }

                    // Reset restart attempts on successful startup
                    restart_attempts = 0;
                    app_handle
                        .emit(
                            "python-event",
                            serde_json::json!({
                                "event": "SIDECAR_UP",
                                "data": {}
                            })
                            .to_string(),
                        )
                        .ok();

                    // Start the stdout reader thread for this child
                    let app_handle_clone = app_handle.clone();
                    let db_clone = Arc::clone(&db);
                    let python_child_clone = Arc::clone(&python_child);
                    std::thread::spawn(move || {
                        let reader = BufReader::new(stdout);
                        for content in reader.lines().map_while(Result::ok) {
                            if !content.contains("VAD_TELEMETRY") {
                                println!("[PYTHON STDOUT] {}", content);
                            }

                            // Parse JSON to check for DB-persisted events
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                                let event_name = json["event"].as_str().unwrap_or("");

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
                        match c.wait() {
                            Ok(status) => {
                                println!(
                                    "[Supervisor] Python process exited with status: {}",
                                    status
                                );
                            }
                            Err(e) => {
                                eprintln!(
                                    "[Supervisor Error] Failed to wait on child process: {}",
                                    e
                                );
                            }
                        }
                    }

                    // Ensure the stdin handle is cleared
                    {
                        let mut stdin_lock = python_stdin.lock().unwrap();
                        *stdin_lock = None;
                    }

                    // Sidecar went down
                    app_handle
                        .emit(
                            "python-event",
                            serde_json::json!({
                                "event": "SIDECAR_DOWN",
                                "data": {}
                            })
                            .to_string(),
                        )
                        .ok();
                }
                Err(e) => {
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
                            "data": {}
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
                .ok_or_else(|| format!("{} engine is not installed.", kind))?,
        )
    };

    println!("[RUST INFO] Starting sidecar through bootstrap flow.");
    app.emit("sidecar-starting", serde_json::json!({ "kind": kind }))
        .ok();

    spawn_and_supervise_python(
        app,
        Arc::clone(&state.db),
        Arc::clone(&state.python_stdin),
        Arc::clone(&state.python_child),
        engine_path,
    );
    Ok(())
}

#[tauri::command]
fn reconnect_sidecar(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
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

    // Spawn supervisor thread
    spawn_and_supervise_python(
        app,
        Arc::clone(&state.db),
        Arc::clone(&state.python_stdin),
        Arc::clone(&state.python_child),
        None,
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
            check_ollama,
            install_ollama_winget,
            pull_ollama_model,
            set_secret,
            get_secret,
            delete_secret,
            start_sidecar,
            reconnect_sidecar,
            open_logs_folder,
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
