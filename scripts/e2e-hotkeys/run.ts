// E2E for modifier-only dictation hotkeys (Ctrl+Win). Presses real key events with SendInput into a
// throwaway Notepad window and checks:
// - the native keyboard hook: exact set match, interruption by another key, Start menu stays closed;
// - the built app over CDP: tap starts, tap stops, Ctrl+Win+F13 discards the dictation it started,
//   Ctrl+Shift+Win is ignored, holding records only while held, nothing is typed into the target, and
//   the hook process exits with the app.
//
// Usage: bun run build && bun scripts/e2e-hotkeys/run.ts   (or: bun run e2e:hotkeys)
// Needs: the release helper (cargo build --release in native/windows-helper), a whisper.cpp runtime and
// the large-v3-turbo model in %APPDATA%\voxtype\models. Your real settings are not touched. The test
// presses Ctrl, Win, Shift and F13 on this desktop for about half a minute; F13 is unassigned.
// Artifacts: native/windows-helper/target/e2e/hotkeys.{json,md}.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectToRenderer, sleep, waitFor, type RendererPage } from "../e2e-app/cdp";
import { appDataDir, createPipelineContext, e2eOutDir, tryGit } from "../e2e-dictation/pipeline";

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

interface HotkeyState {
  recording: boolean;
  sessionId: number;
}

const hotkey = "CommandOrControl+Super";
const helper = resolve("native/windows-helper/target/release/voxtype-windows-helper.exe");
const port = 9_400 + Math.floor(Math.random() * 500);
const userDataDir = mkdtempSync(join(tmpdir(), "voxtype-hotkeys-"));
const checks: Check[] = [];

async function main(): Promise<void> {
  // Windows 11 Notepad opens files as tabs of one process; closing ours must not take other documents along.
  if (spawnSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process notepad -ErrorAction SilentlyContinue).Count"], { encoding: "utf8" }).stdout.trim() !== "0") {
    throw new Error("Close Notepad before running this test; it opens and force-closes its own Notepad window.");
  }
  const notepad = openNotepad();
  try {
    await sleep(1_500);
    await checkHelperHook(notepad.title);
    await checkApp(notepad.title);
  } finally {
    spawnSync("powershell.exe", ["-NoProfile", "-Command", `Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*${notepad.title}*' } | Stop-Process -Force`]);
    notepad.process.kill();
    await sleep(500);
    rmSync(userDataDir, { recursive: true, force: true });
    writeReport();
  }
}

async function checkHelperHook(notepadTitle: string): Promise<void> {
  const watcher = spawn(helper, ["modifier-hotkeys", "--include-injected", hotkey, "CommandOrControl+Alt"], { stdio: ["pipe", "pipe", "pipe"] });
  const events: string[] = [];
  watcher.stdout.on("data", (chunk: Buffer) => events.push(...chunk.toString("utf8").split(/\r?\n/).filter(Boolean)));

  try {
    const ready = await waitFor(async () => (events.some((line) => line.includes('"ready"')) ? true : null), 5_000);
    check("hook starts", ready === true, events.join(" ") || "no output");

    const pressed = await eventsAfter(events, () => press(notepadTitle, hotkey));
    check("Ctrl+Win fires", sameEvents(pressed, [`pressed ${hotkey}`]), pressed.join(", ") || "no events");
    const foreground = activeProcess();
    check("Start menu stays closed", foreground.toLowerCase() === "notepad.exe", `foreground after Ctrl+Win: ${foreground}`);

    const interrupted = await eventsAfter(events, () => press(notepadTitle, `${hotkey}+F13`));
    check("another key interrupts", sameEvents(interrupted, [`pressed ${hotkey}`, `interrupted ${hotkey}`]), interrupted.join(", ") || "no events");

    const superset = await eventsAfter(events, () => press(notepadTitle, "CommandOrControl+Shift+Super"));
    const withKey = await eventsAfter(events, () => press(notepadTitle, "CommandOrControl+F13"));
    check("only the exact set fires", superset.length === 0 && withKey.length === 0,
      `Ctrl+Shift+Win: ${superset.join(", ") || "none"}; Ctrl+F13: ${withKey.join(", ") || "none"}`);

    const other = await eventsAfter(events, () => press(notepadTitle, "CommandOrControl+Alt"));
    check("several hotkeys in one hook", sameEvents(other, ["pressed CommandOrControl+Alt"]), other.join(", ") || "no events");

    const release = spawnSync(helper, ["wait-hotkey-release", hotkey], { encoding: "utf8", timeout: 5_000 });
    const single = spawnSync(helper, ["modifier-hotkeys", "Super"], { encoding: "utf8", input: "" });
    check("modifier-only accelerators parse", release.status === 0 && single.status === 1 && single.stdout.includes("two modifiers"),
      `wait-hotkey-release exit ${String(release.status)}; lone Win rejected: ${single.stdout.trim()}`);
  } finally {
    watcher.stdin.end();
    await sleep(300);
    check("hook exits when stdin closes", watcher.exitCode === 0, `exit code ${String(watcher.exitCode)}`);
    if (watcher.exitCode === null) {
      watcher.kill();
    }
  }
}

