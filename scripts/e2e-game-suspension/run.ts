// E2E for "Suspend dictation hotkeys in games". Registers a fake game in a throwaway copy of the
// GameConfigStore key (Xbox Game Bar's list of recognized games) and opens three windows:
// - a normal, windowed form run by a copy of powershell.exe named voxtype-e2e-game.exe (the game);
// - a maximized form run by the regular powershell.exe (an editor or browser);
// - a borderless form covering the primary monitor run by powershell.exe (a browser in F11, a video player).
// Drives the built app over CDP and presses the hotkey in each window: the settings migration from the
// old fullscreen keys, suspension for the game only, and the per-app Never and Always overrides.
//
// Usage: bun run build && bun scripts/e2e-game-suspension/run.ts   (or: bun run e2e:game-suspension)
// Needs: the release helper (cargo build --release in native/windows-helper), a whisper.cpp runtime and
// the large-v3-turbo model in %APPDATA%\voxtype\models. Your real settings and your real Game Bar list
// are not touched. The test steals focus for a few seconds and presses Ctrl+Alt+F14.
// VOXTYPE_WINDOWS_HELPER_PATH overrides the helper.
// Artifacts: native/windows-helper/target/e2e/game-suspension.{json,md} and game-suspension-app.log.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  title: string;
  processId: number;
  processPath: string | null;
  processName: string | null;
  isGame: boolean;
}

interface HotkeyStatus {
  dictationToggleHotkey: string | null;
  dictationSuspendedForGame: boolean;
}

type Suspension = "auto" | "always" | "never";

interface LoadedSettings {
  suspendDictationHotkeysInGames: boolean;
  appProfiles: Array<{ processName: string; dictationHotkeySuspension: Suspension }>;
}

interface TestWindow {
  title: string;
  process: ReturnType<typeof spawn>;
}

// Ctrl+Space would collide with a running VoxType; F14 is unassigned.
const hotkey = "CommandOrControl+Alt+F14";
const gameExeName = "voxtype-e2e-game.exe";
const helper = resolve(process.env.VOXTYPE_WINDOWS_HELPER_PATH ?? "native/windows-helper/target/release/voxtype-windows-helper.exe");
const port = 9_400 + Math.floor(Math.random() * 500);
const userDataDir = mkdtempSync(join(tmpdir(), "voxtype-game-suspension-"));
// realpath expands 8.3 short names so the path matches what Windows reports for the running process.
const gameDir = realpathSync.native(mkdtempSync(join(tmpdir(), "voxtype-e2e-game-")));
const gameExe = join(gameDir, gameExeName);
const registryRoot = `Software\\VoxType-E2E-${String(Date.now())}`;
const gameConfigStoreKey = `${registryRoot}\\Children`;
const checks: Check[] = [];
mkdirSync(e2eOutDir, { recursive: true });

