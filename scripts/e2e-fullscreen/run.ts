// E2E for "Suspend dictation hotkeys in fullscreen apps". Opens a borderless window covering the primary
// monitor (what a borderless-fullscreen game like Dragon's Dogma 2 looks like to Windows) and checks:
// - the helper reports it as fullscreen, also on a display with Windows scaling above 100%;
// - the built app over CDP: while that window is focused the dictation hotkey is unregistered and
//   pressing it starts nothing; once a normal window (Notepad) is focused the hotkey works again.
//
// Usage: bun run build && bun scripts/e2e-fullscreen/run.ts   (or: bun run e2e:fullscreen)
// Needs: the release helper (cargo build --release in native/windows-helper), a whisper.cpp runtime and
// the large-v3-turbo model in %APPDATA%\voxtype\models. Your real settings are not touched. The test
// covers the screen with a black window for a few seconds and presses Ctrl+Alt+F14.
// VOXTYPE_WINDOWS_HELPER_PATH overrides the helper, e.g. to show an older build fails.
// Artifacts: native/windows-helper/target/e2e/fullscreen.{json,md}.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectToRenderer, sleep, waitFor, type RendererPage } from "../e2e-app/cdp";
import { appDataDir, createPipelineContext, e2eOutDir, tryGit } from "../e2e-dictation/pipeline";

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

interface ActiveWindow {
  hwnd: string;
  processName?: string;
  bounds?: { width: number; height: number } | null;
  fullscreen: boolean;
}

interface HotkeyStatus {
  dictationToggleHotkey: string | null;
  dictationSuspendedForFullscreen: boolean;
  fullscreenProcessName: string | null;
}

// Ctrl+Space would collide with a running VoxType; F14 is unassigned.
const hotkey = "CommandOrControl+Alt+F14";
const helper = resolve(process.env.VOXTYPE_WINDOWS_HELPER_PATH ?? "native/windows-helper/target/release/voxtype-windows-helper.exe");
const port = 9_400 + Math.floor(Math.random() * 500);
const userDataDir = mkdtempSync(join(tmpdir(), "voxtype-fullscreen-"));
const checks: Check[] = [];
mkdirSync(e2eOutDir, { recursive: true });

async function main(): Promise<void> {
  // Windows 11 Notepad opens files as tabs of one process; closing ours must not take other documents along.
  if (spawnSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process notepad -ErrorAction SilentlyContinue).Count"], { encoding: "utf8" }).stdout.trim() !== "0") {
    throw new Error("Close Notepad before running this test; it opens and force-closes its own Notepad window.");
  }
  const notepad = openNotepad();
  const cover = openFullscreenWindow();
  try {
    const coverHwnd = await waitFor(async () => findWindow("powershell", cover.title), 10_000);
    const notepadHwnd = await waitFor(async () => findWindow("notepad", notepad.title), 10_000);
    if (!coverHwnd || !notepadHwnd) {
      throw new Error(`Test windows did not appear (fullscreen ${String(coverHwnd)}, notepad ${String(notepadHwnd)}).`);
    }
    checkHelper(coverHwnd, notepadHwnd);
    await checkApp(coverHwnd, notepadHwnd);
  } finally {
    cover.process.kill();
    spawnSync("powershell.exe", ["-NoProfile", "-Command", `Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*${notepad.title}*' } | Stop-Process -Force`]);
    notepad.process.kill();
    await sleep(500);
    rmSync(userDataDir, { recursive: true, force: true });
    writeReport();
  }
}

function checkHelper(coverHwnd: string, notepadHwnd: string): void {
  const covered = focusAndRead(coverHwnd);
  check("fullscreen window is in front", covered.hwnd === coverHwnd, `foreground ${covered.hwnd} (${covered.processName ?? "?"}), expected ${coverHwnd}`);
  check("helper reports it as fullscreen", covered.fullscreen, `bounds ${describeBounds(covered)}, fullscreen ${String(covered.fullscreen)}, Windows scaling ${String(scalingPercent())}%`);

  const normal = focusAndRead(notepadHwnd);
  check("helper reports Notepad as not fullscreen", normal.hwnd === notepadHwnd && !normal.fullscreen, `foreground ${normal.processName ?? "?"}, bounds ${describeBounds(normal)}, fullscreen ${String(normal.fullscreen)}`);
}

