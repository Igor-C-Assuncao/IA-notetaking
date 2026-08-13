// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function match(path, expression) {
  const value = read(path).match(expression)?.[1];
  if (!value) throw new Error(`Could not read a version from ${path}`);
  return value;
}

const packageVersion = JSON.parse(read("package.json")).version;
const versions = {
  "package.json": packageVersion,
  "src-tauri/Cargo.toml": match("src-tauri/Cargo.toml", /^version\s*=\s*"([^"]+)"/m),
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
  "pyproject.toml": match("pyproject.toml", /^version\s*=\s*"([^"]+)"/m),
  "CITATION.cff": match("CITATION.cff", /^version:\s*([^\s]+)$/m),
};

const mismatches = Object.entries(versions).filter(([, version]) => version !== packageVersion);
if (mismatches.length) {
  throw new Error(
    `Release version mismatch; package.json is ${packageVersion}, but ${mismatches
      .map(([path, version]) => `${path} is ${version}`)
      .join(", ")}.`,
  );
}

const releaseTag = process.env.RELEASE_TAG;
if (releaseTag && !new RegExp(`^v${packageVersion}(?:-(?:rc|beta)\\.\\d+)?$`).test(releaseTag)) {
  throw new Error(`Release tag ${releaseTag} must match v${packageVersion} or its rc/beta variant.`);
}

console.log(`[release-version] All release manifests use ${packageVersion}.`);
