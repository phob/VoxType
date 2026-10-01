// E2E cleanup test: messy-speech corpus (TTS) -> the app's local Whisper path -> LLM cleanup through a
// real llama-server -> scored report. Uses the same modules as the app.
//
// Usage: bun scripts/e2e-cleanup/run.ts [--model <gguf>]... [--backend vulkan|cpu] [--spec ngram-simple]
//        [--only id,id] [--label name] [--no-cleanup] [--fresh-asr] [--corpus synthetic|user-history]
//        [--asr whisper|parakeet]
// --model takes a path or a file name in %APPDATA%\voxtype\models\llm; repeat it to compare models.
// Default: the model the app picks for the backend ("auto"), on Vulkan.
// Artifacts: native/windows-helper/target/e2e/cleanup-<label>.{json,md}.
// Needs: release build of the native helper, a whisper.cpp runtime + large-v3-turbo model, and a llama.cpp
// runtime (VOXTYPE_LLAMA_SERVER or %APPDATA%\voxtype\runtimes\llama.cpp). German speech is rendered with
// Piper, downloaded on first use into target/e2e/tts-models.
//
// --corpus user-history cleans the text of your saved dictations (local only) for manual review; there is
// no expected text, so nothing passes or fails except runtime errors.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { LlamaServer, type LlamaServerConfig } from "../../src/main/llama-server";
import { runCleanup, warmUpCleanup, type CleanupRun } from "../../src/main/llm-cleanup-runner";
import { CLEANUP_SYSTEM_PROMPT } from "../../src/shared/cleanup-prompt";
import { llmCleanupTimeoutMs, resolveLlmCleanupModel, type LlamaRuntimeBackend, type TranscriptCleanup } from "../../src/shared/llm-cleanup";
import { buildFixtures } from "../e2e-dictation/corpus";
import {
  appDataDir,
  argValue,
  argValues,
  createPipelineContext,
  currentPipeline,
  e2eOutDir,
  findFiles,
  normalizeWords,
  tryGit,
  wordErrorRate,
  type AsrEngine,
  type PipelineContext
} from "../e2e-dictation/pipeline";
import { CLEANUP_FIXTURES, type CleanupFixtureSpec } from "./corpus";

type Fixture = ReturnType<typeof buildFixtures<CleanupFixtureSpec>>[number];

interface ModelRun {
  model: string;
  text: string;
  cleanup: TranscriptCleanup | null;
  predictedPerSecond: number | null;
  wer: number;
  failures: string[];
  pass: boolean;
  knownIssue?: string;
}

interface FixtureResult {
  id: string;
  lang: string;
  style: string;
  targets: string[];
  spoken: string;
  expected: string;
  asrText: string;
  asrWer: number;
  asrMs: number;
  asrFailures: string[];
  runs: ModelRun[];
}

interface ModelSummary {
  model: string;
  passed: number;
  total: number;
  meanWer: number;
  statuses: Record<string, number>;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyMaxMs: number;
}

const hesitations = new Set(["um", "uh", "uhm", "hmm", "hm", "mhm", "äh", "ähm", "öh", "er", "erm"]);
const corpus = argValue("--corpus") ?? "synthetic";
const only = argValue("--only")?.split(",").filter(Boolean);
const backend: LlamaRuntimeBackend = argValue("--backend") === "cpu" ? "cpu" : "vulkan";
const spec = argValue("--spec");
const noCleanup = process.argv.includes("--no-cleanup");
const engine: AsrEngine = argValue("--asr") === "parakeet" ? "parakeet" : "whisper";
const freshAsr = process.argv.includes("--fresh-asr");
const label = argValue("--label") ?? (noCleanup ? "asr-only" : corpus === "synthetic" ? "current" : corpus);

