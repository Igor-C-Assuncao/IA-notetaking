// src-tauri/src/lib.rs
use std::io::{BufRead, BufReader, Write}; // <-- Added Write
use std::process::{Command, Stdio, ChildStdin}; // <-- Added ChildStdin
use std::sync::Mutex; // <-- Added Mutex to share stdin
use std::thread;
use tauri::{Emitter, Manager};

// ------------------------------------------------------------------------
// NEW: Exposed command for React to call and send text to Python
// ------------------------------------------------------------------------
#[tauri::command]
fn send_command_to_python(payload: String, stdin_state: tauri::State<'_, Mutex<ChildStdin>>) {
    // Tries to access Python's stdin handle
    if let Ok(mut stdin) = stdin_state.lock() {
        println!("[RUST DEBUG] React mandou enviar: {}", payload);
        // Writes the message and appends a newline (\n),
        // because Python is reading line by line (for line in sys.stdin)
        if let Err(e) = writeln!(stdin, "{}", payload) {
            println!("[RUST DEBUG] Erro ao escrever no stdin: {}", e);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Registers the command so React can use it
        .invoke_handler(tauri::generate_handler![send_command_to_python]) 
        .setup(|app| {
            let app_handle = app.handle().clone();
            let app_handle_err = app.handle().clone(); 

            let mut child = Command::new("python")
                .arg("../src-python/main.py")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("FALHA CRÍTICA");

            // ------------------------------------------------------------------------
            // NEW: Stores STDIN in the app global state so the React button can access it
            // ------------------------------------------------------------------------
            let stdin = child.stdin.take().unwrap();
            app.manage(Mutex::new(stdin));

            let stdout = child.stdout.take().unwrap();
            let stderr = child.stderr.take().unwrap(); 

            // Thread 1: Listens to STDOUT (normal logs)
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(msg) = line {
                        println!("[PYTHON STDOUT] {}", msg); 
                        app_handle.emit("python-event", msg).unwrap(); 
                    }
                }
            });

            // Thread 2: Listens to STDERR (errors)
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(err_msg) = line {
                        println!("[PYTHON STDERR] {}", err_msg); 
                        let safe_msg = err_msg.replace("\"", "\\\"");
                        let json_err = format!(r#"{{"event": "ERROR", "data": {{"message": "[Python Error]: {}"}}}}"#, safe_msg);
                        
                        if !err_msg.starts_with("DEBUG:") {
                            app_handle_err.emit("python-event", json_err).unwrap();
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}