async function checkApp(notepadTitle: string): Promise<void> {
  const electron = resolve("node_modules/electron/dist/electron.exe");
  const env: Record<string, string | undefined> = {
    ...process.env,
    VOXTYPE_E2E_INJECTED_HOTKEYS: "1",
    VOXTYPE_WINDOWS_HELPER_PATH: helper
  };
  // Hosts that are Electron apps themselves export ELECTRON_RUN_AS_NODE, which would start VoxType as Node.
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electron, [".", `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${String(port)}`], { stdio: ["ignore", "pipe", "pipe"], env });
  const log: string[] = [];
  collectLog(app, log);
  const appExited = new Promise<void>((done) => app.once("exit", () => done()));

  try {
    const page = await connectToRenderer(port);
    await page.evaluate(`window.voxtype.settings.update(${JSON.stringify({
      modelDirectory: join(appDataDir(), "models"),
      whisperExecutablePath: createPipelineContext(join(e2eOutDir, "work")).whisperCli,
      dictationModeId: "local.custom",
      localCustomModelId: "large-v3-turbo",
      dictationToggleHotkey: hotkey,
      dictationHoldHotkey: hotkey
    })})`);
    const status = await page.evaluate<{ dictationToggleHotkey: string | null }>("window.voxtype.hotkeys.status()");
    check("app registers Ctrl+Win", status.dictationToggleHotkey === hotkey, `registered: ${String(status.dictationToggleHotkey)}`);
    await waitFor(async () => (watcherRunning() ? true : null), 5_000);
    const start = await hotkeyState(page);

    press(notepadTitle, hotkey);
    const started = await waitFor(async () => ((await hotkeyState(page)).recording ? true : null), 5_000);
    await sleep(1_000);
    press(notepadTitle, hotkey);
    const stopped = await waitFor(async () => (!(await hotkeyState(page)).recording ? true : null), 5_000);
    const afterToggle = await hotkeyState(page);
    check("tap starts, next tap stops", started === true && stopped === true && afterToggle.sessionId === start.sessionId + 1,
      `started ${String(started === true)}, stopped ${String(stopped === true)}, sessions ${String(start.sessionId)} → ${String(afterToggle.sessionId)}`);

    await sleep(1_500);
    press(notepadTitle, `${hotkey}+F13`);
    await sleep(2_000);
    const afterInterrupt = await hotkeyState(page);
    check("Ctrl+Win+key discards its dictation", !afterInterrupt.recording && afterInterrupt.sessionId === afterToggle.sessionId + 1 && log.some((line) => line.includes("dictation discarded")),
      `session ${String(afterInterrupt.sessionId)} started and ${afterInterrupt.recording ? "still recording" : "stopped"}; discard logged: ${String(log.some((line) => line.includes("dictation discarded")))}`);

    press(notepadTitle, "CommandOrControl+Shift+Super");
    await sleep(1_000);
    const afterSuperset = await hotkeyState(page);
    check("Ctrl+Shift+Win is ignored", !afterSuperset.recording && afterSuperset.sessionId === afterInterrupt.sessionId,
      `sessions ${String(afterInterrupt.sessionId)} → ${String(afterSuperset.sessionId)}`);

    focusNotepad(notepadTitle);
    const holding = holdKeys(1_500);
    const recordingWhileHeld = await waitFor(async () => ((await hotkeyState(page)).recording ? true : null), 1_400);
    await holding;
    const releasedAfterHold = await waitFor(async () => (!(await hotkeyState(page)).recording ? true : null), 5_000);
    check("holding records only while held", recordingWhileHeld === true && releasedAfterHold === true,
      `recording while held ${String(recordingWhileHeld === true)}, stopped on release ${String(releasedAfterHold === true)}`);

    // Every dictation above was silence, so nothing may reach the target; F13 and the mask key type nothing.
    await sleep(2_000);
    focusNotepad(notepadTitle);
    const text = notepadText();
    check("nothing typed into the target", text === "", `Notepad holds ${JSON.stringify(text)}`);

    await page.quitApp();
    await Promise.race([appExited, sleep(15_000)]);
    await sleep(500);
    check("hook exits with the app", app.exitCode !== null && !watcherRunning(), `app ${app.exitCode !== null ? "exited" : "running"}, hook ${watcherRunning() ? "still running" : "gone"}`);
  } finally {
    if (app.exitCode === null) {
      app.kill();
    }
    writeFileSync(join(e2eOutDir, "hotkeys-app.log"), log.join("\n"));
  }
}

