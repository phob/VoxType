// E2E dictation test: corpus -> native helper (resample + VAD) -> speech segments -> chunks ->
// local Whisper -> output filter -> scored report. Uses the same modules as the app.
//
// Usage: bun scripts/e2e-dictation/run.ts [--only id,id] [--corpus synthetic|user-history] [--label name]
//        tuning: [--segmentation '{"offsetThreshold":0.25}'] [--chunking '{"maxKeptGapMs":500}']
// Artifacts: native/windows-helper/target/e2e/dictation-<label>.{json,md}; compared against
// dictation-baseline.json (the pre-fix pipeline) when present.
// Needs a release build of the native helper and a downloaded whisper.cpp runtime and model (read
// from the VoxType user data directory or VOXTYPE_WHISPER_CLI / VOXTYPE_WHISPER_MODEL).
//
// --corpus user-history replays your own saved dictations (local only) and scores them against the
// transcript you accepted at the time; that text is not ground truth, so review differences.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodeMonoPcm, defaultSpeechChunking, planSpeechChunks } from "../../src/main/speech-audio";
import { transcribeChunksWithWhisperCli } from "../../src/main/whisper-cli-transcriber";
import { defaultSpeechSegmentation, detectSpeechSegments } from "../../src/shared/speech-segments";
import { buildWhisperPromptContext } from "../../src/shared/prompt-context";
import { buildCorpus, decodeWav, type Fixture } from "./corpus";

interface PipelineResult {
  speechDetected: boolean;
  text: string;
  audioSentMs: number;
  whisperCalls: number;
  chunks: number;
  whisperMs: number;
  totalMs: number;
  notes: string[];
}

interface Report {
  pipeline: string;
  segmentation?: unknown;
  chunking?: unknown;
  generatedAt: string;
  gitCommit: string | null;
  gitDirty: boolean;
  whisperCli: string;
  whisperModel: string;
  passed: number;
  total: number;
  meanWer: number;
  punctuation?: { expected: number; found: number };
  results: Array<PipelineResult & ReturnType<typeof scoreFixture> & { id: string; targets: string[]; durationMs: number; reference: string }>;
}

interface PipelineContext {
  whisperCli: string;
  whisperModel: string;
  vadModel: string;
  workDir: string;
}

const outDir = resolve("native/windows-helper/target/e2e");
const corpus = argValue("--corpus") ?? "synthetic";
const only = argValue("--only")?.split(",").filter(Boolean);
// Tuning overrides, e.g. --segmentation '{"offsetThreshold":0.25}' --label off025
const segmentation = { ...defaultSpeechSegmentation, ...JSON.parse(argValue("--segmentation") ?? "{}") };
const chunking = { ...defaultSpeechChunking, ...JSON.parse(argValue("--chunking") ?? "{}") };
const label = argValue("--label") ?? (corpus === "synthetic" ? "current" : corpus);

async function main(): Promise<void> {
  const context: PipelineContext = {
    whisperCli: resolveWhisperCli(),
    whisperModel: process.env.VOXTYPE_WHISPER_MODEL ?? join(appDataDir(), "models", "ggml-large-v3-turbo.bin"),
    vadModel: resolve("resources/models/silero_vad_v4.onnx"),
    workDir: join(outDir, "work")
  };
  mkdirSync(context.workDir, { recursive: true });

  const fixtures = corpus === "user-history" ? userHistoryCorpus() : buildCorpus(outDir, only);
  const results = [];

  for (const fixture of fixtures) {
    const result = await currentPipeline(fixture, context);
    const score = scoreFixture(fixture, result);
    results.push({ id: fixture.id, targets: fixture.targets, durationMs: fixture.durationMs, reference: fixture.reference, ...result, ...score });
    console.log(`${score.knownIssue ? "KNOWN" : score.pass ? "PASS " : "FAIL "} ${fixture.id.padEnd(18)} WER ${score.wer.toFixed(3)}  ${score.failures.join("; ")}`);
  }

  const report: Report = {
    pipeline: label,
    segmentation,
    chunking,
    generatedAt: new Date().toISOString(),
    gitCommit: tryGit(["rev-parse", "HEAD"]),
    gitDirty: tryGit(["status", "--porcelain"]) !== "",
    whisperCli: context.whisperCli,
    whisperModel: context.whisperModel,
    passed: results.filter((result) => result.pass).length,
    total: results.length,
    meanWer: results.reduce((sum, result) => sum + result.wer, 0) / Math.max(1, results.length),
    punctuation: sumPunctuation(results),
    results
  };
  const reportBase = join(outDir, `dictation-${label}`);
  writeFileSync(`${reportBase}.json`, `${JSON.stringify(report, null, 2)}\n`);
  const baselinePath = join(outDir, "dictation-baseline.json");
  const baseline = corpus === "synthetic" && existsSync(baselinePath) ? (JSON.parse(readFileSync(baselinePath, "utf8")) as Report) : null;
  writeFileSync(`${reportBase}.md`, renderMarkdown(report, baseline));
  process.exitCode = report.passed === report.total ? 0 : 1;
  console.log(`\n${String(report.passed)}/${String(report.total)} passed, mean WER ${report.meanWer.toFixed(3)}, sentence ends ${String(report.punctuation?.found)}/${String(report.punctuation?.expected)}\nReport: ${reportBase}.md`);
}

