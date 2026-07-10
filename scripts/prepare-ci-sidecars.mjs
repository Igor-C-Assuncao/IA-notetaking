// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import fs from "node:fs";
import path from "node:path";

if (process.env.CI !== "true") {
  console.log("[sidecar-ci] Not running in CI; no placeholders created.");
  process.exit(0);
}

const targetTriple = {
  win32: "x86_64-pc-windows-msvc.exe",
  darwin: process.arch === "arm64"
    ? "aarch64-apple-darwin"
    : "x86_64-apple-darwin",
  linux: "x86_64-unknown-linux-gnu",
}[process.platform];

if (!targetTriple) {
  throw new Error(`Unsupported CI platform: ${process.platform}`);
}

const binariesDir = path.resolve("src-tauri", "binaries");
fs.mkdirSync(binariesDir, { recursive: true });

for (const baseName of ["audio-tap", "ai-notetaking-engine"]) {
  const filePath = path.join(binariesDir, `${baseName}-${targetTriple}`);
  if (!fs.existsSync(filePath)) {
    fs.closeSync(fs.openSync(filePath, "w"));
    console.log(`[sidecar-ci] Created placeholder ${filePath}`);
  }
}
