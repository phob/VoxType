// Synthetic dictation corpus for the silence/pause E2E test.
//
// Every fixture is built from TTS sentences mixed over a room-noise floor at the levels measured on
// real VoxType recordings (speech P90 about -32 dBFS, noise floor about -60 dBFS), rendered at 48 kHz
// so the native resampler is exercised exactly like live capture.
//
// Failure modes each fixture targets (written before the fix, see planning/decisions.md):
//  F1  pauses longer than the preserved-pause window clip the word before the pause
//  F2  the end of the recording clips the final word (no trailing flush)
//  F3  energy-based silence removal deletes real speech when the voice is quiet
//  F4  a fully "quiet" recording collapses to its first second
//  F5  clicks / coughs / breaths during a pause are treated as speech and invite hallucinations
//  F6  long silence reaches Whisper and produces invented or repeated text
//  F7  dictations longer than 30 s loop through Whisper's rolling context
//  F8  non-speech annotations ([BLANK_AUDIO], (music) ...) leak into the transcript
//  F9  the dictionary prompt is echoed into the transcript on silent audio
//  F10 a recording without speech still produces text
//  F11 a genuinely dictated "Thank you." is filtered as a hallucination
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const FIXTURE_SAMPLE_RATE = 48_000;

const SPEECH_P90_DBFS = -32;
const ROOM_NOISE_DBFS = -60;
const LEAD_IN_MS = 600;
const TAIL_MS = 600;
const VOICES = ["Microsoft Zira Desktop", "Microsoft David Desktop"];

type NoiseEvent = { kind: "click" | "cough" | "breath"; atMs: number } | { kind: "typing"; atMs: number; durationMs: number };
type Part =
  | { kind: "speech"; text: string; voice?: number; gainDb?: number }
  | { kind: "pause"; ms: number; events?: NoiseEvent[] };

export interface FixtureSpec {
  id: string;
  targets: string[];
  parts: Part[];
  speechGainDb?: number;
  tailMs?: number;
  promptTerms?: string[];
  expectSpeech: boolean;
  maxWer: number;
  mustContain?: string[];
  /** Expected to fail for a documented reason outside this pipeline; reported, not counted. */
  knownIssue?: string;
}

export interface Fixture extends FixtureSpec {
  path: string;
  reference: string;
  durationMs: number;
}

const S = {
  report: "Please send the updated report to the whole team before the meeting starts.",
  release: "I think we should move the release to next week because the testing is not finished.",
  microphone: "Remember to check the microphone settings and restart the application afterwards.",
  customer: "The customer asked whether the new version also supports offline dictation.",
  process: "Let me know if you have any questions about the process.",
  budget: "We also need a short summary of the budget for the board.",
  prompt: "Open VoxType and select the Parakeet model in the settings.",
  thanks: "Thank you.",
  yes: "Yes, please."
};

const PARAGRAPH = [
  "Good morning everyone and thank you for joining the weekly planning call.",
  "Today we want to review the open issues from the last sprint and decide what comes next.",
  "The design team finished the new onboarding screens and they are ready for review.",
  "Engineering is still working on the performance problems in the search feature.",
  "Support reported that several customers could not export their data on Friday.",
  "We should prioritize that problem because it blocks important workflows.",
  "Marketing would like to announce the new features at the end of the month.",
  "Please add your comments to the shared document before tomorrow afternoon."
];

const speech = (text: string, voice = 0, gainDb = 0): Part => ({ kind: "speech", text, voice, gainDb });
const pause = (ms: number, events?: NoiseEvent[]): Part => ({ kind: "pause", ms, events });
const twoSentencesWithPause = (ms: number): Part[] => [speech(S.release), pause(ms), speech(S.microphone, 1)];

