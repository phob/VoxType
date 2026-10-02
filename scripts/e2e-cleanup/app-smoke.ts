// App-level E2E for AI cleanup: launches the built Electron app with a throwaway user-data directory
// and drives it through the real preload API over the Chrome DevTools Protocol.
//
// Checks: runtime install through IPC, warm-up, cleanup applied to a dictation, Whisper stays loaded
// between dictations (whisper-server), "raw" profile skips cleanup, a killed llama-server does not block
// dictation, quitting leaves no llama-server or whisper-server behind, and the native helper reads the
// text before the cursor in a real Notepad window.
// Cloud cleanup (needs OPENAI_API_KEY; ANTHROPIC_API_KEY optional): switching to a cloud provider stops
// llama-server, a dictation is rewritten by OpenAI, Offline Mode and a profile that blocks cloud keep the
// text local, and a missing Anthropic key falls back without a network request.
//
// Usage: bun run build && bun scripts/e2e-cleanup/app-smoke.ts
// Needs: bun run e2e:cleanup once before (it renders the fixture audio), a whisper.cpp runtime and the
// large-v3-turbo + Qwen3.5 GGUF models in %APPDATA%\voxtype\models. Your real settings and history are not
// touched; the llama.cpp runtime is downloaded into the throwaway directory to exercise the installer.
// Artifacts: native/windows-helper/target/e2e/cleanup-app-smoke.{json,md}, cleanup-settings.png and
// cleanup-settings-cloud.png.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseCursorContext } from "../../src/shared/cursor-context";
import { appDataDir, createPipelineContext, e2eOutDir, tryGit } from "../e2e-dictation/pipeline";
import { connectToRenderer, sleep, waitFor, type RendererPage } from "../e2e-app/cdp";

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

const port = 9_400 + Math.floor(Math.random() * 500);
const userDataDir = mkdtempSync(join(tmpdir(), "voxtype-cleanup-smoke-"));
const checks: Check[] = [];

async function main(): Promise<void> {
  const englishWav = requireFile(join(e2eOutDir, "work", "en-no-wait.current.wav"));
  await checkFocusedTextInNotepad();
  const whisperServersBefore = processCount("whisper-server");
  const electron = resolve("node_modules/electron/dist/electron.exe");
  // Hosts that are Electron apps themselves (editors, terminals) export ELECTRON_RUN_AS_NODE, which would
  // start VoxType as plain Node.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electron, [".", `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${String(port)}`], { stdio: "ignore", env });
  const appExited = new Promise<void>((done) => app.once("exit", () => done()));

  try {
    const page = await connectToRenderer(port);
    const whisperCli = createPipelineContext(join(e2eOutDir, "work")).whisperCli;

    await page.evaluate(`window.voxtype.settings.update(${JSON.stringify({
      modelDirectory: join(appDataDir(), "models"),
      whisperExecutablePath: whisperCli,
      dictationModeId: "local.custom",
      localCustomModelId: "large-v3-turbo",
      whisperLanguage: "en",
      llmCleanupBackend: "vulkan",
      appProfiles: [
        { processName: "powershell.exe", writingStyle: "raw" },
        { processName: "keepass.exe", writingStyle: "default", forbidCloudDictation: true }
      ]
    })})`);

    const installStartedAt = performance.now();
    const installed = await page.evaluate<{ runtime: { status: string }; model: { status: string; name: string } }>(
      "window.voxtype.llmCleanup.install()"
    );
    check("runtime installs through IPC", installed.runtime.status === "installed" && installed.model.status === "downloaded",
      `runtime ${installed.runtime.status}, ${installed.model.name} ${installed.model.status}, ${String(Math.round(performance.now() - installStartedAt))} ms`);

    await page.evaluate("window.voxtype.settings.update({ llmCleanupEnabled: true })");
    const ready = await waitFor(async () => {
      const status = await page.evaluate<{ server: string; error: string | null }>("window.voxtype.llmCleanup.getStatus()");
      return status.server === "ready" || status.server === "error" ? status : null;
    }, 60_000);
    check("server warms up after enabling", ready?.server === "ready", ready ? `${ready.server}${ready.error ? `: ${ready.error}` : ""}` : "timed out");
    await page.screenshotSettings(join(e2eOutDir, "cleanup-settings.png"));

    const cleaned = await transcribe(page, englishWav, null);
    check("cleanup resolves a self-correction", cleaned.cleanupStatus === "applied" && !/thursday|no wait/i.test(cleaned.text),
      `${cleaned.cleanupStatus ?? "no cleanup"} in ${String(cleaned.cleanupMs ?? "-")} ms: "${cleaned.text}"`);

    const raw = await transcribe(page, englishWav, "powershell.exe");
    check("raw profile skips cleanup", raw.cleanupStatus === null && /thursday/i.test(raw.text), `"${raw.text}"`);
    check("Whisper stays loaded between dictations", processCount("whisper-server") === whisperServersBefore + 1 && raw.durationMs < 1_000,
      `first dictation ${String(cleaned.durationMs)} ms (model load + cleanup), next ${String(raw.durationMs)} ms, ${String(processCount("whisper-server") - whisperServersBefore)} whisper-server started`);

    const killed = spawnSync("powershell.exe", ["-NoProfile", "-Command",
      `Get-Process llama-server -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${userDataDir}*' } | Stop-Process -Force -PassThru | Measure-Object | Select-Object -ExpandProperty Count`
    ], { encoding: "utf8" }).stdout.trim();
    const afterKill = await transcribe(page, englishWav, null);
    check("killed llama-server restarts within the dictation", afterKill.cleanupStatus === "applied" && !/thursday/i.test(afterKill.text),
      `killed ${killed} process(es); next dictation ${afterKill.cleanupStatus ?? "no cleanup"} in ${String(afterKill.cleanupMs ?? "-")} ms: "${afterKill.text}"`);

    await checkCloudCleanup(page, englishWav);

    await page.quitApp();
    await Promise.race([appExited, sleep(15_000)]);
    const appGone = app.exitCode !== null;
    const leftover = llamaServersUnder(userDataDir);
    const whisperLeftover = processCount("whisper-server") - whisperServersBefore;
    check("quitting stops both model servers", appGone && leftover === 0 && whisperLeftover === 0,
      `app ${appGone ? "exited" : "still running"}, ${String(leftover)} llama-server and ${String(whisperLeftover)} whisper-server left`);
  } finally {
    if (app.exitCode === null) {
      app.kill();
    }
    spawnSync("powershell.exe", ["-NoProfile", "-Command", `Get-Process llama-server -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${userDataDir}*' } | Stop-Process -Force`]);
    await sleep(1_000);
    rmSync(userDataDir, { recursive: true, force: true });
    writeReport();
  }
}

