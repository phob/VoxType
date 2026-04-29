#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const usage = `Usage: node scripts/sync-release-version.mjs <version> [--root <path>] [--check] [--dry-run]

Updates VoxType release version files:
- package.json
- package-lock.json
- native/windows-helper/Cargo.toml
- native/windows-helper/Cargo.lock`;

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    version: null,
    root: process.cwd(),
    check: false,
    dryRun: false,
  };

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--root") {
      const value = args.shift();
      if (!value) throw new Error("--root requires a path.");
      options.root = resolve(value);
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg?.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.version) {
      options.version = arg ?? null;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.version) throw new Error("Missing version.");
  options.version = options.version.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(options.version)) {
    throw new Error(`Invalid stable release version: ${options.version}`);
  }

  return options;
}

function readText(root, relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function writeText(root, relativePath, value, options) {
  if (!options.dryRun && !options.check) {
    writeFileSync(resolve(root, relativePath), value, "utf8");
  }
}

function updateJsonVersion(root, relativePath, version, options) {
  const raw = readText(root, relativePath);
  const json = JSON.parse(raw);
  if (json.version === version) {
    return false;
  }

  const next = { ...json, version };
  const output = `${JSON.stringify(next, null, 2)}\n`;
  writeText(root, relativePath, output, options);
  return true;
}

function updatePackageLock(root, version, options) {
  const relativePath = "package-lock.json";
  const raw = readText(root, relativePath);
  const lock = JSON.parse(raw);
  const rootPackage = lock.packages?.[""];
  if (lock.version === version && rootPackage?.version === version) {
    return false;
  }

  lock.version = version;
  if (rootPackage) {
    rootPackage.version = version;
  }

  const output = `${JSON.stringify(lock, null, 2)}\n`;
  writeText(root, relativePath, output, options);
  return true;
}

function replaceRequired(raw, pattern, replacement, label) {
  if (!pattern.test(raw)) {
    throw new Error(`Could not find ${label}.`);
  }
  return raw.replace(pattern, replacement);
}

function updateCargoToml(root, version, options) {
  const relativePath = "native/windows-helper/Cargo.toml";
  const raw = readText(root, relativePath);
  const output = replaceRequired(
    raw,
    /(\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m,
    `$1"${version}"`,
    "Cargo.toml package version",
  );
  const changed = raw !== output;
  writeText(root, relativePath, output, options);
  return changed;
}

function updateCargoLock(root, version, options) {
  const relativePath = "native/windows-helper/Cargo.lock";
  const raw = readText(root, relativePath);
  const output = replaceRequired(
    raw,
    /(\[\[package\]\]\r?\nname = "voxtype-windows-helper"\r?\nversion = )"[^"]+"/,
    `$1"${version}"`,
    "Cargo.lock voxtype-windows-helper package version",
  );
  const changed = raw !== output;
  writeText(root, relativePath, output, options);
  return changed;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const changes = [
    ["package.json", updateJsonVersion(options.root, "package.json", options.version, options)],
    ["package-lock.json", updatePackageLock(options.root, options.version, options)],
    ["native/windows-helper/Cargo.toml", updateCargoToml(options.root, options.version, options)],
    ["native/windows-helper/Cargo.lock", updateCargoLock(options.root, options.version, options)],
  ];

  const changedFiles = changes.filter(([, changed]) => changed).map(([file]) => file);
  if (options.check && changedFiles.length > 0) {
    console.error(`Version files are not synchronized to ${options.version}:`);
    for (const file of changedFiles) console.error(`- ${file}`);
    process.exit(1);
  }

  if (changedFiles.length === 0) {
    console.log(`All release version files already use ${options.version}.`);
  } else {
    const mode = options.dryRun || options.check ? "Would update" : "Updated";
    console.log(`${mode} release version to ${options.version}:`);
    for (const file of changedFiles) console.log(`- ${file}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage);
  process.exit(1);
}