export const FIXTURES: FixtureSpec[] = [
  { id: "short", targets: ["baseline"], parts: [speech(S.report)], expectSpeech: true, maxWer: 0.05 },
  { id: "pause-3s", targets: ["F1"], parts: twoSentencesWithPause(3_000), expectSpeech: true, maxWer: 0.05 },
  { id: "pause-10s", targets: ["F1", "F6"], parts: twoSentencesWithPause(10_000), expectSpeech: true, maxWer: 0.05 },
  { id: "pause-30s", targets: ["F1", "F6"], parts: [speech(S.customer), pause(30_000), speech(S.process, 1)], expectSpeech: true, maxWer: 0.05 },
  { id: "pause-90s", targets: ["F1", "F6"], parts: [speech(S.report), pause(90_000), speech(S.budget, 1)], expectSpeech: true, maxWer: 0.05 },
  { id: "quiet-10db", targets: ["F3"], parts: twoSentencesWithPause(10_000), speechGainDb: -10, expectSpeech: true, maxWer: 0.05 },
  { id: "quiet-15db", targets: ["F3", "F4"], parts: twoSentencesWithPause(10_000), speechGainDb: -15, expectSpeech: true, maxWer: 0.05 },
  { id: "quiet-20db", targets: ["F3", "F4"], parts: twoSentencesWithPause(10_000), speechGainDb: -20, expectSpeech: true, maxWer: 0.15 },
  {
    id: "noise-in-pause",
    targets: ["F5", "F6"],
    parts: [
      speech(S.release),
      pause(20_000, [
        { kind: "click", atMs: 4_000 },
        { kind: "click", atMs: 9_000 },
        { kind: "cough", atMs: 13_000 },
        { kind: "breath", atMs: 16_500 }
      ]),
      speech(S.microphone, 1)
    ],
    expectSpeech: true,
    maxWer: 0.05
  },
  { id: "hard-stop", targets: ["F2"], parts: [speech(S.process)], tailMs: 40, expectSpeech: true, maxWer: 0.05, mustContain: ["process"] },
  {
    id: "long-45s",
    targets: ["F7"],
    parts: PARAGRAPH.flatMap((text, index) => [speech(text, index % 2), pause(600)]).slice(0, -1),
    expectSpeech: true,
    maxWer: 0.05
  },
  {
    id: "long-with-pauses",
    targets: ["F1", "F6", "F7"],
    parts: PARAGRAPH.flatMap((text, index) => [speech(text, index % 2), pause(index % 3 === 2 ? 8_000 : 2_500)]).slice(0, -1),
    expectSpeech: true,
    maxWer: 0.05
  },
  {
    id: "silence-only",
    targets: ["F10", "F5"],
    parts: [pause(12_000, [{ kind: "click", atMs: 3_000 }, { kind: "breath", atMs: 7_000 }])],
    expectSpeech: false,
    maxWer: 0
  },
  {
    id: "prompt-echo",
    targets: ["F9", "F6"],
    parts: [speech(S.prompt), pause(20_000)],
    promptTerms: ["VoxType", "Parakeet", "Silero", "whisper.cpp"],
    expectSpeech: true,
    maxWer: 0.05,
    mustContain: ["VoxType", "Parakeet"],
    knownIssue: "a prompt only biases spelling; exact casing of dictionary terms needs token biasing (planned)"
  },
  {
    id: "typing-in-pause",
    targets: ["F5", "F6"],
    parts: [speech(S.release), pause(15_000, [{ kind: "typing", atMs: 3_000, durationMs: 8_000 }]), speech(S.microphone, 1)],
    expectSpeech: true,
    maxWer: 0.05
  },
  {
    id: "trailing-off",
    targets: ["F2", "F3"],
    parts: [speech(S.customer), pause(1_500), speech(S.process, 1, -12)],
    expectSpeech: true,
    maxWer: 0.05,
    mustContain: ["process"]
  },
  {
    id: "soft-long-pauses",
    targets: ["F1", "F3", "F6", "F7"],
    parts: PARAGRAPH.flatMap((text, index) => [speech(text, index % 2), pause(index % 3 === 2 ? 12_000 : 3_000)]).slice(0, -1),
    speechGainDb: -12,
    expectSpeech: true,
    maxWer: 0.05
  },
  {
    id: "breath-only",
    targets: ["F10", "F5"],
    parts: [pause(8_000, [{ kind: "breath", atMs: 2_000 }, { kind: "breath", atMs: 5_500 }])],
    expectSpeech: false,
    maxWer: 0
  },
  { id: "cough-only", targets: ["F10", "F5"], parts: [pause(8_000, [{ kind: "cough", atMs: 3_000 }])], expectSpeech: false, maxWer: 0 },
  { id: "typing-only", targets: ["F10", "F5"], parts: [pause(10_000, [{ kind: "typing", atMs: 1_000, durationMs: 7_000 }])], expectSpeech: false, maxWer: 0 },
  { id: "short-yes", targets: ["F11"], parts: [speech(S.yes)], expectSpeech: true, maxWer: 0.05, mustContain: ["yes"] },
  { id: "closing-thanks", targets: ["F11"], parts: [speech(S.budget), pause(2_000), speech(S.thanks, 1)], expectSpeech: true, maxWer: 0.05, mustContain: ["thank you"] }
];

