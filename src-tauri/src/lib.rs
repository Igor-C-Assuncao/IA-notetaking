use rusqlite::Connection;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindowBuilder, WebviewUrl};
use tauri::{LogicalSize, Window};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

// 1. Structure Definitions
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct Meeting {
    id: Option<i32>,
    date: String,
    title: String,
    raw_transcript: String,
    markdown_summary: String,
    speakers: Option<String>,
    tags: Option<String>,
    structured_summary: Option<String>,
}

// 2. Global Application State
struct AppState {
    db: Mutex<Connection>,
    python_stdin: Arc<Mutex<Option<ChildStdin>>>,
}

// 3. Database Commands
#[tauri::command]
fn save_meeting(
    state: State<'_, AppState>,
    date: String,
    title: String,
    raw_transcript: String,
    markdown_summary: String,
    speakers: Option<String>,
    tags: Option<String>,
    structured_summary: Option<String>,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO meetings (date, title, raw_transcript, markdown_summary, speakers, tags, structured_summary)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            &date, &title, &raw_transcript, &markdown_summary,
            &speakers, &tags, &structured_summary,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_meetings(state: State<'_, AppState>) -> Result<Vec<Meeting>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT id, date, title, raw_transcript, markdown_summary, speakers, tags, structured_summary
         FROM meetings ORDER BY id DESC"
    ).map_err(|e| e.to_string())?;

    let meeting_iter = stmt
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
            })
        })
        .map_err(|e| e.to_string())?;

    let mut meetings = Vec::new();
    for meeting in meeting_iter {
        meetings.push(meeting.map_err(|e| e.to_string())?)
    }
    Ok(meetings)
}

#[tauri::command]
fn search_meetings(state: State<'_, AppState>, query: String) -> Result<Vec<Meeting>, String> {
    if query.trim().is_empty() {
        return get_meetings(state);
    }

    let db = state.db.lock().unwrap();
    let fts_query = format!("{}*", query.trim().replace('"', ""));

    let mut stmt = db.prepare(
        "SELECT m.id, m.date, m.title, m.raw_transcript, m.markdown_summary,
                m.speakers, m.tags, m.structured_summary
         FROM meetings m
         JOIN meetings_fts fts ON fts.rowid = m.id
         WHERE meetings_fts MATCH ?1
         ORDER BY m.id DESC"
    ).map_err(|e| e.to_string())?;

    let meeting_iter = stmt
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
            })
        })
        .map_err(|e| e.to_string())?;

    let mut meetings = Vec::new();
    for meeting in meeting_iter {
        meetings.push(meeting.map_err(|e| e.to_string())?)
    }
    Ok(meetings)
}

// 4. IPC Command: Sends commands to Python via stdin
#[tauri::command]
fn send_command_to_python(state: State<'_, AppState>, payload: String) -> Result<(), String> {
    println!("[RUST DEBUG] Sending to Python: {}", payload);
    let stdin_lock = state.python_stdin.lock().unwrap();
    if let Some(mut stdin) = stdin_lock.as_ref() {
        writeln!(stdin, "{}", payload).map_err(|e| e.to_string())?;
        return Ok(());
    }
    Err("Python process not initialized or stdin unavailable".to_string())
}