interface Dictation {
  text: string;
  cleanupStatus: string | null;
  cleanupMs: number | null;
  cleanupReason: string | null;
  cleanupProvider: string | null;
  cleanupModel: string | null;
  durationMs: number;
}

async function transcribe(page: RendererPage, wavPath: string, processName: string | null): Promise<Dictation> {
  const base64 = readFileSync(wavPath).toString("base64");
  return page.evaluate(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (char) => char.charCodeAt(0));
    const result = await window.voxtype.transcription.transcribeWav(bytes, { processName: ${JSON.stringify(processName)} });
    const cleanup = result.entry.cleanup;
    return {
      text: result.entry.text,
      cleanupStatus: cleanup?.status ?? null,
      cleanupMs: cleanup?.durationMs ?? null,
      cleanupReason: cleanup?.reason ?? null,
      cleanupProvider: cleanup?.provider ?? null,
      cleanupModel: cleanup?.modelId ?? null,
      durationMs: result.entry.durationMs
    };
  })()`);
}

interface TryResult {
  text: string;
  cleanup: { status: string; reason?: string; modelId: string; provider?: string; level?: string; durationMs: number } | null;
}

async function tryCleanup(page: RendererPage, text: string): Promise<TryResult> {
  return page.evaluate<TryResult>(`window.voxtype.llmCleanup.test(${JSON.stringify(text)})`);
}

async function checkCloudCleanup(page: RendererPage, englishWav: string): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    check("cloud cleanup", false, "OPENAI_API_KEY is not set; cloud checks need it");
    return;
  }

  await page.evaluate(`window.voxtype.settings.update({ llmCleanupProvider: "openai", llmCleanupLevel: "rewrite" })`);
  await sleep(1_000);
  check("switching to a cloud provider stops llama-server", llamaServersUnder(userDataDir) === 0, `${String(llamaServersUnder(userDataDir))} llama-server left`);
  await page.screenshotSettings(join(e2eOutDir, "cleanup-settings-cloud.png"));

  const rewritten = await transcribe(page, englishWav, null);
  check("OpenAI rewrites a dictation", rewritten.cleanupStatus === "applied" && rewritten.cleanupProvider === "openai" && /friday/i.test(rewritten.text) && !/thursday|no wait/i.test(rewritten.text),
    `${rewritten.cleanupStatus ?? "no cleanup"} by ${rewritten.cleanupModel ?? "-"} in ${String(rewritten.cleanupMs ?? "-")} ms: "${rewritten.text}"`);

  const learner = "uh I am working here since two years and I become every week the same question";
  const fixed = await tryCleanup(page, learner);
  check("rewrite fixes learner English", fixed.cleanup?.status === "applied" && /for two years/i.test(fixed.text) && !/\bbecome\b/i.test(fixed.text),
    `${fixed.cleanup?.status ?? "off"} in ${String(fixed.cleanup?.durationMs ?? "-")} ms: "${fixed.text}"`);

  const blocked = await transcribe(page, englishWav, "keepass.exe");
  check("a profile that blocks cloud keeps the text local", blocked.cleanupStatus === "failed" && /blocks cloud/.test(blocked.cleanupReason ?? "") && (blocked.cleanupMs ?? 1) === 0,
    `${blocked.cleanupStatus ?? "no cleanup"}: ${blocked.cleanupReason ?? ""}: "${blocked.text}"`);

  await page.evaluate("window.voxtype.settings.update({ offlineMode: true })");
  const offline = await tryCleanup(page, learner);
  check("Offline Mode keeps the text local", offline.cleanup?.status === "failed" && /Offline Mode/.test(offline.cleanup.reason ?? "") && offline.text.startsWith("I am working"),
    `${offline.cleanup?.status ?? "off"}: ${offline.cleanup?.reason ?? ""}: "${offline.text}"`);
  await page.evaluate("window.voxtype.settings.update({ offlineMode: false })");

  await page.evaluate(`window.voxtype.settings.update({ llmCleanupProvider: "anthropic" })`);
  const anthropic = await tryCleanup(page, learner);
  if (process.env.ANTHROPIC_API_KEY) {
    check("Anthropic rewrites with its key", anthropic.cleanup?.status === "applied" && anthropic.cleanup.provider === "anthropic" && /for two years/i.test(anthropic.text),
      `${anthropic.cleanup?.status ?? "off"} by ${anthropic.cleanup?.modelId ?? "-"} in ${String(anthropic.cleanup?.durationMs ?? "-")} ms: "${anthropic.text}"`);
  } else {
    check("a missing Anthropic key falls back locally", anthropic.cleanup?.status === "failed" && /No Anthropic API key/.test(anthropic.cleanup.reason ?? "") && anthropic.cleanup.durationMs === 0,
      `${anthropic.cleanup?.status ?? "off"}: ${anthropic.cleanup?.reason ?? ""}: "${anthropic.text}"`);
  }
}

// ---------- helpers ----------

function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${detail}`);
}