// The app path: native helper (resample + per-frame VAD) -> speech segments -> chunks -> whisper-cli.
async function currentPipeline(fixture: Fixture, ctx: PipelineContext): Promise<PipelineResult> {
  const startedAt = performance.now();
  const helperOut = join(ctx.workDir, `${fixture.id}.current.wav`);
  const metadata = runHelper(resolve("native/windows-helper/target/release/voxtype-windows-helper.exe"), [
    "process-wav", fixture.path, helperOut, "--vad-model", ctx.vadModel
  ]);
  const audio = decodeMonoPcm(new Uint8Array(readFileSync(helperOut)));
  const segments = detectSpeechSegments(
    {
      sampleRateHz: audio.sampleRateHz,
      frameSamples: Number(metadata.vadFrameSamples),
      probabilities: new Uint8Array(Buffer.from(String(metadata.vadProbabilities), "base64"))
    },
    audio.samples.length,
    segmentation
  );

  if (segments.length === 0) {
    return { speechDetected: false, text: "", audioSentMs: 0, whisperCalls: 0, chunks: 0, whisperMs: 0, totalMs: performance.now() - startedAt, notes: [] };
  }

  const chunks = planSpeechChunks(audio, segments, chunking);
  const whisperStartedAt = performance.now();
  const result = await transcribeChunksWithWhisperCli({
    executable: ctx.whisperCli,
    modelPath: ctx.whisperModel,
    chunks,
    prompt: fixture.promptTerms ? buildWhisperPromptContext(fixture.promptTerms, []) : null,
    language: "auto",
    workDirectory: ctx.workDir,
    id: fixture.id
  });

  return {
    speechDetected: true,
    text: result.text,
    audioSentMs: chunks.reduce((sum, chunk) => sum + (chunk.samples.length / chunk.sampleRateHz) * 1000, 0),
    whisperCalls: 1,
    chunks: chunks.length,
    whisperMs: performance.now() - whisperStartedAt,
    totalMs: performance.now() - startedAt,
    notes: [
      `segments ${String(segments.length)}`,
      ...result.removed.map((item) => `filtered ${item.reason}: "${item.text}"`),
      ...(result.rawText !== result.text ? [`raw: ${result.rawText}`] : [])
    ]
  };
}

function userHistoryCorpus(): Fixture[] {
  const history = JSON.parse(readFileSync(join(appDataDir(), "transcripts.json"), "utf8")) as
    | Array<{ id: string; text: string; audioFileName?: string }>
    | { entries?: Array<{ id: string; text: string; audioFileName?: string }> };
  const entries = Array.isArray(history) ? history : (history.entries ?? []);

  return entries
    .filter((entry) => entry.audioFileName && existsSync(join(appDataDir(), "transcript-audio", entry.audioFileName)))
    .map((entry) => {
      const path = join(appDataDir(), "transcript-audio", entry.audioFileName as string);
      return {
        id: `history-${entry.id.slice(0, 8)}`,
        targets: ["real voice"],
        parts: [],
        expectSpeech: true,
        maxWer: 0.15,
        path,
        reference: entry.text,
        durationMs: Math.round((decodeWav(new Uint8Array(readFileSync(path))).length / 16_000) * 1000)
      };
    });
}