async function main(): Promise<void> {
  copyFileSync("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", gameExe);
  registerFakeGame();
  const game = openForm(gameExe, "game", ["$form.Size = New-Object System.Drawing.Size(800, 600)"]);
  const maximized = openForm("powershell.exe", "maximized", ["$form.WindowState = 'Maximized'"]);
  const cover = openForm("powershell.exe", "cover", [
    "$form.FormBorderStyle = 'None'",
    "$form.Bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
    "$form.BackColor = 'Black'"
  ]);
  try {
    const gameHwnd = await waitFor(async () => findWindow("voxtype-e2e-game", game.title), 15_000);
    const maximizedHwnd = await waitFor(async () => findWindow("powershell", maximized.title), 15_000);
    const coverHwnd = await waitFor(async () => findWindow("powershell", cover.title), 15_000);
    if (!gameHwnd || !maximizedHwnd || !coverHwnd) {
      throw new Error(`Test windows did not appear (game ${String(gameHwnd)}, maximized ${String(maximizedHwnd)}, cover ${String(coverHwnd)}).`);
    }
    const windows = { game: gameHwnd, maximized: maximizedHwnd, cover: coverHwnd };
    await checkApp(windows);
  } finally {
    for (const window of [game, maximized, cover]) {
      window.process.kill();
    }
    spawnSync("reg.exe", ["delete", `HKCU\\${registryRoot}`, "/f"]);
    await sleep(500);
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(gameDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    writeReport();
  }
}

async function checkApp(windows: { game: string; maximized: string; cover: string }): Promise<void> {
  writeLegacySettings();
  const electron = resolve("node_modules/electron/dist/electron.exe");
  const env: Record<string, string | undefined> = {
    ...process.env,
    VOXTYPE_WINDOWS_HELPER_PATH: helper,
    VOXTYPE_GAME_CONFIG_STORE_KEY: gameConfigStoreKey
  };
  // Hosts that are Electron apps themselves export ELECTRON_RUN_AS_NODE, which would start VoxType as Node.
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electron, [".", `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${String(port)}`], { stdio: ["ignore", "pipe", "pipe"], env });
  const log: string[] = [];
  collectLog(app, log);
  const appExited = new Promise<void>((done) => app.once("exit", () => done()));

  try {
    const page = await connectToRenderer(port);
    await checkMigration(page);
    await page.evaluate(`window.voxtype.settings.update(${JSON.stringify({
      modelDirectory: join(appDataDir(), "models"),
      whisperExecutablePath: createPipelineContext(join(e2eOutDir, "work")).whisperCli,
      dictationModeId: "local.custom",
      localCustomModelId: "large-v3-turbo",
      dictationToggleHotkey: hotkey,
      dictationHoldHotkey: hotkey,
      suspendDictationHotkeysInGames: true
    })})`);
    await setProfileSuspension(page, focusAndRead(windows.game), "auto");

    // The app re-checks the foreground window every 2 s.
    focus(windows.game);
    await waitForStatus(page, (status) => status.dictationSuspendedForGame);
    const inGame = await tapStartsDictation(page, windows.game);
    check("hotkey in the game starts no dictation", !inGame, `dictation started ${String(inGame)} (expected false)`);

    focus(windows.maximized);
    await waitForStatus(page, (status) => !status.dictationSuspendedForGame && status.dictationToggleHotkey === hotkey);
    const inMaximized = await tapStartsAndStops(page, windows.maximized);
    check("hotkey in the maximized window starts and stops dictation", inMaximized, `started and stopped ${String(inMaximized)} (expected true)`);

    focus(windows.cover);
    await afterForegroundChecks();
    const inCover = await tapStartsAndStops(page, windows.cover);
    check("hotkey in the borderless monitor-covering window starts and stops dictation", inCover, `started and stopped ${String(inCover)} (expected true)`);

    focus(windows.game);
    const autoSuspended = await waitForStatus(page, (status) => status.dictationSuspendedForGame);
    await setProfileSuspension(page, focusAndRead(windows.game), "never");
    await afterForegroundChecks();
    const onNever = await tapStartsAndStops(page, windows.game);
    check("game profile set to Never keeps the hotkey while the game is focused", autoSuspended !== null && onNever,
      `suspended on Auto ${String(autoSuspended !== null)} (expected true), started and stopped on Never ${String(onNever)} (expected true)`);

    await page.evaluate(`window.voxtype.settings.update(${JSON.stringify({ suspendDictationHotkeysInGames: false })})`);
    const maximizedWindow = focusAndRead(windows.maximized);
    await setProfileSuspension(page, maximizedWindow, "always");
    await waitForStatus(page, (status) => status.dictationSuspendedForGame);
    const onAlways = await tapStartsDictation(page, windows.maximized);
    check("powershell.exe profile set to Always suspends with the game setting off", !onAlways,
      `dictation started ${String(onAlways)} (expected false), game setting ${String((await loadedSettings(page)).suspendDictationHotkeysInGames)} (expected false)`);

    await setProfileSuspension(page, maximizedWindow, "auto");
    await sleep(2_000);
    await page.quitApp();
    await Promise.race([appExited, sleep(15_000)]);
  } finally {
    if (app.exitCode === null) {
      app.kill();
    }
    writeFileSync(join(e2eOutDir, "game-suspension-app.log"), log.join("\n"));
  }
}

async function checkMigration(page: RendererPage): Promise<void> {
  const settings = await loadedSettings(page);
  const profile = settings.appProfiles.find((item) => item.processName === gameExeName);
  check("legacy fullscreen settings migrate to the game settings",
    settings.suspendDictationHotkeysInGames && profile?.dictationHotkeySuspension === "never",
    `suspendDictationHotkeysInGames ${String(settings.suspendDictationHotkeysInGames)} (expected true), ${gameExeName} profile ${String(profile?.dictationHotkeySuspension)} (expected never)`);
}

// ---------- setup ----------

