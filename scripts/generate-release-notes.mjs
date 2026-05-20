#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";

const repo = "phob/VoxType";

const usage = `Usage: bun run changelog [-- <version>]

Generates the GitHub Release notes that would be used if VoxType released now.

Examples:
  bun run changelog
  bun run changelog -- 0.3.8
  bun run changelog -- v0.3.8`;

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function parseVersion(value) {
  const version = value.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid stable release version: ${value}`);
  }
  return version;
}

function nextPatchVersion(tag) {
  const version = parseVersion(tag);
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage);
    process.exit(0);
  }

  if (argv.length > 1) {
    throw new Error(`Unexpected arguments: ${argv.join(" ")}`);
  }

  return argv[0] ? parseVersion(argv[0]) : null;
}

function generateNotes({ previousTag, nextVersion }) {
  const input = JSON.stringify({
    tag_name: `v${nextVersion}`,
    target_commitish: "main",
    previous_tag_name: previousTag,
  });

  const result = spawnSync(
    "gh",
    ["api", `repos/${repo}/releases/generate-notes`, "-X", "POST", "--input", "-"],
    {
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "GitHub release note generation failed.");
  }

  return JSON.parse(result.stdout);
}

try {
  const requestedVersion = parseArgs(process.argv.slice(2));
  const previousTag = run("git", ["describe", "--tags", "--abbrev=0"]);
  const nextVersion = requestedVersion ?? nextPatchVersion(previousTag);
  const notes = generateNotes({ previousTag, nextVersion });

  console.log(`# ${notes.name}`);
  console.log("");
  console.log(notes.body.trim());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("");
  console.error(usage);
  process.exit(1);
}
