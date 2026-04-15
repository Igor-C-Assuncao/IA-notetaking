use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use std::io::{Write, BufRead, BufReader};
use std::process::{Command, Stdio, ChildStdin};
use tauri::{State, Manager, Emitter};

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
    
    let meeting_iter = stmt.query_map([], |row| {
        Ok(Meeting {
            id: Some(row.get(0)?),
            date: row.get(1)?,
            title: row.get(2)?,
            raw_transcript: row.get(3)?,
            markdown_summary: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut meetings = Vec::new();
    for meeting in meeting_iter {
        meetings.push(meeting.map_err(|e| e.to_string())?);
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

// 5. Main Initialization Function
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize Local Database
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
    ).expect("Failed to create tables");

    let python_stdin = Arc::new(Mutex::new(None));
    let python_stdin_clone = Arc::clone(&python_stdin);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            db: Mutex::new(conn),
            python_stdin,
        })
        .setup(move |app| {
            let app_handle = app.handle().clone();
            
            // Spawn the Python process (adjust the path if necessary for your environment)
            let mut child = Command::new("python")
                .arg("src-python/main.py")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .expect("Failed to start Python engine");

            // Capture stdin so we can send commands later
            let stdin = child.stdin.take().expect("Failed to open Python stdin");
            *python_stdin_clone.lock().unwrap() = Some(stdin);

            // Thread to read Python's stdout and send it to React
            let stdout = child.stdout.take().expect("Failed to open Python stdout");
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(content) = line {
                        println!("[PYTHON STDOUT] {}", content);
                        // Emit the event to the Frontend
                        app_handle.emit("python-event", content).unwrap();
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_meeting, 
            get_meetings, 
            send_command_to_python
        ])
        .run(tauri::generate_context!())
        .expect("Error while running tauri application");
}