export function buildCorpus(outDir: string, only?: string[]): Fixture[] {
  const ttsDir = join(outDir, "tts-cache");
  const fixtureDir = join(outDir, "fixtures");
  mkdirSync(ttsDir, { recursive: true });
  mkdirSync(fixtureDir, { recursive: true });

  const specs = FIXTURES.filter((spec) => !only?.length || only.includes(spec.id));
  const speechParts = specs.flatMap((spec) => spec.parts.filter((part) => part.kind === "speech"));
  renderTts(ttsDir, speechParts);

  return specs.map((spec) => {
    const samples = mixFixture(spec, ttsDir);
    const path = join(fixtureDir, `${spec.id}.wav`);
    writeFileSync(path, encodeWav(samples, FIXTURE_SAMPLE_RATE));

    return {
      ...spec,
      path,
      reference: spec.parts.flatMap((part) => (part.kind === "speech" ? [part.text] : [])).join(" "),
      durationMs: Math.round((samples.length / FIXTURE_SAMPLE_RATE) * 1000)
    };
  });
}

function ttsPath(ttsDir: string, part: Extract<Part, { kind: "speech" }>): string {
  const voice = VOICES[(part.voice ?? 0) % VOICES.length];
  const hash = createHash("sha1").update(`${voice}\n${part.text}`).digest("hex").slice(0, 16);
  return join(ttsDir, `${hash}.wav`);
}

function renderTts(ttsDir: string, parts: Part[]): void {
  const jobs = new Map<string, { text: string; voice: string; path: string }>();

  for (const part of parts) {
    if (part.kind !== "speech") {
      continue;
    }
    const path = ttsPath(ttsDir, part);
    if (!existsSync(path)) {
      jobs.set(path, { text: part.text, voice: VOICES[(part.voice ?? 0) % VOICES.length], path });
    }
  }

  if (jobs.size === 0) {
    return;
  }

  const jobsPath = join(ttsDir, "jobs.json");
  writeFileSync(jobsPath, JSON.stringify([...jobs.values()]));
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve("scripts/e2e-dictation/tts.ps1"), jobsPath], {
    stdio: "inherit"
  });
}

function mixFixture(spec: FixtureSpec, ttsDir: string): Float32Array {
  const random = mulberry32(hashSeed(spec.id));
  const segments: Array<{ at: number; samples: Float32Array }> = [];
  const events: Array<{ at: number; event: NoiseEvent }> = [];
  let cursor = msToSamples(LEAD_IN_MS);

  for (const part of spec.parts) {
    if (part.kind === "speech") {
      const voice = normalizeSpeech(trimDigitalSilence(decodeWav(readFileSync(ttsPath(ttsDir, part)))));
      applyGain(voice, (spec.speechGainDb ?? 0) + (part.gainDb ?? 0));
      segments.push({ at: cursor, samples: voice });
      cursor += voice.length;
    } else {
      for (const event of part.events ?? []) {
        events.push({ at: cursor + msToSamples(event.atMs), event });
      }
      cursor += msToSamples(part.ms);
    }
  }

  const total = cursor + msToSamples(spec.tailMs ?? TAIL_MS);
  const mix = roomNoise(total, random);

  for (const segment of segments) {
    mix.set(segment.samples.map((value, index) => value + mix[segment.at + index]), segment.at);
  }

  for (const { at, event } of events) {
    addNoiseEvent(mix, at, event, random);
  }

  return mix;
}