async function main(): Promise<void> {
  mkdirSync(join(e2eOutDir, "work"), { recursive: true });
  const models = noCleanup ? [] : resolveModels();
  const llamaServer = noCleanup ? null : resolveLlamaServer();

  if (corpus === "user-history") {
    await runUserHistory(models, llamaServer);
    return;
  }

  const fixtures = buildFixtures(e2eOutDir, "cleanup-fixtures", CLEANUP_FIXTURES.filter((fixture) => !only?.length || only.includes(fixture.id)));
  const pipeline = createPipelineContext(join(e2eOutDir, "work"), engine);
  const results: FixtureResult[] = [];

  try {
    for (const fixture of fixtures) {
      const asr = await transcribeCached(fixture, pipeline);
      const asrScore = scoreText(fixture, asr.text);
      results.push({
        id: fixture.id,
        lang: fixture.lang,
        style: fixture.style,
        targets: fixture.targets,
        spoken: fixture.reference,
        expected: fixture.expected,
        asrText: asr.text,
        asrWer: asrScore.wer,
        asrMs: asr.ms,
        asrFailures: asrScore.failures,
        runs: []
      });
      console.log(`ASR   ${fixture.id.padEnd(18)} ${asr.cached ? "(cached)" : `${String(Math.round(asr.ms))} ms`}  ${asr.text}`);
    }
  } finally {
    pipeline.whisperServer?.server.stop();
  }

  for (const model of models) {
    const server = new LlamaServer();
    const config: LlamaServerConfig = { executable: llamaServer ?? "", modelPath: model, backend, extraArgs: spec ? ["--spec-type", spec] : [] };
    const startedAt = performance.now();
    await warmUpCleanup(server, config);
    console.log(`\n${basename(model)} on ${backend}${spec ? ` + ${spec}` : ""}: ready in ${String(Math.round(performance.now() - startedAt))} ms`);

    try {
      for (const result of results) {
        const fixture = fixtures.find((item) => item.id === result.id);
        if (!fixture) {
          continue;
        }
        const run = await runCleanup(server, config, {
          text: result.asrText,
          style: fixture.style,
          terms: fixture.terms ?? [],
          textBefore: fixture.before,
          modelId: basename(model),
          timeoutMs: llmCleanupTimeoutMs
        });
        const modelRun = toModelRun(fixture, basename(model), run);
        result.runs.push(modelRun);
        console.log(`${modelRun.knownIssue ? "KNOWN" : modelRun.pass ? "PASS " : "FAIL "} ${fixture.id.padEnd(18)} ${run.record.status.padEnd(9)} ${String(run.record.durationMs).padStart(5)} ms  WER ${modelRun.wer.toFixed(2)}  ${modelRun.failures.join("; ")}`);
      }
    } finally {
      server.stop();
    }
  }

  const summaries = models.length > 0 ? models.map((model) => summarize(basename(model), results)) : [];
  const asrPassed = results.filter((result) => result.asrFailures.length === 0).length;
  const report = {
    label,
    generatedAt: new Date().toISOString(),
    gitCommit: tryGit(["rev-parse", "HEAD"]),
    gitDirty: tryGit(["status", "--porcelain"]) !== "",
    asrEngine: pipeline.engine,
    whisperModel: pipeline.whisperModel,
    llamaServer,
    backend,
    speculative: spec ?? null,
    promptHash: createHash("sha1").update(CLEANUP_SYSTEM_PROMPT).digest("hex").slice(0, 12),
    timeoutMs: llmCleanupTimeoutMs,
    asrOnly: { passed: asrPassed, total: results.length, meanWer: mean(results.map((result) => result.asrWer)) },
    models: summaries,
    results
  };

  const reportBase = join(e2eOutDir, `cleanup-${label}`);
  writeFileSync(`${reportBase}.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`${reportBase}.md`, renderMarkdown(report));

  console.log(`\nASR only: ${String(asrPassed)}/${String(results.length)} pass, mean WER ${report.asrOnly.meanWer.toFixed(3)}`);
  for (const summary of summaries) {
    console.log(`${summary.model}: ${String(summary.passed)}/${String(summary.total)} pass, mean WER ${summary.meanWer.toFixed(3)}, p50 ${String(summary.latencyP50Ms)} ms, p95 ${String(summary.latencyP95Ms)} ms`);
  }
  console.log(`Report: ${reportBase}.md`);
  const gate = summaries.length > 0 ? summaries.every((summary) => summary.passed === summary.total) : asrPassed === results.length;
  process.exitCode = gate ? 0 : 1;
}

// ---------- ASR (cached: TTS audio + Whisper are deterministic per fixture and slow to redo) ----------

async function transcribeCached(fixture: Fixture, pipeline: PipelineContext): Promise<{ text: string; ms: number; cached: boolean }> {
  const cacheDir = join(e2eOutDir, "asr-cache");
  mkdirSync(cacheDir, { recursive: true });
  const key = createHash("sha1")
    .update(readFileSync(fixture.path))
    .update(`\n${pipeline.engine}\n${pipeline.whisperServer ? "server" : "cli"}\n${pipeline.whisperModel}\n${fixture.lang}\n${(fixture.terms ?? []).join(",")}`)
    .digest("hex")
    .slice(0, 16);
  const cachePath = join(cacheDir, `${fixture.id}-${key}.json`);

  if (!freshAsr && existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, "utf8")) as { text: string; ms: number };
    return { ...cached, cached: true };
  }

  const result = await currentPipeline({ id: fixture.id, path: fixture.path, promptTerms: fixture.terms, language: fixture.lang }, pipeline);
  const entry = { text: result.text, ms: Math.round(result.whisperMs) };
  writeFileSync(cachePath, JSON.stringify(entry));
  return { ...entry, cached: false };
}

// ---------- scoring ----------

function scoreText(fixture: CleanupFixtureSpec, text: string): { wer: number; failures: string[] } {
  const failures: string[] = [];
  const outputWords = normalizeWords(text);

  if (fixture.expected === "") {
    const invented = outputWords.filter((word) => !hesitations.has(word));
    return { wer: invented.length > 0 ? 1 : 0, failures: invented.length > 0 ? [`text from filler-only input: "${text}"`] : [] };
  }

  const wer = wordErrorRate(normalizeWords(fixture.expected), outputWords);
  if (wer > fixture.maxWer) {
    failures.push(`WER ${wer.toFixed(2)} > ${String(fixture.maxWer)}`);
  }
  for (const needle of fixture.mustContain ?? []) {
    const found = needle === needle.toLowerCase() ? text.toLowerCase().includes(needle) : text.includes(needle);
    if (!found) {
      failures.push(`missing "${needle}"`);
    }
  }
  for (const needle of fixture.mustNotContain ?? []) {
    if (new RegExp(`(^|[^\\p{L}])${escapeRegex(needle)}($|[^\\p{L}])`, "iu").test(text)) {
      failures.push(`contains "${needle}"`);
    }
  }
  if (fixture.mustMatch && !new RegExp(fixture.mustMatch, "m").test(text)) {
    failures.push(`does not match /${fixture.mustMatch}/`);
  }
  if (fixture.mustNotMatch && new RegExp(fixture.mustNotMatch, "m").test(text)) {
    failures.push(`matches /${fixture.mustNotMatch}/`);
  }

  return { wer, failures };
}

function toModelRun(fixture: CleanupFixtureSpec, model: string, run: CleanupRun): ModelRun {
  const score = scoreText(fixture, run.text);
  const failures = [...score.failures];
  if (run.record.status === "failed") {
    failures.push(`cleanup failed: ${run.record.reason ?? ""}`);
  }
  return {
    model,
    text: run.text,
    cleanup: run.record,
    predictedPerSecond: run.completion?.predictedPerSecond ?? null,
    wer: score.wer,
    failures,
    pass: failures.length === 0 || Boolean(fixture.knownIssue),
    knownIssue: failures.length > 0 ? fixture.knownIssue : undefined
  };
}

function summarize(model: string, results: FixtureResult[]): ModelSummary {
  const runs = results.flatMap((result) => result.runs.filter((run) => run.model === model));
  const latencies = runs.map((run) => run.cleanup?.durationMs ?? 0).sort((a, b) => a - b);
  const statuses: Record<string, number> = {};
  for (const run of runs) {
    const status = run.cleanup?.status ?? "none";
    statuses[status] = (statuses[status] ?? 0) + 1;
  }
  return {
    model,
    passed: runs.filter((run) => run.pass).length,
    total: runs.length,
    meanWer: mean(runs.map((run) => run.wer)),
    statuses,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    latencyMaxMs: latencies.at(-1) ?? 0
  };
}

// ---------- user history (review only) ----------

async function runUserHistory(models: string[], llamaServer: string | null): Promise<void> {
  const history = JSON.parse(readFileSync(join(appDataDir(), "transcripts.json"), "utf8")) as
    | Array<{ id: string; text: string }>
    | { entries?: Array<{ id: string; text: string }> };
  const entries = Array.isArray(history) ? history : (history.entries ?? []);
  const lines = [`# Cleanup review: your saved dictations`, "", `Generated ${new Date().toISOString()}. Review each pair by hand; there is no expected text.`, ""];

  for (const model of models) {
    const server = new LlamaServer();
    const config: LlamaServerConfig = { executable: llamaServer ?? "", modelPath: model, backend, extraArgs: spec ? ["--spec-type", spec] : [] };
    await warmUpCleanup(server, config);
    lines.push(`## ${basename(model)}`, "");
    try {
      for (const entry of entries) {
        const run = await runCleanup(server, config, {
          text: entry.text,
          style: "default",
          terms: [],
          modelId: basename(model),
          timeoutMs: llmCleanupTimeoutMs
        });
        console.log(`${run.record.status.padEnd(9)} ${String(run.record.durationMs).padStart(5)} ms  ${entry.id.slice(0, 8)}`);
        lines.push(
          `### ${entry.id.slice(0, 8)}: ${run.record.status}, ${String(run.record.durationMs)} ms${run.record.reason ? ` (${run.record.reason})` : ""}`,
          "",
          "Before:",
          "",
          quote(entry.text),
          "",
          "After:",
          "",
          quote(run.record.status === "rejected" ? `(rejected) ${run.record.rejectedText ?? ""}` : run.text),
          ""
        );
      }
    } finally {
      server.stop();
    }
  }

  const path = join(e2eOutDir, `cleanup-${label}.md`);
  writeFileSync(path, `${lines.join("\n")}\n`);
  console.log(`Review: ${path}`);
}

// ---------- report ----------

function renderMarkdown(report: {
  label: string;
  generatedAt: string;
  gitCommit: string | null;
  gitDirty: boolean;
  asrEngine: string;
  backend: string;
  speculative: string | null;
  promptHash: string;
  asrOnly: { passed: number; total: number; meanWer: number };
  models: ModelSummary[];
  results: FixtureResult[];
}): string {
  const lines = [
    `# Cleanup E2E: ${report.label}`,
    "",
    `Generated ${report.generatedAt} at ${String(report.gitCommit)}${report.gitDirty ? " (dirty)" : ""}. Backend ${report.backend}${report.speculative ? ` + ${report.speculative}` : ""}, prompt ${report.promptHash}.`,
    "",
    "| Pipeline | Passed | Mean WER vs expected | Cleanup p50 | p95 | max | Outcomes |",
    "|---|---|---|---|---|---|---|",
    `| ${report.asrEngine === "parakeet" ? "Parakeet" : "Whisper"} only | ${String(report.asrOnly.passed)}/${String(report.asrOnly.total)} | ${report.asrOnly.meanWer.toFixed(3)} | - | - | - | - |`
  ];
  for (const summary of report.models) {
    lines.push(
      `| + ${summary.model} | ${String(summary.passed)}/${String(summary.total)} | ${summary.meanWer.toFixed(3)} | ${String(summary.latencyP50Ms)} ms | ${String(summary.latencyP95Ms)} ms | ${String(summary.latencyMaxMs)} ms | ${Object.entries(summary.statuses).map(([key, value]) => `${key} ${String(value)}`).join(", ")} |`
    );
  }

  lines.push("", "## Per fixture", "", `| Fixture | Targets | ASR only | ${report.models.map((summary) => summary.model).join(" | ")} |`, `|---|---|---|${report.models.map(() => "---|").join("")}`);
  for (const result of report.results) {
    const cells = result.runs.map((run) => `${run.knownIssue ? "known issue" : run.pass ? "pass" : "**fail**"} ${run.wer.toFixed(2)} (${run.cleanup?.status ?? "-"})`);
    lines.push(`| ${result.id} | ${result.targets.join(" ")} | ${result.asrFailures.length === 0 ? "pass" : "fail"} ${result.asrWer.toFixed(2)} | ${cells.join(" | ")} |`);
  }

  lines.push("", "## Transcripts", "");
  for (const result of report.results) {
    const fixture = CLEANUP_FIXTURES.find((item) => item.id === result.id);
    lines.push(`### ${result.id} (${result.lang}, ${result.style})`, "", ...(fixture?.before ? [`- Before cursor: ${inline(fixture.before)}`] : []), `- Spoken: ${result.spoken}`, `- Expected: ${inline(result.expected)}`, `- ASR: ${inline(result.asrText)}`);
    for (const run of result.runs) {
      const rejected = run.cleanup?.status === "rejected" ? ` — rejected: ${run.cleanup.reason ?? ""}: ${inline(run.cleanup.rejectedText ?? "")}` : "";
      const failed = run.cleanup?.status === "failed" ? ` — failed: ${run.cleanup.reason ?? ""}` : "";
      lines.push(`- ${run.model}: ${inline(run.text)}${rejected}${failed}${run.failures.length > 0 ? ` — **${run.failures.join("; ")}**` : ""}${run.knownIssue ? ` (known issue: ${run.knownIssue})` : ""}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

// ---------- environment ----------

function resolveModels(): string[] {
  const requested = argValues("--model");
  const names = requested.length > 0 ? requested : [resolveLlmCleanupModel("auto", backend).fileName];
  return names.map((name) => {
    const path = existsSync(name) ? name : join(appDataDir(), "models", "llm", name);
    if (!existsSync(path)) {
      throw new Error(`Model not found: ${name} (looked in ${join(appDataDir(), "models", "llm")}).`);
    }
    return path;
  });
}

function resolveLlamaServer(): string {
  if (process.env.VOXTYPE_LLAMA_SERVER) {
    return process.env.VOXTYPE_LLAMA_SERVER;
  }
  const found = findFiles(join(appDataDir(), "runtimes", "llama.cpp"), "llama-server.exe").find((path) => path.includes(`-${backend}-`));
  if (!found) {
    throw new Error(`No ${backend} llama-server.exe found under %APPDATA%\\voxtype\\runtimes\\llama.cpp; set VOXTYPE_LLAMA_SERVER.`);
  }
  return found;
}

function percentile(sorted: number[], fraction: number): number {
  return sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] : 0;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inline(text: string): string {
  return text ? `\`${text.replace(/\n/g, "⏎")}\`` : "_(empty)_";
}

function quote(text: string): string {
  return text.split("\n").map((line) => `> ${line}`).join("\n");
}

await main();
