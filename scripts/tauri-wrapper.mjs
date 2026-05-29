import { spawn } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const env = { ...process.env };

if (process.platform === 'linux') {
  const vars = [
    ['GTK_PATH', 'GTK_PATH_VSCODE_SNAP_ORIG'],
    ['GTK_EXE_PREFIX', 'GTK_EXE_PREFIX_VSCODE_SNAP_ORIG'],
    ['GTK_IM_MODULE_FILE', 'GTK_IM_MODULE_FILE_VSCODE_SNAP_ORIG'],
    ['GTK_MODULES', 'GTK_MODULES_VSCODE_SNAP_ORIG'],
    ['GTK3_MODULES', 'GTK3_MODULES_VSCODE_SNAP_ORIG'],
    ['GIO_MODULE_DIR', 'GIO_MODULE_DIR_VSCODE_SNAP_ORIG'],
    ['GSETTINGS_SCHEMA_DIR', 'GSETTINGS_SCHEMA_DIR_VSCODE_SNAP_ORIG'],
    ['LOCPATH', 'LOCPATH_VSCODE_SNAP_ORIG'],
    ['XDG_DATA_DIRS', 'XDG_DATA_DIRS_VSCODE_SNAP_ORIG'],
    ['XDG_CONFIG_DIRS', 'XDG_CONFIG_DIRS_VSCODE_SNAP_ORIG'],
    ['XDG_DATA_HOME', 'XDG_DATA_HOME_VSCODE_SNAP_ORIG']
  ];

  for (const [name, origName] of vars) {
    const orig = env[origName];
    if (orig === undefined || orig === '') {
      delete env[name];
    } else {
      env[name] = orig;
    }
  }
}

const tauriBin = process.platform === 'win32'
  ? path.join('node_modules', '.bin', 'tauri.cmd')
  : path.join('node_modules', '.bin', 'tauri');

const child = spawn(tauriBin, args, {
  stdio: 'inherit',
  env,
  shell: false
});

child.on('error', (err) => {
  console.error('[tauri-wrapper] Failed to start Tauri CLI:', err.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