function roomNoise(length: number, random: () => number): Float32Array {
  const noise = new Float32Array(length);
  let state = 0;

  for (let index = 0; index < length; index += 1) {
    state = 0.96 * state + 0.04 * (random() * 2 - 1);
    noise[index] = state;
  }

  return scaleToRms(noise, ROOM_NOISE_DBFS);
}

function addNoiseEvent(mix: Float32Array, at: number, event: NoiseEvent, random: () => number): void {
  if (event.kind === "typing") {
    // Keystrokes at a typing rhythm: short broadband bursts, -34..-24 dBFS peaks.
    for (let offsetMs = 0; offsetMs < event.durationMs; offsetMs += 90 + random() * 160) {
      const start = at + msToSamples(offsetMs);
      const length = msToSamples(12);
      const peak = dbToGain(-34 + random() * 10);
      for (let index = 0; index < length && start + index < mix.length; index += 1) {
        mix[start + index] += (random() * 2 - 1) * peak * Math.exp(-index / (length / 5));
      }
    }
    return;
  }

  if (event.kind === "click") {
    const length = msToSamples(4);
    for (let index = 0; index < length && at + index < mix.length; index += 1) {
      mix[at + index] += (index % 2 === 0 ? 1 : -1) * dbToGain(-18) * Math.exp(-index / (length / 4));
    }
    return;
  }

  const lengthMs = event.kind === "cough" ? 220 : 450;
  const levelDb = event.kind === "cough" ? -26 : -46;
  const smoothing = event.kind === "cough" ? 0.5 : 0.08;
  const burst = new Float32Array(msToSamples(lengthMs));
  let state = 0;

  for (let index = 0; index < burst.length; index += 1) {
    state = (1 - smoothing) * state + smoothing * (random() * 2 - 1);
    burst[index] = state * Math.sin((Math.PI * index) / burst.length) ** 2;
  }

  scaleToRms(burst, levelDb);
  for (let index = 0; index < burst.length && at + index < mix.length; index += 1) {
    mix[at + index] += burst[index];
  }
}

function normalizeSpeech(samples: Float32Array): Float32Array {
  const frame = msToSamples(100);
  const levels: number[] = [];

  for (let start = 0; start + frame <= samples.length; start += frame) {
    levels.push(rms(samples.subarray(start, start + frame)));
  }

  levels.sort((a, b) => a - b);
  const p90 = levels[Math.floor(0.9 * (levels.length - 1))] ?? 0;

  if (p90 > 0) {
    applyGain(samples, SPEECH_P90_DBFS - 20 * Math.log10(p90));
  }

  return samples;
}

function trimDigitalSilence(samples: Float32Array): Float32Array {
  const threshold = 4 / 32_768;
  let start = 0;
  let end = samples.length;

  while (start < end && Math.abs(samples[start]) <= threshold) {
    start += 1;
  }
  while (end > start && Math.abs(samples[end - 1]) <= threshold) {
    end -= 1;
  }

  return samples.slice(start, end);
}

function scaleToRms(samples: Float32Array, dbfs: number): Float32Array {
  const current = rms(samples);
  if (current > 0) {
    applyGain(samples, dbfs - 20 * Math.log10(current));
  }
  return samples;
}

function applyGain(samples: Float32Array, db: number): void {
  const gain = dbToGain(db);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] *= gain;
  }
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const value of samples) {
    sum += value * value;
  }
  return samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
}

function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

function msToSamples(ms: number): number {
  return Math.round((ms * FIXTURE_SAMPLE_RATE) / 1000);
}

function hashSeed(value: string): number {
  return createHash("sha1").update(value).digest().readUInt32LE(0);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function decodeWav(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;

  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      const samples = new Float32Array(Math.floor(size / 2));
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = view.getInt16(offset + 8 + index * 2, true) / 32_768;
      }
      return samples;
    }
    offset += 8 + size + (size % 2);
  }

  throw new Error("WAV has no data chunk.");
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const output = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(output.buffer);
  const ascii = (at: number, text: string) => [...text].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));

  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, Math.round(value * 32_767), true);
  }

  return output;
}
