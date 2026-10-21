// E2E for inserting a dictation into a window that is no longer in front. Windows' foreground lock lets
// SetForegroundWindow fail when the caller did not send the last input, which is the normal case for
// the helper VoxType spawns at insert time. Uses two throwaway WinForms windows: a target with a text
// box and a blocker in front of it that holds the foreground lock. Checks, in the built app over CDP:
// - a dictation lands in the target behind the blocker, once a bare SetForegroundWindow from a fresh
//   process has lost against the same setup (the bug);
// - a failed insert gives a readable error and leaves the clipboard alone;
// - the recording overlay: listening (real microphone) and error states never take keyboard focus or
//   clicks; an error stays up after the dictation ends, until the next dictation replaces it.
//
// Usage: bun run build && bun scripts/e2e-focus/run.ts   (or: bun run e2e:focus)
// Needs: the release helper (cargo build --release in native/windows-helper). Your real settings are not
// touched. While it runs, the test moves the foreground window, records a few seconds from the
// default microphone and overwrites the clipboard text, which it restores at the end.
// Artifacts: native/windows-helper/target/e2e/focus.{json,md} and overlay-*.png screenshots.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectToRenderer, sleep, waitFor, type RendererPage } from "../e2e-app/cdp";
import { e2eOutDir, tryGit } from "../e2e-dictation/pipeline";
import { defaultSpeechSegmentation } from "../../src/shared/speech-segments";

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

interface TestWindow {
  hwnd: string;
  process: ChildProcess;
}

interface HelperResult {
  status: number | null;
  output: string;
}

const helper = resolve("native/windows-helper/target/release/voxtype-windows-helper.exe");
const port = 9_400 + Math.floor(Math.random() * 500);
const workDir = mkdtempSync(join(tmpdir(), "voxtype-focus-"));
const userDataDir = join(workDir, "user-data");
const targetTextPath = join(workDir, "target.txt");
const typeTriggerPath = join(workDir, "type-into-blocker");
const checks: Check[] = [];

async function main(): Promise<void> {
  mkdirSync(e2eOutDir, { recursive: true });
  const savedClipboard = readClipboard();
  const target = await openWindow("voxtype-focus-target", { textPath: targetTextPath });
  const blocker = await openWindow("voxtype-focus-blocker", { typeTriggerPath, backdrop: true });
  try {
    await checkApp(target, blocker);
  } finally {
    target.process.kill();
    blocker.process.kill();
    writeClipboard(savedClipboard);
    await sleep(500);
    rmSync(workDir, { recursive: true, force: true });
    writeReport();
  }
}