// ---------- key input ----------

function openNotepad(): { title: string; process: ReturnType<typeof spawn> } {
  const title = `voxtype-hotkeys-${String(Date.now())}`;
  const file = join(userDataDir, `${title}.txt`);
  writeFileSync(file, "");
  return { title, process: spawn("notepad.exe", [file], { stdio: "ignore" }) };
}

function focusNotepad(title: string): void {
  const hwnd = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*${title}*' } | Select-Object -First 1 | ForEach-Object { '{0:x}' -f $_.MainWindowHandle.ToInt64() }`
  ], { encoding: "utf8" }).stdout.trim();
  if (hwnd) {
    spawnSync(helper, ["focus-window", hwnd]);
  }
}

/** Taps a key combination (all keys down, then up in reverse) into the Notepad window. */
function press(notepadTitle: string, accelerator: string): void {
  focusNotepad(notepadTitle);
  spawnSync(helper, ["send-hotkey", accelerator]);
}

/** Holds Ctrl+Win for `ms`; send-hotkey can only tap. */
function holdKeys(ms: number): Promise<void> {
  const script = [
    "Add-Type -Name K -Namespace W -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);'",
    "[W.K]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)",
    "[W.K]::keybd_event(0x5B, 0, 1, [UIntPtr]::Zero)",
    `Start-Sleep -Milliseconds ${String(ms)}`,
    "[W.K]::keybd_event(0x5B, 0, 3, [UIntPtr]::Zero)",
    "[W.K]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)"
  ].join("; ");
  return new Promise((done) => {
    spawn("powershell.exe", ["-NoProfile", "-Command", script], { stdio: "ignore" }).once("exit", () => done());
  });
}

async function eventsAfter(events: string[], action: () => void): Promise<string[]> {
  const from = events.length;
  action();
  await sleep(400);
  return events.slice(from).map((line) => {
    const parsed = JSON.parse(line) as { event: string; accelerator?: string };
    return `${parsed.event} ${parsed.accelerator ?? ""}`.trim();
  });
}

function sameEvents(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((event, index) => event === expected[index]);
}

// ---------- state ----------

function hotkeyState(page: RendererPage): Promise<HotkeyState> {
  return page.evaluate<HotkeyState>("window.voxtype.dictation.getHotkeyState().then(({ recording, sessionId }) => ({ recording, sessionId }))");
}

/** Whole text of the focused Notepad document, read through UI Automation; null if unreadable. */
function notepadText(): string | null {
  const output = spawnSync(helper, ["focused-text", "2000", "2000"], { encoding: "utf8" }).stdout.trim();
  const parsed = JSON.parse(output) as { before?: unknown; after?: unknown; source?: unknown };
  return parsed.source !== "none" && typeof parsed.before === "string" && typeof parsed.after === "string" ? parsed.before + parsed.after : null;
}

function activeProcess(): string {
  const output = spawnSync(helper, ["active-window"], { encoding: "utf8" }).stdout;
  return (JSON.parse(output) as { processName?: string }).processName ?? "unknown";
}

function watcherRunning(): boolean {
  const output = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    `@(Get-CimInstance Win32_Process -Filter "Name = 'voxtype-windows-helper.exe'" | Where-Object { $_.CommandLine -like '*modifier-hotkeys*' -and $_.CommandLine -like '*--include-injected*' }).Count`
  ], { encoding: "utf8" }).stdout.trim();
  return (Number.parseInt(output, 10) || 0) > 0;
}

function collectLog(app: ReturnType<typeof spawn>, log: string[]): void {
  for (const stream of [app.stdout, app.stderr]) {
    stream?.on("data", (chunk: Buffer) => log.push(...chunk.toString("utf8").split(/\r?\n/).filter(Boolean)));
  }
}

// ---------- report ----------

function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${detail}`);
}

function writeReport(): void {
  const passed = checks.filter((item) => item.pass).length;
  const report = { generatedAt: new Date().toISOString(), gitCommit: tryGit(["rev-parse", "HEAD"]), gitDirty: tryGit(["status", "--porcelain"]) !== "", passed, total: checks.length, checks };
  const base = join(e2eOutDir, "hotkeys");
  writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`${base}.md`, [
    "# Modifier-only hotkey E2E",
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
