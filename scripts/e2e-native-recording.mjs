// End-to-end check of the native recording pipeline (capture -> resample -> VAD -> WAV).
// Records a few seconds from the real microphone through every capture path the app uses and
// writes metrics only (recorded audio is deleted) to native/windows-helper/target/e2e/report.json.
//
// Failure modes covered:
//  1. helper exits non-zero or reports an error at runtime
//  2. 16 kHz resampler produces the wrong sample ratio
//  3. resampler silently produces no output
//  4. 24 kHz realtime resampler produces the wrong sample ratio
//  5. WAV header / sample count disagrees with the reported metadata
//  6. output is digital silence or garbage (NaN / pinned at full scale)
//  7. warm session breaks on a second start/stop or never answers stop
//  8. saved input device name no longer selects the device
//  9. exclusive capture path errors instead of recording or falling back
// 10. VAD trims or splices audio instead of keeping the full recording
// 11. VAD probabilities are missing or do not line up with the recorded frames
//
// Usage: node scripts/e2e-native-recording.mjs [--seconds 3]
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const secondsArgIndex = process.argv.indexOf("--seconds");
const recordMs = Math.round(Number(secondsArgIndex > 0 ? process.argv[secondsArgIndex + 1] : 3) * 1000);
const helperPath =
  process.env.VOXTYPE_WINDOWS_HELPER_PATH ??
  resolve("native/windows-helper/target/release/voxtype-windows-helper.exe");
const vadModelPath = resolve("resources/models/silero_vad_v4.onnx");
const outDir = resolve("native/windows-helper/target/e2e");
const vadArgs = ["--vad-model", vadModelPath];
const timeoutMs = recordMs + 15_000;

await mkdir(outDir, { recursive: true });

const devices = JSON.parse(execFileSync(helperPath, ["input-devices"], { encoding: "utf8" }));
const defaultDevice = devices.find((device) => device.isDefault) ?? devices[0];

if (!defaultDevice) {
  throw new Error("No input device found; this test needs a microphone.");
}

const cases = [
  { name: "shared, no VAD, realtime pcm16", command: "record-wav", args: ["--capture-mode", "shared", "--emit-realtime-pcm16"] },
  { name: "shared, VAD", command: "record-wav", args: ["--capture-mode", "shared", ...vadArgs] },
  { name: "shared, saved device name", command: "record-wav", args: ["--capture-mode", "shared", "--input-device", defaultDevice.name] },
  { name: "exclusive-preferred, VAD", command: "record-wav", args: ["--capture-mode", "exclusive-preferred", ...vadArgs] },
  { name: "exclusive-preferred, realtime pcm16", command: "record-wav", args: ["--capture-mode", "exclusive-preferred", "--emit-realtime-pcm16"] },
  { name: "warm session, VAD, two recordings", command: "record-wav-session", args: ["--capture-mode", "shared", ...vadArgs], recordings: 2 }
];

const results = [];

for (const testCase of cases) {
  const recordings =
    testCase.command === "record-wav-session"
      ? await runSessionCase(testCase)
      : [await runLegacyCase(testCase)];

  for (const [index, recording] of recordings.entries()) {
    const label = recordings.length > 1 ? `${testCase.name} #${String(index + 1)}` : testCase.name;
    results.push({ case: label, ...recording, checks: evaluate(recording, testCase) });
  }
}

