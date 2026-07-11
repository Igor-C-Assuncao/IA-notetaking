// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import fs from "node:fs";
import path from "node:path";

const [inputArg, chunkSizeArg = "1900000000"] = process.argv.slice(2);
if (!inputArg) {
  console.error("Usage: node scripts/split-engine-release-asset.mjs <file> [chunk-size-bytes]");
  process.exit(1);
}

const inputPath = path.resolve(inputArg);
const chunkSize = Number(chunkSizeArg);
const size = fs.statSync(inputPath).size;
if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
  throw new Error(`Invalid chunk size: ${chunkSizeArg}`);
}
if (size <= chunkSize) {
  console.log(`[engine-split] ${path.basename(inputPath)} fits in one GitHub asset (${size} bytes).`);
  process.exit(0);
}

const input = fs.openSync(inputPath, "r");
const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
let offset = 0;
let part = 1;
try {
  while (offset < size) {
    const outputPath = `${inputPath}.part${String(part).padStart(2, "0")}`;
    const output = fs.openSync(outputPath, "w");
    let written = 0;
    try {
      while (written < chunkSize && offset < size) {
        const requested = Math.min(buffer.length, chunkSize - written, size - offset);
        const read = fs.readSync(input, buffer, 0, requested, offset);
        if (read === 0) break;
        fs.writeSync(output, buffer, 0, read);
        written += read;
        offset += read;
      }
    } finally {
      fs.closeSync(output);
    }
    console.log(`[engine-split] Wrote ${path.basename(outputPath)} (${written} bytes).`);
    part += 1;
  }
} finally {
  fs.closeSync(input);
}