async function checkApp(target: TestWindow, blocker: TestWindow): Promise<void> {
  const electron = resolve("node_modules/electron/dist/electron.exe");
  const env: Record<string, string | undefined> = { ...process.env, VOXTYPE_WINDOWS_HELPER_PATH: helper };
  // Hosts that are Electron apps themselves export ELECTRON_RUN_AS_NODE, which would start VoxType as Node.
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electron, [".", `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${String(port)}`], { stdio: ["ignore", "pipe", "pipe"], env });
  const log: string[] = [];
  for (const stream of [app.stdout, app.stderr]) {
    stream.on("data", (chunk: Buffer) => log.push(...chunk.toString("utf8").split(/\r?\n/).filter(Boolean)));
  }
  const appExited = new Promise<void>((done) => app.once("exit", () => done()));

  try {
    const page = await connectToRenderer(port);
    await page.evaluate(`window.voxtype.settings.update({ insertionMode: "clipboard", restoreClipboard: true })`);

    // Without a lost bare SetForegroundWindow the setup did not reproduce the bug, and a passing insert proves nothing.
    await bringToFront(blocker);
    const bare = spawnSync("powershell.exe", ["-NoProfile", "-Command",
      `Add-Type -Name U -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);'; [W.U]::SetForegroundWindow([IntPtr]${target.hwnd})`
    ], { encoding: "utf8" }).stdout.trim();
    const bugReproduced = bare === "False" && foregroundHwnd() === blocker.hwnd;
    const dictation = `Dictated behind a blocker ${String(Date.now())}.`;
    const inFront = await bringToFront(blocker);
    const inserted = await insertWindow(page, dictation, target.hwnd);
    const targetText = await waitFor(async () => (readTargetText().includes(dictation) ? readTargetText() : null), 3_000);
    check("dictation lands in the target behind the blocker", bugReproduced && inFront && inserted === "ok" && targetText !== null,
      `bare SetForegroundWindow returned ${bare}; blocker in front ${String(inFront)}; insert: ${inserted}; target holds ${JSON.stringify(readTargetText())}`);

    const userClipboard = `Clipboard the user set ${String(Date.now())}.`;
    writeClipboard(userClipboard);
    const failed = await insertWindow(page, "Dictation for a closed window.", "0x1");
    check("failed insert explains itself", failed.includes("e2e-target.exe") && !failed.includes("Command failed"), failed);
    check("failed insert leaves the clipboard alone", readClipboard() === userClipboard, `clipboard ${JSON.stringify(readClipboard())}`);

    await checkOverlay(page, blocker, app.pid ?? 0);

    await page.quitApp();
    await Promise.race([appExited, sleep(15_000)]);
  } finally {
    if (app.exitCode === null) {
      app.kill();
    }
    writeFileSync(join(e2eOutDir, "focus-app.log"), log.join("\n"));
  }
}

/** The overlay while dictating into the blocker: listening with the real microphone, working, and failed. */
async function checkOverlay(page: RendererPage, blocker: TestWindow, pid: number): Promise<void> {
  await bringToFront(blocker);
  await page.evaluate(`window.voxtype.windowsHelper.startRecording(${JSON.stringify({
    captureMode: "sharedCapture",
    inputDeviceId: "default",
    vadEnabled: false,
    realtimePcm16Enabled: false,
    speechSegmentation: defaultSpeechSegmentation
  })})`);
  await page.evaluate("window.voxtype.recordingOverlay.showRecording()");
  await sleep(2_500);
  const listening = overlayWindow(pid);
  check("listening overlay leaves keyboard focus and clicks alone",
    listening !== null && foregroundHwnd() === blocker.hwnd && !listening.receivesClicks,
    `overlay ${JSON.stringify(listening)}; foreground ${foregroundHwnd()}, blocker ${blocker.hwnd}`);
  captureOverlay(pid, "overlay-listening.png");
  await page.evaluate("window.voxtype.windowsHelper.stopRecording()");

  await page.evaluate("window.voxtype.recordingOverlay.showTranscribing()");
  await sleep(600);
  captureOverlay(pid, "overlay-transcribing.png");
  await page.evaluate(`window.voxtype.recordingOverlay.showRecording({ cloudProviderLabel: "Cloud Dictation", elapsedMs: 83000 })`);
  await sleep(600);
  captureOverlay(pid, "overlay-cloud.png");

  // A failed dictation reports its error and then hides the overlay as it ends.
  const shortError = "Could not insert the transcript into notepad.exe: The target window was closed. The transcript is in the history.";
  await page.evaluate(`window.voxtype.recordingOverlay.showError(${JSON.stringify(shortError)}).then(() => window.voxtype.recordingOverlay.hide())`);
  await sleep(800);
  const shortAlert = await overlayAlert();
  const shortWindow = overlayWindow(pid);
  check("error stays up after the dictation hides the overlay", shortWindow !== null && shortAlert.includes(shortError),
    `overlay ${shortWindow ? "visible" : "hidden"}, alert ${JSON.stringify(shortAlert)}`);
  check("error leaves keyboard focus and clicks alone", foregroundHwnd() === blocker.hwnd && shortWindow?.receivesClicks === false,
    `foreground ${foregroundHwnd()}, blocker ${blocker.hwnd}; overlay ${JSON.stringify(shortWindow)}`);
  captureOverlay(pid, "overlay-error.png");

  const longError = `Transcription failed: ${"whisper-server exited with code 3221225477 while loading the model, and whisper-cli could not start either. ".repeat(3)}Check the runtime in Settings.`;
  await page.evaluate(`window.voxtype.recordingOverlay.showError(${JSON.stringify(longError)})`);
  await sleep(800);
  captureOverlay(pid, "overlay-error-long.png");

  await page.evaluate("window.voxtype.recordingOverlay.showRecording()");
  await sleep(500);
  const listeningShown = await overlayDom<boolean>(`Boolean(document.querySelector('[aria-label="Listening"]'))`);
  const alertAfter = await overlayAlert();
  await page.evaluate("window.voxtype.recordingOverlay.hide()");
  await sleep(500);
  const hidden = overlayWindow(pid) === null;
  check("next dictation replaces the error", listeningShown && alertAfter === "" && hidden,
    `listening shown ${String(listeningShown)}, alert ${JSON.stringify(alertAfter)}, hidden after: ${String(hidden)}`);
}