const passed = results.every((result) => result.checks.every((check) => check.pass));
const report = {
  generatedAt: new Date().toISOString(),
  gitCommit: tryGit(["rev-parse", "HEAD"]),
  gitDirty: tryGit(["status", "--porcelain"]) !== "",
  helperPath,
  recordMs,
  devices,
  passed,
  results
};
const reportPath = join(outDir, "report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

for (const result of results) {
  const failed = result.checks.filter((check) => !check.pass);
  console.log(`${failed.length === 0 ? "PASS" : "FAIL"}  ${result.case}  (${result.captureMode ?? "?"})`);
  for (const check of failed) {
    console.log(`      - ${check.name}: ${check.detail}`);
  }
}
console.log(`\nReport: ${reportPath}`);
process.exit(passed ? 0 : 1);

function evaluate(recording, testCase) {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });
  const vadEnabled = testCase.args.includes("--vad-model");

  add("helper ok", recording.error === null, recording.error ?? "no error");
  if (recording.error !== null) {
    return checks;
  }

  const rateRatio = recording.rawSamples / 16_000 / (recording.measuredMs / 1000);
  add("16 kHz output rate", rateRatio > 0.9 && rateRatio < 1.15, `raw samples / wall time = ${rateRatio.toFixed(3)} x 16 kHz`);
  add("resampler produced audio", recording.rawSamples > 0, `${String(recording.rawSamples)} raw samples`);
  add("wav matches metadata", recording.wav.sampleRate === 16_000 && recording.wav.channels === 1 && recording.wav.samples === recording.samples, JSON.stringify(recording.wav));

  // The final partial VAD frame (512 samples) is zero-padded, so allow up to one frame extra.
  const padding = recording.samples - recording.rawSamples;
  add("full recording kept", padding >= 0 && padding < 512, `${String(recording.samples)} written for ${String(recording.rawSamples)} captured`);
  add("audio is live, not digital silence", recording.wav.rmsDbfs > -100, `rms ${recording.wav.rmsDbfs.toFixed(1)} dBFS`);
  add("audio is not garbage", recording.wav.finite && recording.wav.fullScaleFraction < 0.01, `full-scale fraction ${recording.wav.fullScaleFraction.toFixed(4)}`);

  if (vadEnabled) {
    add(
      "one VAD probability per frame",
      recording.vadFrameSamples === 512 && recording.vadFrames === Math.ceil(recording.samples / 512),
      `${String(recording.vadFrames)} probabilities, ${String(Math.ceil(recording.samples / (recording.vadFrameSamples || 1)))} frames of ${String(recording.vadFrameSamples)} (rounded up)`
    );
  }

  if (testCase.args.includes("--emit-realtime-pcm16")) {
    const realtimeRatio = recording.realtimeSamples / (recording.rawSamples * 1.5);
    add("24 kHz realtime rate", realtimeRatio > 0.97 && realtimeRatio < 1.03, `realtime samples / (raw x 1.5) = ${realtimeRatio.toFixed(4)}`);
  }

  return checks;
}

