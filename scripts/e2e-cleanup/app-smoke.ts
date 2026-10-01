// App-level E2E for AI cleanup: launches the built Electron app with a throwaway user-data directory
// and drives it through the real preload API over the Chrome DevTools Protocol.
//
// Checks: runtime install through IPC, warm-up, cleanup applied to a dictation, Whisper stays loaded
// between dictations (whisper-server), "raw" profile skips cleanup, a killed llama-server does not block
// dictation, quitting leaves no llama-server or whisper-server behind, and the native helper reads the
// text before the cursor in a real Notepad window.
//
// Usage: bun run build && bun scripts/e2e-cleanup/app-smoke.ts
// Needs: bun run e2e:cleanup once before (it renders the fixture audio), a whisper.cpp runtime and the
// large-v3-turbo + Qwen3.5 GGUF models in %APPDATA%\voxtype\models. Your real settings and history are not
// touched; the llama.cpp runtime is downloaded into the throwaway directory to exercise the installer.
// Artifacts: native/windows-helper/target/e2e/cleanup-app-smoke.{json,md} and cleanup-settings.png.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseCursorContext } from "../../src/shared/cursor-context";
import { appDataDir, createPipelineContext, e2eOutDir, tryGit } from "../e2e-dictation/pipeline";

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
    const page = await connectToRenderer();
    const whisperCli = createPipelineContext(join(e2eOutDir, "work")).whisperCli;

    await page.evaluate(`window.voxtype.settings.update(${JSON.stringify({
      modelDirectory: join(appDataDir(), "models"),
      whisperExecutablePath: whisperCli,
      dictationModeId: "local.custom",
      localCustomModelId: "large-v3-turbo",
      whisperLanguage: "en",
      llmCleanupBackend: "vulkan",
      appProfiles: [{ processName: "powershell.exe", writingStyle: "raw" }]
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

async function transcribe(page: RendererPage, wavPath: string, processName: string | null): Promise<{ text: string; cleanupStatus: string | null; cleanupMs: number | null; durationMs: number }> {
  const base64 = readFileSync(wavPath).toString("base64");
  return page.evaluate(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (char) => char.charCodeAt(0));
    const result = await window.voxtype.transcription.transcribeWav(bytes, { processName: ${JSON.stringify(processName)} });
    return { text: result.entry.text, cleanupStatus: result.entry.cleanup?.status ?? null, cleanupMs: result.entry.cleanup?.durationMs ?? null, durationMs: result.entry.durationMs };
  })()`);
}

// ---------- minimal CDP client ----------

interface RendererPage {
  evaluate<T>(expression: string): Promise<T>;
  screenshotSettings(path: string): Promise<void>;
  quitApp(): Promise<void>;
}

async function connectToRenderer(): Promise<RendererPage> {
  const targets = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/json/list`).catch(() => null);
    const list = response?.ok ? ((await response.json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>) : [];
    return list.find((target) => target.type === "page" && target.url.includes("index.html") && !target.url.includes("overlay")) ?? null;
  }, 30_000);
  if (!targets) {
    throw new Error("VoxType window did not appear on the DevTools port.");
  }

  const socket = await openSocket(targets.webSocketDebuggerUrl);
  await waitFor(async () => ((await send<{ result: { value: boolean } }>(socket, "Runtime.evaluate", { expression: "Boolean(window.voxtype)", returnByValue: true })).result.value ? true : null), 30_000);

  return {
    async evaluate<T>(expression: string): Promise<T> {
      const reply = await send<{ result: { value: T }; exceptionDetails?: { exception?: { description?: string } } }>(socket, "Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true
      });
      if (reply.exceptionDetails) {
        throw new Error(reply.exceptionDetails.exception?.description ?? "evaluate failed");
      }
      return reply.result.value;
    },
    async screenshotSettings(path: string): Promise<void> {
      // Settings were changed over IPC behind React's back; reload so the page shows the stored state.
      await send(socket, "Page.reload", {});
      await waitFor(async () => ((await send<{ result: { value: boolean } }>(socket, "Runtime.evaluate", { expression: "Boolean(document.querySelector('.release-settings-link'))", returnByValue: true })).result.value ? true : null), 30_000);
      await send(socket, "Runtime.evaluate", {
        expression: "document.querySelector('.release-settings-link')?.click(); document.querySelector('.release-scroll-panel')?.scrollTo(0, 0)"
      });
      await sleep(1_500);
      const shot = await send<{ data: string }>(socket, "Page.captureScreenshot", { format: "png" });
      writeFileSync(path, Buffer.from(shot.data, "base64"));
    },
    async quitApp(): Promise<void> {
      const version = (await (await fetch(`http://127.0.0.1:${String(port)}/json/version`)).json()) as { webSocketDebuggerUrl: string };
      const browser = await openSocket(version.webSocketDebuggerUrl);
      void send(browser, "Browser.close", {}).catch(() => undefined);
    }
  };
}

let nextId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolveSocket(socket));
    socket.addEventListener("error", () => reject(new Error(`CDP socket failed: ${url}`)));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      const waiter = message.id === undefined ? undefined : pending.get(message.id);
      if (waiter && message.id !== undefined) {
        pending.delete(message.id);
        if (message.error) {
          waiter.reject(new Error(message.error.message));
        } else {
          waiter.resolve(message.result);
        }
      }
    });
  });
}

function send<T>(socket: WebSocket, method: string, params: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolveReply, reject) => {
    // CDP replies are untyped JSON; callers state the shape of the one method they call.
    pending.set(id, { resolve: (value) => resolveReply(value as T), reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

// ---------- helpers ----------

function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${detail}`);
}

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe().catch(() => null);
    if (value !== null) {
      return value;
    }
    await sleep(250);
  }
  return null;
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

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
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