/** Text of the overlay's error alert, or "" when none is shown. */
function overlayAlert(): Promise<string> {
  return overlayDom<string>(`document.querySelector('[role="alert"]')?.textContent ?? ""`);
}

/** Reads the overlay page. Connects each time, since the overlay window is recreated whenever it was hidden. */
async function overlayDom<T>(expression: string): Promise<T> {
  return (await connectToRenderer(port, "overlay")).evaluate<T>(expression);
}

function insertWindow(page: RendererPage, text: string, hwnd: string): Promise<string> {
  return page.evaluate<string>(`window.voxtype.insertion.insertWindow(${JSON.stringify(text)}, ${JSON.stringify(hwnd)}, "e2e-target.exe").then(() => "ok", (error) => String(error?.message ?? error))`);
}

// ---------- windows ----------

/**
 * A WinForms window in its own process. `textPath`: a text box whose content is mirrored to that file.
 * `typeTriggerPath`: when that file appears, the window deletes it, presses F24 (unassigned) and locks
 * the foreground with LockSetForegroundWindow. `backdrop`: maximized and light, so the overlay screenshots
 * show what is behind the overlay's card.
 */
async function openWindow(title: string, options: { textPath?: string; typeTriggerPath?: string; backdrop?: boolean }): Promise<TestWindow> {
  const { textPath, typeTriggerPath: triggerPath, backdrop } = options;
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$form = New-Object System.Windows.Forms.Form",
    `$form.Text = '${title}'`,
    "$form.Width = 520; $form.Height = 320",
    backdrop ? "$form.WindowState = 'Maximized'; $form.BackColor = [System.Drawing.Color]::FromArgb(226, 232, 238)" : "",
    textPath
      ? `$box = New-Object System.Windows.Forms.TextBox; $box.Multiline = $true; $box.Dock = 'Fill'; $form.Controls.Add($box); $box.Add_TextChanged({ [IO.File]::WriteAllText('${textPath}', $box.Text) })`
      : "",
    triggerPath
      ? [
          `Add-Type -Name K -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra); [DllImport("user32.dll")] public static extern bool LockSetForegroundWindow(uint code);'`,
          "$timer = New-Object System.Windows.Forms.Timer; $timer.Interval = 50",
          `$timer.Add_Tick({ if ([IO.File]::Exists('${triggerPath}')) { [W.K]::keybd_event(0x87, 0, 0, [UIntPtr]::Zero); [W.K]::keybd_event(0x87, 0, 2, [UIntPtr]::Zero); [void][W.K]::LockSetForegroundWindow(1); [IO.File]::Delete('${triggerPath}') } })`,
          "$timer.Start()"
        ].join("; ")
      : "",
    "$form.Add_Shown({ [Console]::Out.WriteLine(('0x{0:x}' -f $form.Handle.ToInt64())); [Console]::Out.Flush() })",
    "[System.Windows.Forms.Application]::Run($form)"
  ].filter(Boolean).join("; ");
  const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", script], { stdio: ["ignore", "pipe", "ignore"] });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  const hwnd = await waitFor(async () => /0x[0-9a-f]+/.exec(output)?.[0] ?? null, 15_000);
  if (!hwnd) {
    child.kill();
    throw new Error(`Test window ${title} did not open.`);
  }
  return { hwnd, process: child };
}

