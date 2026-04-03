// src-tauri/src/lib.rs (or main.rs)
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::thread;
use tauri::Emitter; // Required to emit events in Tauri v2

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Spawn the Python process
            let mut child = Command::new("python")
                .arg("../src-python/main.py")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .expect("Failed to spawn Python engine. Is Python installed and in PATH?");

            let stdout = child.stdout.take().unwrap();

            // Thread to listen to Python stdout without blocking the UI
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(msg) = line {
                        // Emit the raw JSON string to the React frontend
                        app_handle.emit("python-event", msg).unwrap();
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}