async function checkApp(coverHwnd: string, notepadHwnd: string): Promise<void> {
  const electron = resolve("node_modules/electron/dist/electron.exe");
  const env: Record<string, string | undefined> = { ...process.env, VOXTYPE_WINDOWS_HELPER_PATH: helper };
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
      dictationHoldHotkey: hotkey,
      suspendDictationHotkeysInFullscreenApps: true
    })})`);

    // The app re-checks the foreground window every 2 s.
    focus(coverHwnd);
    const suspended = await waitFor(async () => {
      const status = await hotkeyStatus(page);
      return status.dictationSuspendedForFullscreen ? status : null;
    }, 6_000);
    const afterCover = await hotkeyStatus(page);
    check("app suspends the hotkey for the fullscreen window", suspended !== null && afterCover.dictationToggleHotkey === null,
      `suspended ${String(afterCover.dictationSuspendedForFullscreen)} for ${String(afterCover.fullscreenProcessName)}, registered ${String(afterCover.dictationToggleHotkey)}`);

    const before = await dictationState(page);
    press(coverHwnd);
    await sleep(1_500);
    const afterPress = await dictationState(page);
    check("hotkey in the fullscreen window starts nothing", !afterPress.recording && afterPress.sessionId === before.sessionId,
      `recording ${String(afterPress.recording)}, sessions ${String(before.sessionId)} → ${String(afterPress.sessionId)}`);

    focus(notepadHwnd);
    const resumed = await waitFor(async () => {
      const status = await hotkeyStatus(page);
      return !status.dictationSuspendedForFullscreen && status.dictationToggleHotkey === hotkey ? status : null;
    }, 6_000);
    check("app re-registers the hotkey for a normal window", resumed !== null, `registered ${String((await hotkeyStatus(page)).dictationToggleHotkey)}`);

    press(notepadHwnd);
    const started = await waitFor(async () => ((await dictationState(page)).recording ? true : null), 5_000);
    await sleep(1_000);
    press(notepadHwnd);
    const stopped = await waitFor(async () => (!(await dictationState(page)).recording ? true : null), 5_000);
    check("hotkey in Notepad starts and stops dictation", started === true && stopped === true,
      `started ${String(started === true)}, stopped ${String(stopped === true)}`);

    await sleep(2_000);
    await page.quitApp();
    await Promise.race([appExited, sleep(15_000)]);
  } finally {
    if (app.exitCode === null) {
      app.kill();
    }
    writeFileSync(join(e2eOutDir, "fullscreen-app.log"), log.join("\n"));
  }
}

// ---------- windows ----------

function openNotepad(): { title: string; process: ReturnType<typeof spawn> } {
  const title = `voxtype-fullscreen-${String(Date.now())}`;
  const file = join(userDataDir, `${title}.txt`);
  writeFileSync(file, "");
  return { title, process: spawn("notepad.exe", [file], { stdio: "ignore" }) };
}

/** A borderless black window over the whole primary monitor, open until the process is killed. */
function openFullscreenWindow(): { title: string; process: ReturnType<typeof spawn> } {
  const title = `voxtype-fullscreen-cover-${String(Date.now())}`;
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$form = New-Object System.Windows.Forms.Form",
    "$form.FormBorderStyle = 'None'",
    "$form.StartPosition = 'Manual'",
    "$form.Bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
    "$form.BackColor = 'Black'",
    `$form.Text = '${title}'`,
    "[void]$form.ShowDialog()"
  ].join("; ");
  return { title, process: spawn("powershell.exe", ["-NoProfile", "-Command", script], { stdio: "ignore" }) };
}

function findWindow(processName: string, title: string): Promise<string | null> {
  const hwnd = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-Process ${processName} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*${title}*' } | Select-Object -First 1 | ForEach-Object { '0x{0:x}' -f $_.MainWindowHandle.ToInt64() }`
  ], { encoding: "utf8" }).stdout.trim();
  return Promise.resolve(hwnd || null);
}

/**
 * Brings a window to the front. The foreground lock refuses SetForegroundWindow from a background process
 * unless it sent the last input, so tap F24 (unassigned) from the same process first.
 */
function focus(hwnd: string): void {
  spawnSync("powershell.exe", ["-NoProfile", "-Command", [
    "Add-Type -Name F -Namespace W -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(System.IntPtr hwnd);'",
    "[W.F]::keybd_event(0x87, 0, 0, [UIntPtr]::Zero)",
    "[W.F]::keybd_event(0x87, 0, 2, [UIntPtr]::Zero)",
    `[void][W.F]::SetForegroundWindow([IntPtr]${hwnd})`
  ].join("; ")]);
}

function focusAndRead(hwnd: string): ActiveWindow {
  focus(hwnd);
  spawnSync("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 400"]);
  return activeWindow();
}

/** Taps the dictation hotkey into the given window. */
function press(hwnd: string): void {
  focus(hwnd);
  spawnSync(helper, ["send-hotkey", hotkey]);
}

function activeWindow(): ActiveWindow {
  const output = spawnSync(helper, ["active-window"], { encoding: "utf8" }).stdout;
  return JSON.parse(output) as ActiveWindow;
}

function describeBounds(window: ActiveWindow): string {
  return window.bounds ? `${String(window.bounds.width)}x${String(window.bounds.height)}` : "none";
}

function scalingPercent(): number {
  const output = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "(Get-ItemProperty 'HKCU:\\Control Panel\\Desktop\\WindowMetrics' -Name AppliedDPI -ErrorAction SilentlyContinue).AppliedDPI"
  ], { encoding: "utf8" }).stdout.trim();
  const dpi = Number.parseInt(output, 10);
  return Number.isFinite(dpi) ? Math.round((dpi / 96) * 100) : 100;
}

// ---------- state ----------

function hotkeyStatus(page: RendererPage): Promise<HotkeyStatus> {
  return page.evaluate<HotkeyStatus>("window.voxtype.hotkeys.status()");
}

function dictationState(page: RendererPage): Promise<{ recording: boolean; sessionId: number }> {
  return page.evaluate("window.voxtype.dictation.getHotkeyState().then(({ recording, sessionId }) => ({ recording, sessionId }))");
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
  const report = { generatedAt: new Date().toISOString(), gitCommit: tryGit(["rev-parse", "HEAD"]), gitDirty: tryGit(["status", "--porcelain"]) !== "", helper, passed, total: checks.length, checks };
  const base = join(e2eOutDir, "fullscreen");
  writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`${base}.md`, [
    "# Fullscreen hotkey suspension E2E",
    "",
    `Generated ${report.generatedAt} at ${String(report.gitCommit)}${report.gitDirty ? " (dirty)" : ""} with ${helper}. Passed ${String(passed)}/${String(checks.length)}.`,
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
// A CDP socket can outlive the app and keep Bun's event loop alive.
process.exit();