/**
 * Focuses the blocker, then has it press a key and lock the foreground. Windows arms the foreground lock
 * on hardware input, which an unattended run has none of; LockSetForegroundWindow arms it on demand.
 */
async function bringToFront(blocker: TestWindow): Promise<boolean> {
  runHelper(helper, ["focus-window", blocker.hwnd]);
  const inFront = (await waitFor(async () => (foregroundHwnd() === blocker.hwnd ? true : null), 2_000)) === true;
  writeFileSync(typeTriggerPath, "");
  await waitFor(async () => (existsSync(typeTriggerPath) ? null : true), 2_000);
  return inFront;
}

function foregroundHwnd(): string {
  const output = runHelper(helper, ["active-window"]).output;
  return (JSON.parse(output) as { hwnd?: string }).hwnd ?? "none";
}

function readTargetText(): string {
  return existsSync(targetTextPath) ? readFileSync(targetTextPath, "utf8") : "";
}

interface OverlayWindow {
  hwnd: string;
  /** Whether a click at the card's center would land on the overlay rather than the window below. */
  receivesClicks: boolean;
}

/** The app's visible overlay window (the only one narrower than the main window), or null. */
function overlayWindow(pid: number): OverlayWindow | null {
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Z {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  public static string Overlay(uint pid) {
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    string found = "";
    EnumWindows((hwnd, _) => {
      uint owner; GetWindowThreadProcessId(hwnd, out owner);
      RECT r;
      if (owner != pid || !IsWindowVisible(hwnd) || !GetWindowRect(hwnd, out r) || r.Right - r.Left >= 900) return true;
      POINT p; p.X = (r.Left + r.Right) / 2; p.Y = (r.Top + r.Bottom) / 2;
      bool hit = GetAncestor(WindowFromPoint(p), 2) == hwnd;
      found = String.Format("{{\\"hwnd\\":\\"0x{0:x}\\",\\"receivesClicks\\":{1}}}", hwnd.ToInt64(), hit ? "true" : "false");
      return false;
    }, IntPtr.Zero);
    return found;
  }
}
'@
[Z]::Overlay(${String(pid)})`;
  const output = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" }).stdout.trim();
  // The JSON is built by the C# above with exactly these fields.
  return output ? (JSON.parse(output) as OverlayWindow) : null;
}

function captureOverlay(pid: number, fileName: string): void {
  const overlay = overlayWindow(pid);
  if (overlay) {
    runHelper(helper, ["capture-screenshot", join(e2eOutDir, fileName), "--hwnd", overlay.hwnd]);
  }
}

function readClipboard(): string {
  return spawnSync("powershell.exe", ["-NoProfile", "-STA", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" }).stdout.replace(/\r?\n$/, "");
}

function writeClipboard(text: string): void {
  spawnSync("powershell.exe", ["-NoProfile", "-STA", "-Command", "$input | Out-String | ForEach-Object { Set-Clipboard -Value $_.TrimEnd([char]13, [char]10) }"], { input: text });
}

function runHelper(path: string, args: string[]): HelperResult {
  const result = spawnSync(path, args, { encoding: "utf8", timeout: 10_000 });
  return { status: result.status, output: result.stdout.trim() };
}

// ---------- report ----------

function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${detail}`);
}

function writeReport(): void {
  const passed = checks.filter((item) => item.pass).length;
  const report = { generatedAt: new Date().toISOString(), gitCommit: tryGit(["rev-parse", "HEAD"]), gitDirty: tryGit(["status", "--porcelain"]) !== "", passed, total: checks.length, checks };
  const base = join(e2eOutDir, "focus");
  writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`${base}.md`, [
    "# Focus and insertion E2E",
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