function registerFakeGame(): void {
  const game = `HKCU\\${gameConfigStoreKey}\\{${crypto.randomUUID()}}`;
  const withoutPath = `HKCU\\${gameConfigStoreKey}\\{${crypto.randomUUID()}}`;
  for (const args of [
    ["add", game, "/v", "MatchedExeFullPath", "/t", "REG_SZ", "/d", gameExe, "/f"],
    // Real GameConfigStore children without MatchedExeFullPath exist; the helper must skip them.
    ["add", withoutPath, "/v", "Type", "/t", "REG_DWORD", "/d", "1", "/f"]
  ]) {
    const result = spawnSync("reg.exe", args, { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`reg ${args.join(" ")} failed: ${result.stderr}`);
    }
  }
}

/** The settings a user upgrading from the fullscreen version still has on disk. */
function writeLegacySettings(): void {
  writeFileSync(join(userDataDir, "settings.json"), `${JSON.stringify({
    suspendDictationHotkeysInFullscreenApps: true,
    appProfiles: [{ id: gameExeName, displayName: "E2E game", processName: gameExeName, processPath: gameExe, neverSuspendDictationInFullscreen: true }]
  }, null, 2)}\n`);
}

// ---------- windows ----------

/** A WinForms window run by the given powershell executable, open until the process is killed. */
function openForm(executable: string, label: string, setup: string[]): TestWindow {
  const title = `voxtype-e2e-${label}-${String(Date.now())}`;
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$form = New-Object System.Windows.Forms.Form",
    "$form.StartPosition = 'Manual'",
    `$form.Text = '${title}'`,
    ...setup,
    "[void]$form.ShowDialog()"
  ].join("; ");
  return { title, process: spawn(executable, ["-NoProfile", "-Command", script], { stdio: "ignore" }) };
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
  const output = spawnSync(helper, ["active-window"], {
    encoding: "utf8",
    env: { ...process.env, VOXTYPE_GAME_CONFIG_STORE_KEY: gameConfigStoreKey }
  }).stdout;
  // The helper's active-window JSON is this shape; every check compares its fields to literal values.
  return JSON.parse(output) as ActiveWindow;
}

// ---------- state ----------

function hotkeyStatus(page: RendererPage): Promise<HotkeyStatus> {
  return page.evaluate<HotkeyStatus>("window.voxtype.hotkeys.status()");
}

function waitForStatus(page: RendererPage, predicate: (status: HotkeyStatus) => boolean): Promise<HotkeyStatus | null> {
  return waitFor(async () => {
    const status = await hotkeyStatus(page);
    return predicate(status) ? status : null;
  }, 6_000);
}

/** Waits out two foreground re-checks, for cases where the hotkey status should not change. */
function afterForegroundChecks(): Promise<void> {
  return sleep(4_500);
}

function loadedSettings(page: RendererPage): Promise<LoadedSettings> {
  return page.evaluate<LoadedSettings>("window.voxtype.settings.get()");
}

async function setProfileSuspension(page: RendererPage, window: ActiveWindow, suspension: Suspension): Promise<void> {
  await page.evaluate(`window.voxtype.appProfiles.ensure(${JSON.stringify(window)}).then((profile) =>
    window.voxtype.appProfiles.update(profile.processName, { ...profile, dictationHotkeySuspension: ${JSON.stringify(suspension)} }))`);
}

function dictationState(page: RendererPage): Promise<{ recording: boolean; sessionId: number }> {
  return page.evaluate("window.voxtype.dictation.getHotkeyState().then(({ recording, sessionId }) => ({ recording, sessionId }))");
}

/** Taps the hotkey into the window; whether that started a dictation. */
async function tapStartsDictation(page: RendererPage, hwnd: string): Promise<boolean> {
  const before = await dictationState(page);
  press(hwnd);
  await sleep(1_500);
  const after = await dictationState(page);
  return after.recording || after.sessionId !== before.sessionId;
}

/** Taps the hotkey into the window twice; whether the first tap started a dictation and the second stopped it. */
async function tapStartsAndStops(page: RendererPage, hwnd: string): Promise<boolean> {
  press(hwnd);
  const started = await waitFor(async () => ((await dictationState(page)).recording ? true : null), 5_000);
  await sleep(1_000);
  press(hwnd);
  const stopped = await waitFor(async () => (!(await dictationState(page)).recording ? true : null), 5_000);
  return started === true && stopped === true;
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
  const base = join(e2eOutDir, "game-suspension");
  writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`${base}.md`, [
    "# Game hotkey suspension E2E",
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
