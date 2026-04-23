use rusqlite::Connection;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri::{LogicalSize, Window};

// 1. Structure Definitions
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct Meeting {
    id: Option<i32>,
    date: String,
    title: String,
    raw_transcript: String,
    markdown_summary: String,
}

// 2. Global Application State (Database + Python Stdin)
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
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO meetings (date, title, raw_transcript, markdown_summary) VALUES (?1, ?2, ?3, ?4)",
        (&date, &title, &raw_transcript, &markdown_summary),
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_meetings(state: State<'_, AppState>) -> Result<Vec<Meeting>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT id, date, title, raw_transcript, markdown_summary FROM meetings ORDER BY id DESC").map_err(|e| e.to_string())?;

    let meeting_iter = stmt
        .query_map([], |row| {
            Ok(Meeting {
                id: Some(row.get(0)?),
                date: row.get(1)?,
                title: row.get(2)?,
                raw_transcript: row.get(3)?,
                markdown_summary: row.get(4)?,
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

// 5. Popover Window Commands
//
// Opens the settings popover as a separate frameless OS window, positioned
// above the compact widget. If the window is already open, closes it (toggle).
// Falls back to opening below the widget when there is not enough vertical
// space above it (e.g. widget near the top of the screen).
#[tauri::command]
async fn open_popover_window(app: AppHandle, window: Window) -> Result<(), String> {
    // Toggle: close if already open
    if let Some(existing) = app.get_webview_window("popover") {
        existing.close().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;

    let popover_w = 284.0_f64;
    let popover_h = 344.0_f64;
    let gap = 8.0_f64;

    // Right-align with main window; clamp so it does not go off-screen left
    let x = (pos.x as f64 + size.width as f64 - popover_w - 8.0).max(0.0);

    // Prefer opening above; fall back to below when there is not enough room
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

// 6. Main Initialization Function
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = Connection::open("notetaker.db").expect("Failed to open local database");
    conn.execute(
        "CREATE TABLE IF NOT EXISTS meetings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            title TEXT NOT NULL,
            raw_transcript TEXT NOT NULL,
            markdown_summary TEXT NOT NULL
        )",
        [],
    )
    .expect("Failed to create tables");

    let python_stdin = Arc::new(Mutex::new(None));
    let python_stdin_clone = Arc::clone(&python_stdin);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            db: Mutex::new(conn),
            python_stdin,
        })
        .setup(move |app| {
            let app_handle = app.handle().clone();

            let mut child = Command::new("bash")
                .current_dir("../")
                .arg("src-python/run.sh")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .expect("Failed to start Python engine");

            let stdin = child.stdin.take().expect("Failed to open Python stdin");
            *python_stdin_clone.lock().unwrap() = Some(stdin);

            let stdout = child.stdout.take().expect("Failed to open Python stdout");
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(content) = line {
                        println!("[PYTHON STDOUT] {}", content);
                        app_handle.emit("python-event", content).unwrap();
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_meeting,
            get_meetings,
            send_command_to_python,
            set_compact_mode,
            set_expanded_mode,
            open_popover_window,
            close_popover_window,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running tauri application");
}