function runHelper(helper: string, args: string[]): { samples: number; rawSamples: number; speechFrames: number } & Record<string, unknown> {
  const result = spawnSync(helper, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const line = result.stdout.trim().split(/\r?\n/).at(-1) ?? "";
  if (result.status !== 0) {
    throw new Error(`helper ${args[0]} failed: ${line} ${result.stderr}`);
  }
  return JSON.parse(line);
}

// ---------- scoring ----------

const HALLUCINATION_PHRASES = [
  "thank you", "thanks for watching", "thank you for watching", "please subscribe", "subtitles by",
  "amara org", "vielen dank", "untertitel", "copyright", "bye", "you"
];

function scoreFixture(fixture: Fixture, result: PipelineResult) {
  const failures: string[] = [];
  const hypothesis = normalizeWords(result.text);
  const reference = normalizeWords(fixture.reference);
  const wer = fixture.expectSpeech ? wordErrorRate(reference, hypothesis) : hypothesis.length > 0 ? 1 : 0;

  if (fixture.expectSpeech && !result.speechDetected) {
    failures.push("speech not detected");
  }
  if (!fixture.expectSpeech && hypothesis.length > 0) {
    failures.push(`text on silence: "${result.text}"`);
  }
  if (fixture.expectSpeech && wer > fixture.maxWer) {
    failures.push(`WER ${wer.toFixed(3)} > ${String(fixture.maxWer)}`);
  }
  for (const needle of fixture.mustContain ?? []) {
    if (!result.text.toLowerCase().includes(needle.toLowerCase()) || (needle !== needle.toLowerCase() && !result.text.includes(needle))) {
      failures.push(`missing "${needle}"`);
    }
  }

  const punctuation = { expected: countSentenceEnds(fixture.reference), found: countSentenceEnds(result.text) };
  const hallucinations = findHallucinations(fixture, result.text);
  failures.push(...hallucinations);

  return { wer, punctuation, hallucinations, failures, pass: failures.length === 0 || Boolean(fixture.knownIssue), knownIssue: failures.length > 0 ? fixture.knownIssue : undefined };
}

function findHallucinations(fixture: Fixture, text: string): string[] {
  const found: string[] = [];
  const outputPhrase = ` ${normalizeWords(text).join(" ")} `;
  const referencePhrase = ` ${normalizeWords(fixture.reference).join(" ")} `;

  for (const phrase of HALLUCINATION_PHRASES) {
    if (countOccurrences(outputPhrase, ` ${phrase} `) > countOccurrences(referencePhrase, ` ${phrase} `)) {
      found.push(`hallucinated phrase "${phrase}"`);
    }
  }
  if (/\[[^\]]*\]|\((?:[^)]*\b(?:music|applause|laugh|silence|noise|blank|inaudible)[^)]*)\)|♪/i.test(text)) {
    found.push("non-speech annotation");
  }
  if (/relevant terms|use these spellings/i.test(text) || (fixture.promptTerms && fixture.promptTerms.filter((term) => text.includes(`${term},`)).length >= 2)) {
    found.push("prompt echo");
  }

  const words = normalizeWords(text);
  const referenceWords = normalizeWords(fixture.reference);
  const trigramCounts = (list: string[]) => {
    const counts = new Map<string, number>();
    for (let index = 0; index + 3 <= list.length; index += 1) {
      const key = list.slice(index, index + 3).join(" ");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const referenceTrigrams = trigramCounts(referenceWords);
  for (const [trigram, count] of trigramCounts(words)) {
    if (count >= 2 && count > (referenceTrigrams.get(trigram) ?? 0)) {
      found.push(`repetition "${trigram}" x${String(count)}`);
      break;
    }
  }

  return found;
}

// Sentence-final punctuation is not part of WER but matters for inserted text, so it is tracked.
function countSentenceEnds(text: string): number {
  return (text.match(/[.!?](?=\s|$)/g) ?? []).length;
}

function sumPunctuation(results: Array<{ punctuation: { expected: number; found: number } }>) {
  return results.reduce(
    (sum, result) => ({ expected: sum.expected + result.punctuation.expected, found: sum.found + Math.min(result.punctuation.found, result.punctuation.expected) }),
    { expected: 0, found: 0 }
  );
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[-–—/]/g, " ")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function wordErrorRate(reference: string[], hypothesis: string[]): number {
  const previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  for (let row = 1; row <= reference.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= hypothesis.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (reference[row - 1] === hypothesis[column - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return reference.length > 0 ? previous[hypothesis.length] / reference.length : hypothesis.length;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let index = haystack.indexOf(needle); index >= 0; index = haystack.indexOf(needle, index + 1)) {
    count += 1;
  }
  return count;
}

// ---------- report ----------

function renderMarkdown(data: Report, baseline: Report | null): string {
  const lines = [
    `# Dictation E2E: ${data.pipeline}`,
    "",
    `Generated ${data.generatedAt} at ${String(data.gitCommit)}${data.gitDirty ? " (dirty)" : ""}.`,
    `Passed ${String(data.passed)}/${String(data.total)}, mean WER ${data.meanWer.toFixed(3)}, sentence ends ${String(data.punctuation?.found ?? "?")}/${String(data.punctuation?.expected ?? "?")}.`,
    "",
    "| Fixture | Targets | Pass | WER | Audio in | Sent to Whisper | Chunks | Whisper ms | Issues |",
    "|---|---|---|---|---|---|---|---|---|"
  ];
  for (const result of data.results) {
    lines.push(
      `| ${result.id} | ${result.targets.join(" ")} | ${result.knownIssue ? "known issue" : result.pass ? "yes" : "**no**"} | ${result.wer.toFixed(3)} | ${(result.durationMs / 1000).toFixed(1)} s | ${(result.audioSentMs / 1000).toFixed(1)} s | ${String(result.chunks)} | ${String(Math.round(result.whisperMs))} | ${result.failures.join("; ").replace(/\|/g, "\\|")} |`
    );
  }
  if (baseline) {
    lines.push(
      "",
      `## Compared with frozen baseline (${baseline.generatedAt}, ${String(baseline.gitCommit).slice(0, 8)})`,
      "",
      `Baseline passed ${String(baseline.passed)}/${String(baseline.total)}, mean WER ${baseline.meanWer.toFixed(3)}.`,
      "",
      "| Fixture | Baseline | Now | Baseline WER | Now WER | Baseline sent | Now sent |",
      "|---|---|---|---|---|---|---|"
    );
    for (const result of data.results) {
      const before = baseline.results.find((item) => item.id === result.id);
      lines.push(
        `| ${result.id} | ${before ? (before.pass ? "pass" : "**fail**") : "-"} | ${result.pass ? "pass" : "**fail**"} | ${before ? before.wer.toFixed(3) : "-"} | ${result.wer.toFixed(3)} | ${before ? `${(before.audioSentMs / 1000).toFixed(1)} s` : "-"} | ${(result.audioSentMs / 1000).toFixed(1)} s |`
      );
    }
  }
  lines.push("", "## Transcripts", "");
  for (const result of data.results) {
    lines.push(`- **${result.id}**: ${result.text || "_(no text)_"}`);
    for (const note of result.notes) {
      lines.push(`  - ${note}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

// ---------- environment ----------

function appDataDir(): string {
  return join(process.env.APPDATA ?? "", "voxtype");
}

function resolveWhisperCli(): string {
  if (process.env.VOXTYPE_WHISPER_CLI) {
    return process.env.VOXTYPE_WHISPER_CLI;
  }
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || !existsSync(dir)) {
      return;
    }
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path, depth + 1);
      } else if (entry.toLowerCase() === "whisper-cli.exe") {
        found.push(path);
      }
    }
  };
  walk(join(appDataDir(), "runtimes"), 0);
  const preferred = found.find((path) => path.includes("cuda-12")) ?? found[0];
  if (!preferred) {
    throw new Error("No whisper-cli.exe found; set VOXTYPE_WHISPER_CLI.");
  }
  return preferred;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

function tryGit(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

await main();
