// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const binariesDir = path.resolve(repoRoot, "src-tauri", "binaries");
const pythonDist = path.resolve(repoRoot, "src-python", "dist");
const releaseBase = process.env.ENGINE_RELEASE_BASE ||
  "https://github.com/Igor-C-Assuncao/IA-notetaking/releases/download/v0.3.2";
const engineVersion = process.env.ENGINE_VERSION || process.env.npm_package_version || "0.3.2";
const maxSingleAssetBytes = Number(process.env.ENGINE_MAX_SINGLE_ASSET_BYTES || 1_900_000_000);

const candidates = [
  { kind: "cpu", fileName: "ai-notetaking-engine-windows-x64-cpu.zip" },
  { kind: "gpu", fileName: "ai-notetaking-engine-windows-x64-gpu.zip" },
];

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? walkFiles(absolute) : [absolute];
  }).sort();
}

function directorySize(root) {
  return walkFiles(root).reduce((total, file) => total + fs.statSync(file).size, 0);
}

function directorySha256(root) {
  const hash = crypto.createHash("sha256");
  for (const file of walkFiles(root)) {
    hash.update(path.relative(root, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
  }
  return hash.digest("hex");
}

const unpackedRoot = path.join(pythonDist, "ai-notetaking-engine");
const modelRoot = path.join(unpackedRoot, "models", "whisper");
const unpackedSize = directorySize(unpackedRoot);
const modelFiles = walkFiles(modelRoot);

if (unpackedSize === 0) {
  throw new Error("Missing PyInstaller onedir output at src-python/dist/ai-notetaking-engine");
}
if (modelFiles.length === 0 && process.env.ALLOW_MISSING_BUNDLED_MODEL !== "1") {
  throw new Error("Whisper base is not bundled under models/whisper. Refusing to create a release manifest that could download a model silently at runtime.");
}

const engines = [];
for (const candidate of candidates) {
  const filePath = path.join(binariesDir, candidate.fileName);
  if (!fs.existsSync(filePath)) {
    console.warn(`[engine-manifest] Skipping missing ${candidate.fileName}`);
    continue;
  }
  const stat = fs.statSync(filePath);
  if (stat.size === 0) continue;

  const entry = {
    kind: candidate.kind,
    architecture: "x86_64",
    archive: "zip",
    file_name: candidate.fileName,
    entrypoint: "ai-notetaking-engine.exe",
    compressed_size: stat.size,
    unpacked_size: unpackedSize,
    sha256: sha256(filePath),
    url: `${releaseBase}/${candidate.fileName}`,
    model: {
      name: "base",
      relative_path: "models/whisper",
      sha256: modelFiles.length ? directorySha256(modelRoot) : null,
      size_bytes: directorySize(modelRoot),
    },
  };

  const chunkPaths = fs.readdirSync(binariesDir)
    .filter((name) => name.startsWith(`${candidate.fileName}.part`))
    .sort()
    .map((name) => path.join(binariesDir, name));

  if (stat.size > maxSingleAssetBytes) {
    if (chunkPaths.length === 0) {
      throw new Error(`${candidate.fileName} exceeds the single-asset limit but has no parts`);
    }
    entry.chunks = chunkPaths.map((chunkPath) => ({
      file_name: path.basename(chunkPath),
      size_bytes: fs.statSync(chunkPath).size,
      sha256: sha256(chunkPath),
      url: `${releaseBase}/${path.basename(chunkPath)}`,
    }));
    delete entry.url;
  }
  engines.push(entry);
}

if (engines.length === 0) throw new Error("No engine archives found");

const manifest = {
  schema_version: 2,
  version: engineVersion,
  platform: "windows-x64",
  engines,
};

const outputPath = path.join(binariesDir, "engines-manifest.json");
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[engine-manifest] Wrote ${outputPath}`);
