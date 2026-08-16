// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import fs from "node:fs";
import path from "node:path";

const targetTriple = {
  win32: "windows-x64-cpu.zip",
  darwin: process.arch === "arm64"
    ? "aarch64-apple-darwin"
    : "x86_64-apple-darwin",
  linux: "x86_64-unknown-linux-gnu",
}[process.platform];

if (!targetTriple) {
  throw new Error(`Unsupported packaging platform: ${process.platform}`);
}

const sidecarPath = process.platform === "darwin"
  ? path.resolve("src-python", "dist", "ai-notetaking-engine", "ai-notetaking-engine")
  : path.resolve("src-tauri", "binaries", `ai-notetaking-engine-${targetTriple}`);
const maxSizeMiB = Number(process.env.SIDECAR_MAX_MIB || 1536);
const allowMissing = process.env.SIDECAR_CHECK_ALLOW_MISSING === "1" ||
  process.env.SIDECAR_DOWNLOAD_AT_RUNTIME === "1";

let size = 0;
try {
  size = fs.statSync(sidecarPath).size;
} catch {
  // Report a single actionable error below.
}

if (size === 0) {
  if (allowMissing) {
    console.warn(
      `[sidecar-check] Skipping missing sidecar in smoke build: ${sidecarPath}`,
    );
    process.exit(0);
  }

  console.error(
    `[sidecar-check] Missing or empty Python sidecar: ${sidecarPath}\n` +
    "Build the PyInstaller onedir artifact before running a Tauri package build.",
  );
  process.exit(1);
}

const sizeMiB = size / 1024 / 1024;
if (sizeMiB > maxSizeMiB) {
  console.error(
    `[sidecar-check] Python sidecar is ${sizeMiB.toFixed(1)} MiB; ` +
    `release budget is ${maxSizeMiB} MiB.\n` +
    "Build the CPU release profile with scripts/build-windows-sidecar.ps1.",
  );
  process.exit(1);
}

console.log(`[sidecar-check] Validated ${sidecarPath} (${sizeMiB.toFixed(1)} MiB).`);