#[tauri::command]
async fn set_compact_mode(window: Window) -> Result<(), String> {
    window.set_size(LogicalSize::new(400.0, 120.0)).map_err(|e| e.to_string())?;
    window.set_decorations(false).map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window.set_resizable(false).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn set_expanded_mode(window: Window) -> Result<(), String> {
    window.set_size(LogicalSize::new(1024.0, 720.0)).map_err(|e| e.to_string())?;
    window.set_decorations(false).map_err(|e| e.to_string())?;
    window.set_always_on_top(false).map_err(|e| e.to_string())?;
    window.set_resizable(true).map_err(|e| e.to_string())?;
    window.center().map_err(|e| e.to_string())?;
    Ok(())
}

// 5. Audio Device Enumeration
#[tauri::command]
fn request_audio_devices(state: State<'_, AppState>) -> Result<(), String> {
    let stdin_lock = state.python_stdin.lock().unwrap();
    if let Some(mut stdin) = stdin_lock.as_ref() {
        let payload = serde_json::json!({"action": "LIST_DEVICES"});
        writeln!(stdin, "{}", payload).map_err(|e| e.to_string())?;
        return Ok(());
    }
    Err("Python process not available".to_string())
}

// 6. Popover Window Commands
#[tauri::command]
async fn open_popover_window(app: AppHandle, window: Window) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("popover") {
        existing.close().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;

    let popover_w = 300.0_f64;
    let popover_h = 480.0_f64;
    let gap = 8.0_f64;

    let x = (pos.x as f64 + size.width as f64 - popover_w - 8.0).max(0.0);
    let y = if pos.y as f64 >= popover_h + gap {
        pos.y as f64 - popover_h - gap
    } else {
        pos.y as f64 + size.height as f64 + gap
    };

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
    .position(x, y)
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

// 7. Main Initialization Function
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = Connection::open("notetaker.db").expect("Failed to open local database");

    // Full schema for new installs
    conn.execute(
        "CREATE TABLE IF NOT EXISTS meetings (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            date               TEXT NOT NULL,
            title              TEXT NOT NULL,
            raw_transcript     TEXT NOT NULL,
            markdown_summary   TEXT NOT NULL,
            speakers           TEXT,
            tags               TEXT,
            structured_summary TEXT
        )",
        [],
    ).expect("Failed to create meetings table");

    // Column migration for existing databases
    for sql in &[
        "ALTER TABLE meetings ADD COLUMN speakers TEXT",
        "ALTER TABLE meetings ADD COLUMN tags TEXT",
        "ALTER TABLE meetings ADD COLUMN structured_summary TEXT",
    ] {
        if let Err(e) = conn.execute(sql, []) {
            if !e.to_string().contains("duplicate column name") {
                eprintln!("[DB Migration] {}: {}", sql, e);
            }
        }
    }

    // FTS5 virtual table + sync triggers
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS meetings_fts
         USING fts5(title, raw_transcript, markdown_summary, content='meetings', content_rowid='id');

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
    ).expect("Failed to create FTS5 table and triggers");

    let python_stdin = Arc::new(Mutex::new(None));
    let python_stdin_clone = Arc::clone(&python_stdin);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
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
                        _app.emit(name, ()).ok();
                    }
                })
                .build(),
        )
        .manage(AppState {
            db: Mutex::new(conn),
            python_stdin,
        })
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // ── Python engine startup ──────────────────────────────
            let mut child = if cfg!(target_os = "windows") {
                Command::new(r"..\src-python\.venv\Scripts\python.exe")
                    .arg(r"..\src-python\main.py")
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::inherit())
                    .spawn()
                    .expect("Failed to start Python engine")
            } else {
                Command::new("bash")
                    .current_dir("../")
                    .arg("src-python/run.sh")
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::inherit())
                    .spawn()
                    .expect("Failed to start Python engine")
            };

            let stdin = child.stdin.take().expect("Failed to open Python stdin");
            *python_stdin_clone.lock().unwrap() = Some(stdin);

            let stdout = child.stdout.take().expect("Failed to open Python stdout");
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(content) = line {
                        if !content.contains("VAD_TELEMETRY") {
                            println!("[PYTHON STDOUT] {}", content);
                        }
                        app_handle.emit("python-event", content).unwrap();
                    }
                }
            });

            // ── Global keyboard shortcuts ──────────────────────────
            // Plugin is already initialized above; only register shortcuts here.
            let modifier = if cfg!(target_os = "macos") {
                Modifiers::SUPER | Modifiers::SHIFT
            } else {
                Modifiers::CONTROL | Modifiers::SHIFT
            };
            let shortcuts = [
                Shortcut::new(Some(modifier), Code::KeyR),
                Shortcut::new(Some(modifier), Code::KeyP),
                Shortcut::new(Some(modifier), Code::KeyE),
            ];
            app.global_shortcut().register_multiple(shortcuts)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_meeting,
            get_meetings,
            search_meetings,
            send_command_to_python,
            set_compact_mode,
            set_expanded_mode,
            open_popover_window,
            close_popover_window,
            request_audio_devices,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running tauri application");
}