import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const binariesDir = path.resolve(repoRoot, "src-tauri", "binaries");
const releaseBase = process.env.ENGINE_RELEASE_BASE ||
  "https://github.com/Igor-C-Assuncao/IA-notetaking/releases/download/v0.1.0";
const maxSingleAssetBytes = Number(process.env.ENGINE_MAX_SINGLE_ASSET_BYTES || 2_000_000_000);

const candidates = [
  { kind: "cpu", fileName: "ai-notetaking-engine-windows-x64-cpu.exe" },
  { kind: "gpu", fileName: "ai-notetaking-engine-windows-x64-gpu.exe" },
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

const engines = [];
for (const candidate of candidates) {
  const filePath = path.join(binariesDir, candidate.fileName);
  if (!fs.existsSync(filePath)) {
    console.warn(`[engine-manifest] Skipping missing ${candidate.fileName}`);
    continue;
  }
  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    console.warn(`[engine-manifest] Skipping empty ${candidate.fileName}`);
    continue;
  }
  const entry = {
    kind: candidate.kind,
    file_name: candidate.fileName,
    size_bytes: stat.size,
    sha256: sha256(filePath),
    url: `${releaseBase}/${candidate.fileName}`,
  };

  const chunkPaths = fs
    .readdirSync(binariesDir)
    .filter((name) => name.startsWith(`${candidate.fileName}.part`))
    .sort()
    .map((name) => path.join(binariesDir, name));

  if (stat.size > maxSingleAssetBytes && chunkPaths.length > 0) {
    entry.chunks = chunkPaths.map((chunkPath) => {
      const chunkName = path.basename(chunkPath);
      return {
        file_name: chunkName,
        size_bytes: fs.statSync(chunkPath).size,
        sha256: sha256(chunkPath),
        url: `${releaseBase}/${chunkName}`,
      };
    });
    delete entry.url;
  }

  engines.push(entry);
}

if (engines.length === 0) {
  console.error("[engine-manifest] No engine assets found.");
  process.exit(1);
}

const manifest = {
  version: "0.1.0",
  platform: "windows-x64",
  engines,
};

const outputPath = path.join(binariesDir, "engines-manifest.json");
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[engine-manifest] Wrote ${outputPath}`);