async function runLegacyCase(testCase) {
  const outputPath = join(outDir, `${slug(testCase.name)}.wav`);
  const child = spawn(helperPath, [testCase.command, outputPath, ...testCase.args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const reader = lineReader(child);

  try {
    await reader.waitFor((event) => event.type === "recordingLevel", timeoutMs, "first audio level");
    const startedAt = performance.now();
    await sleep(recordMs);
    const measuredMs = performance.now() - startedAt;
    child.stdin.end("stop\n");
    const metadata = await reader.waitFor(isMetadata, timeoutMs, "recording metadata");
    const exitCode = await new Promise((resolveExit) => child.once("close", resolveExit));
    return await collect(metadata, measuredMs, reader, exitCode === 0 ? null : `exit code ${String(exitCode)}`, outputPath);
  } catch (error) {
    child.kill();
    return failure(error, reader);
  }
}

async function runSessionCase(testCase) {
  const child = spawn(helperPath, [testCase.command, ...testCase.args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const reader = lineReader(child);
  const recordings = [];

  try {
    await reader.waitFor((event) => event.type === "recordingReady", timeoutMs, "session ready");

    for (let index = 0; index < testCase.recordings; index += 1) {
      const outputPath = join(outDir, `${slug(testCase.name)}-${String(index + 1)}.wav`);
      reader.reset();
      child.stdin.write(`${JSON.stringify({ type: "start", outputPath })}\n`);
      await reader.waitFor((event) => event.type === "recordingLevel", timeoutMs, "first audio level");
      const startedAt = performance.now();
      await sleep(recordMs);
      const measuredMs = performance.now() - startedAt;
      child.stdin.write(`${JSON.stringify({ type: "stop" })}\n`);
      const metadata = await reader.waitFor(
        (event) => isMetadata(event) || event.type === "recordingError",
        timeoutMs,
        "recording metadata"
      );
      const error = metadata.type === "recordingError" ? metadata.error : null;
      recordings.push(await collect(metadata, measuredMs, reader, error, outputPath));
    }

    child.stdin.end(`${JSON.stringify({ type: "shutdown" })}\n`);
    await new Promise((resolveExit) => child.once("close", resolveExit));
  } catch (error) {
    child.kill();
    recordings.push(failure(error, reader));
  }

  return recordings;
}

async function collect(metadata, measuredMs, reader, error, outputPath) {
  const wav = error === null ? await analyzeWav(outputPath) : null;
  await rm(outputPath, { force: true });

  return {
    error,
    captureMode: metadata.captureMode ?? null,
    measuredMs: Math.round(measuredMs),
    rawSamples: metadata.rawSamples ?? 0,
    samples: metadata.samples ?? 0,
    speechFrames: metadata.speechFrames ?? 0,
    vadFrameSamples: metadata.vadFrameSamples ?? 0,
    vadFrames: typeof metadata.vadProbabilities === "string" ? Buffer.from(metadata.vadProbabilities, "base64").byteLength : 0,
    realtimeSamples: reader.realtimeBytes / 2,
    wav,
    stderr: reader.stderr().trim() || null
  };
}

function failure(error, reader) {
  return {
    error: error instanceof Error ? error.message : String(error),
    stderr: reader.stderr().trim() || null
  };
}

async function analyzeWav(path) {
  const bytes = await readFile(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let format = null;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= bytes.byteLength) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      format = { channels: view.getUint16(offset + 10, true), sampleRate: view.getUint32(offset + 12, true) };
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }

  const samples = Math.floor(dataSize / 2);
  let squareSum = 0;
  let fullScale = 0;

  for (let index = 0; index < samples; index += 1) {
    const value = view.getInt16(dataOffset + index * 2, true);
    squareSum += (value / 32768) ** 2;
    if (value === 32767 || value === -32768) {
      fullScale += 1;
    }
  }

  const rms = samples > 0 ? Math.sqrt(squareSum / samples) : 0;

  return {
    sampleRate: format?.sampleRate ?? 0,
    channels: format?.channels ?? 0,
    samples,
    rmsDbfs: rms > 0 ? 20 * Math.log10(rms) : -120,
    finite: Number.isFinite(rms),
    fullScaleFraction: samples > 0 ? fullScale / samples : 0
  };
}

function lineReader(child) {
  let remainder = "";
  let events = [];
  let waiter = null;
  const stderrChunks = [];
  const state = {
    realtimeBytes: 0,
    reset() {
      events = [];
      state.realtimeBytes = 0;
    },
    stderr: () => Buffer.concat(stderrChunks).toString("utf8"),
    waitFor(predicate, ms, what) {
      const found = events.find(predicate);
      if (found) {
        events = events.filter((event) => event !== found);
        return Promise.resolve(found);
      }
      return new Promise((resolveWait, rejectWait) => {
        const timer = setTimeout(() => {
          waiter = null;
          rejectWait(new Error(`Timed out waiting for ${what}. stderr: ${state.stderr().trim()}`));
        }, ms);
        waiter = { predicate, resolve: (event) => { clearTimeout(timer); resolveWait(event); }, reject: rejectWait, timer };
      });
    }
  };

  child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
  child.once("close", (code) => {
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`Helper exited with code ${String(code)}. stderr: ${state.stderr().trim()}`));
      waiter = null;
    }
  });
  child.stdout.on("data", (chunk) => {
    const lines = `${remainder}${chunk.toString("utf8")}`.split(/\r?\n/);
    remainder = lines.pop() ?? "";
    for (const line of lines.map((item) => item.trim()).filter(Boolean)) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "realtimePcm16Chunk") {
        state.realtimeBytes += Buffer.from(event.audioBase64, "base64").byteLength;
        continue;
      }
      if (waiter?.predicate(event)) {
        const current = waiter;
        waiter = null;
        current.resolve(event);
      } else if (event.type !== "recordingLevel") {
        events.push(event);
      } else if (!events.some((item) => item.type === "recordingLevel")) {
        events.push(event);
      }
    }
  });

  return state;
}

function isMetadata(event) {
  return typeof event.sampleRate === "number" && typeof event.rawSamples === "number";
}

function slug(value) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function tryGit(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}