// The helper is what the app runs at hotkey time; Notepad exposes the caret through UI Automation.
async function checkFocusedTextInNotepad(): Promise<void> {
  const helper = resolve("native/windows-helper/target/release/voxtype-windows-helper.exe");
  const file = join(userDataDir, "cursor-context.txt");
  writeFileSync(file, "Hallo Frau Wojciechowski,\r\n\r\nich habe die Unterlagen gestern");
  const notepad = spawn("notepad.exe", [file], { stdio: "ignore" });
  try {
    await sleep(1_500);
    spawnSync(helper, ["send-hotkey", "Control+End"]);
    await sleep(300);
    const output = spawnSync(helper, ["focused-text", "600", "0"], { encoding: "utf8" }).stdout.trim();
    const context = parseCursorContext(JSON.parse(output));
    const before = context?.before ?? "";
    check("helper reads text before the cursor", before.endsWith("ich habe die Unterlagen gestern") && before.includes("Wojciechowski"),
      `${context?.source ?? "nothing"}: "${before.replace(/\n/g, "⏎")}"`);
  } finally {
    spawnSync("powershell.exe", ["-NoProfile", "-Command", "Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*cursor-context*' } | Stop-Process -Force"]);
    notepad.kill();
  }
}

function processCount(name: string): number {
  const output = spawnSync("powershell.exe", ["-NoProfile", "-Command", `@(Get-Process ${name} -ErrorAction SilentlyContinue).Count`], { encoding: "utf8" }).stdout.trim();
  return Number.parseInt(output, 10) || 0;
}

function llamaServersUnder(directory: string): number {
  const output = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    `@(Get-Process llama-server -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${directory}*' }).Count`
  ], { encoding: "utf8" }).stdout.trim();
  return Number.parseInt(output, 10) || 0;
}

function requireFile(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`${path} is missing; run bun run e2e:cleanup first.`);
  }
  return path;
}

function writeReport(): void {
  const passed = checks.filter((item) => item.pass).length;
  const report = { generatedAt: new Date().toISOString(), gitCommit: tryGit(["rev-parse", "HEAD"]), gitDirty: tryGit(["status", "--porcelain"]) !== "", passed, total: checks.length, checks };
  const base = join(e2eOutDir, "cleanup-app-smoke");
  writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`${base}.md`, [
    "# AI cleanup app smoke test",
    "",
    `Generated ${report.generatedAt} at ${String(report.gitCommit)}${report.gitDirty ? " (dirty)" : ""}. Passed ${String(passed)}/${String(checks.length)}.`,
    "",
    "| Check | Result | Detail |",
    "|---|---|---|",
    ...checks.map((item) => `| ${item.name} | ${item.pass ? "pass" : "**fail**"} | ${item.detail.replace(/\|/g, "\\|")} |`),
    ""
  ].join("\n"));
  console.log(`\n${String(passed)}/${String(checks.length)} passed. Report: ${base}.md`);
  process.exitCode = passed === checks.length && checks.length > 0 ? 0 : 1;
}

await main();
