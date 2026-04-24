import { useEffect, useRef, useState } from "react";
import { startPcmRecorder, type PcmRecorder } from "./audio-recorder";
import { eventToAccelerator } from "./hotkey-capture";
import { type HotkeyStatus } from "../../../shared/hotkeys";
import { type LocalModel } from "../../../shared/models";
import { type WhisperRuntime } from "../../../shared/runtimes";
import { type AppSettings, type InsertionMode } from "../../../shared/settings";
import { type TranscriptEntry } from "../../../shared/transcripts";
import {
  type ActiveWindowInfo,
  type DictationHotkeyPayload,
  type WindowsHelperStatus
} from "../../../shared/windows-helper";

type AppState = {
  models: LocalModel[];
  runtime: WhisperRuntime | null;
  settings: AppSettings | null;
  history: TranscriptEntry[];
  windowsHelper: WindowsHelperStatus | null;
  activeWindow: ActiveWindowInfo | null;
  hotkeys: HotkeyStatus | null;
};

export function App(): JSX.Element {
  const recorderRef = useRef<PcmRecorder | null>(null);
  const hotkeyTargetRef = useRef<ActiveWindowInfo | null>(null);
  const systemAudioMutedByVoxTypeRef = useRef(false);
  const [version, setVersion] = useState<string>("0.1.0");
  const [state, setState] = useState<AppState>({
    models: [],
    runtime: null,
    settings: null,
    history: [],
    windowsHelper: null,
    activeWindow: null,
    hotkeys: null
  });
  const [recording, setRecording] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturingHotkey, setCapturingHotkey] = useState<
    "dictationToggleHotkey" | "showWindowHotkey" | null
  >(null);
  const [insertionTarget, setInsertionTarget] = useState<ActiveWindowInfo | null>(null);
  const [insertionTestText, setInsertionTestText] = useState(
    "VoxType insertion test: cafe, naive, aeoeue, Unicode -> äöü é 漢字 123."
  );
  const [insertionTestResult, setInsertionTestResult] = useState<string | null>(null);

  const activeModel = state.models.find((model) => model.id === state.settings?.activeModelId);
  const latestTranscript = state.history[0];

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const removeStart = window.voxtype.dictation.onHotkeyStart((payload) => {
      void handleHotkeyStart(payload);
    });
    const removeStop = window.voxtype.dictation.onHotkeyStop((payload) => {
      void handleHotkeyStop(payload);
    });

    void window.voxtype.dictation.getHotkeyState().then((hotkeyState) => {
      if (hotkeyState.recording) {
        void handleHotkeyStart({ target: hotkeyState.target });
      }
    });

    return () => {
      removeStart();
      removeStop();
    };
  }, [activeModel?.status, state.settings?.insertionMode, recording]);

  useEffect(() => {
    if (!capturingHotkey) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setCapturingHotkey(null);
        return;
      }

      const accelerator = eventToAccelerator(event);

      if (!accelerator) {
        return;
      }

      void updateSettings({ [capturingHotkey]: accelerator });
      setCapturingHotkey(null);
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [capturingHotkey]);

  async function refresh(): Promise<void> {
    const [appVersion, settings, models, runtime, history, windowsHelper, hotkeys] =
      await Promise.all([
      window.voxtype.getVersion(),
      window.voxtype.settings.get(),
      window.voxtype.models.list(),
      window.voxtype.runtime.getWhisper(),
      window.voxtype.history.list(),
      window.voxtype.windowsHelper.status(),
      window.voxtype.hotkeys.status()
    ]);

    setVersion(appVersion);
    setState({
      settings,
      models,
      runtime,
      history,
      windowsHelper,
      activeWindow: null,
      hotkeys
    });
  }

  async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
    setState((current) => ({
      ...current,
      settings: current.settings ? { ...current.settings, ...patch } : current.settings
    }));
    setState((current) => current);
    const settings = await window.voxtype.settings.update(patch);
    const [models, hotkeys] = await Promise.all([
      window.voxtype.models.list(),
      window.voxtype.hotkeys.status()
    ]);
    setState((current) => ({ ...current, settings, models, hotkeys }));
  }

  async function installRuntime(): Promise<void> {
    setError(null);
    setBusyMessage("Installing whisper.cpp runtime...");

    try {
      const runtime = await window.voxtype.runtime.installWhisper();
      setState((current) => ({ ...current, runtime }));
    } catch (runtimeError) {
      setError(formatError(runtimeError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function downloadModel(modelId: string): Promise<void> {
    setError(null);
    setBusyMessage("Downloading model...");

    try {
      const models = await window.voxtype.models.download(modelId);
      const settings = await window.voxtype.settings.get();
      setState((current) => ({ ...current, models, settings }));
    } catch (downloadError) {
      setError(formatError(downloadError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function startRecording(): Promise<void> {
    setError(null);

    if (activeModel?.status !== "downloaded") {
      setError("Download and select a Whisper model before recording.");
      return;
    }

    try {
      if (state.settings?.autoMuteSystemAudio) {
        await window.voxtype.windowsHelper.setSystemMute(true);
        systemAudioMutedByVoxTypeRef.current = true;
      }

      recorderRef.current = await startPcmRecorder();
      setRecording(true);
    } catch (recordingError) {
      const unmuteError = await unmuteSystemAudio();
      setError(joinErrors(formatError(recordingError), unmuteError));
    }
  }

  async function handleHotkeyStart(payload: DictationHotkeyPayload): Promise<void> {
    if (recording || recorderRef.current) {
      return;
    }

    hotkeyTargetRef.current = payload.target;
    setState((current) => ({
      ...current,
      activeWindow: payload.target
    }));
    await startRecording();
  }

  async function handleHotkeyStop(payload: DictationHotkeyPayload): Promise<void> {
    if (payload.target) {
      hotkeyTargetRef.current = payload.target;
    }

    await stopAndTranscribe({ pasteTarget: hotkeyTargetRef.current });
    await window.voxtype.dictation.setHotkeyRecording(false);
    hotkeyTargetRef.current = null;
  }

  async function stopAndTranscribe(options?: {
    pasteTarget?: ActiveWindowInfo | null;
  }): Promise<void> {
    if (!recorderRef.current) {
      return;
    }

    setRecording(false);
    setBusyMessage("Transcribing locally...");

    try {
      const wavBytes = await recorderRef.current.stop();
      recorderRef.current = null;
      const unmuteError = await unmuteSystemAudio();
      const result = await window.voxtype.transcription.transcribeWav(wavBytes);
      if (unmuteError) {
        setError(unmuteError);
      }
      if (state.settings?.insertionMode === "clipboard" && !options?.pasteTarget?.hwnd) {
        await window.voxtype.insertion.copy(result.entry.text);
      } else if (options?.pasteTarget?.hwnd) {
        await window.voxtype.insertion.insertWindow(result.entry.text, options.pasteTarget.hwnd);
      }
      const [runtime, history] = await Promise.all([
        window.voxtype.runtime.getWhisper(),
        window.voxtype.history.list()
      ]);
      setState((current) => ({
        ...current,
        runtime,
        history: history.length > 0 ? history : [result.entry, ...current.history]
      }));
    } catch (transcriptionError) {
      const unmuteError = await unmuteSystemAudio();
      setError(joinErrors(formatError(transcriptionError), unmuteError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function unmuteSystemAudio(): Promise<string | null> {
    if (!systemAudioMutedByVoxTypeRef.current) {
      return null;
    }

    systemAudioMutedByVoxTypeRef.current = false;
    try {
      await window.voxtype.windowsHelper.setSystemMute(false);
      return null;
    } catch (muteError) {
      return `Failed to unmute system audio: ${formatError(muteError)}`;
    }
  }

  async function copyLatestTranscript(): Promise<void> {
    if (!latestTranscript) {
      return;
    }

    await window.voxtype.insertion.copy(latestTranscript.text);
    setBusyMessage("Copied transcript to clipboard.");
    window.setTimeout(() => setBusyMessage(null), 1800);
  }

  async function pasteLatestTranscript(): Promise<void> {
    if (!latestTranscript) {
      return;
    }

    setError(null);

    try {
      await window.voxtype.insertion.insertActive(latestTranscript.text);
      setBusyMessage("Inserted transcript into the active app.");
      window.setTimeout(() => setBusyMessage(null), 1800);
    } catch (pasteError) {
      setError(formatError(pasteError));
    }
  }

  async function refreshActiveWindow(): Promise<void> {
    setError(null);

    try {
      const [windowsHelper, activeWindow] = await Promise.all([
        window.voxtype.windowsHelper.status(),
        window.voxtype.windowsHelper.activeWindow()
      ]);

      setState((current) => ({ ...current, windowsHelper, activeWindow }));
    } catch (activeWindowError) {
      const windowsHelper = await window.voxtype.windowsHelper.status();
      setState((current) => ({ ...current, windowsHelper }));
      setError(formatError(activeWindowError));
    }
  }

  async function captureInsertionTarget(): Promise<void> {
    setError(null);
    setInsertionTestResult("Switch to the target app now. Capturing in 2.5 seconds...");

    try {
      await wait(2500);
      const [windowsHelper, activeWindow] = await Promise.all([
        window.voxtype.windowsHelper.status(),
        window.voxtype.windowsHelper.activeWindow()
      ]);

      setInsertionTarget(activeWindow);
      setState((current) => ({ ...current, windowsHelper, activeWindow }));
      setInsertionTestResult(
        `Captured ${activeWindow.processName ?? "unknown process"} · ${
          activeWindow.title || "Untitled window"
        }`
      );
    } catch (captureError) {
      const windowsHelper = await window.voxtype.windowsHelper.status();
      setState((current) => ({ ...current, windowsHelper }));
      setError(formatError(captureError));
    }
  }

  async function useDetectedAppAsInsertionTarget(): Promise<void> {
    if (!state.activeWindow) {
      setError("Refresh or capture a target app before using it for insertion tests.");
      return;
    }

    setInsertionTarget(state.activeWindow);
    setInsertionTestResult(
      `Using ${state.activeWindow.processName ?? "unknown process"} · ${
        state.activeWindow.title || "Untitled window"
      }`
    );
  }

  async function runInsertionTest(mode: InsertionMode): Promise<void> {
    if (!insertionTarget) {
      setError("Capture a target app before running an insertion test.");
      return;
    }

    setError(null);
    setBusyMessage(`Testing ${insertionModeLabel(mode)}...`);

    try {
      await window.voxtype.insertion.testWindow(
        insertionTestText,
        insertionTarget.hwnd,
        mode
      );
      setInsertionTestResult(
        `Sent ${insertionTestText.length} characters with ${insertionModeLabel(mode)}.`
      );
    } catch (testError) {
      setError(formatError(testError));
    } finally {
      setBusyMessage(null);
    }
  }

  return (
    <main className="app-shell">
      <section className="intro">
        <div>
          <p className="eyebrow">VoxType {version}</p>
          <h1>Local dictation for real Windows work.</h1>
          <p className="lede">
            Record audio, run a local Whisper model, and prepare the transcript for insertion.
            Press Ctrl+Alt+Space to start or stop dictation from any app.
          </p>
        </div>
        <div className="status-panel" aria-label="Application status">
          <span className={recording ? "status-dot recording-dot" : "status-dot"} />
          <div>
            <strong>{recording ? "Listening..." : busyMessage ?? "Ready for local dictation"}</strong>
            <span>
              {activeModel
                ? `${activeModel.name} is selected. Ctrl+Alt+Space toggles recording.`
                : "Choose a model below."}
            </span>
          </div>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace-grid">
        <section className="tool-panel" aria-label="Dictation">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Dictation</p>
              <h2>Hotkey workflow</h2>
            </div>
          </div>

          <div className="dictation-actions">
            <button
              className="primary-button"
              disabled={Boolean(busyMessage) || recording}
              onClick={() => void startRecording()}
              type="button"
            >
              Start Recording
            </button>
            <button
              className="secondary-button"
              disabled={!recording}
              onClick={() => void stopAndTranscribe()}
              type="button"
            >
              Stop And Transcribe
            </button>
            <button
              className="secondary-button"
              disabled={!latestTranscript}
              onClick={() => void copyLatestTranscript()}
              type="button"
            >
              Copy Latest
            </button>
            <button
              className="secondary-button"
              disabled={!latestTranscript}
              onClick={() => void pasteLatestTranscript()}
              type="button"
            >
              Insert Into Active App
            </button>
          </div>

          <div className="transcript-preview">
            <span>Latest transcript</span>
            <p>{latestTranscript?.text ?? "No transcript yet."}</p>
          </div>
        </section>

        <section className="tool-panel" aria-label="Models">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Models</p>
              <h2>Whisper catalog</h2>
            </div>
          </div>

          <div className="model-list">
            {state.models.map((model) => (
              <article className="model-row" key={model.id}>
                <div>
                  <strong>{model.name}</strong>
                  <span>
                    {model.language} · {model.sizeLabel} · {model.status}
                  </span>
                  <p>{model.description}</p>
                </div>
                <div className="model-actions">
                  <button
                    className="secondary-button"
                    onClick={() => void updateSettings({ activeModelId: model.id })}
                    type="button"
                  >
                    {state.settings?.activeModelId === model.id ? "Selected" : "Select"}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={model.status === "downloaded" || Boolean(busyMessage)}
                    onClick={() => void downloadModel(model.id)}
                    type="button"
                  >
                    Download
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>

      <section className="runtime-panel" aria-label="Whisper runtime">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Runtime</p>
            <h2>Managed whisper.cpp</h2>
          </div>
        </div>

        {state.runtime ? (
          <article className="runtime-card">
            <div>
              <strong>{state.runtime.name}</strong>
              <span>
                {state.runtime.version} · {state.runtime.backend} · {state.runtime.platform} ·{" "}
                {state.runtime.status}
              </span>
              <p>
                {state.runtime.executablePath
                  ? state.runtime.executablePath
                  : "Install the managed CPU runtime or set a custom executable path below."}
              </p>
            </div>
            <button
              className="secondary-button"
              disabled={state.runtime.status === "installed" || Boolean(busyMessage)}
              onClick={() => void installRuntime()}
              type="button"
            >
              Install Runtime
            </button>
          </article>
        ) : null}
      </section>

      <section className="windows-panel" aria-label="Windows integration">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Windows</p>
            <h2>Native helper</h2>
          </div>
          <button
            className="secondary-button"
            onClick={() => void refreshActiveWindow()}
            type="button"
          >
            Refresh Active App
          </button>
        </div>

        <article className="runtime-card">
          <div>
            <strong>
              {state.windowsHelper?.available ? "Helper available" : "Helper unavailable"}
            </strong>
            <span>{state.windowsHelper?.helperPath ?? "Build the helper to enable Phase 2 APIs."}</span>
            <p>
              {state.activeWindow
                ? `${state.activeWindow.processName ?? "Unknown process"} · ${state.activeWindow.title || "Untitled window"}`
                : "Active-window details will appear here after refresh."}
            </p>
            {state.activeWindow?.processPath ? <p>{state.activeWindow.processPath}</p> : null}
          </div>
        </article>
      </section>

      <section className="insertion-test-panel" aria-label="Insertion tests">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Insertion</p>
            <h2>Test panel</h2>
          </div>
          <div className="test-actions">
            <button
              className="secondary-button"
              onClick={() => void captureInsertionTarget()}
              type="button"
            >
              Capture Target
            </button>
            <button
              className="secondary-button"
              disabled={!state.activeWindow}
              onClick={() => void useDetectedAppAsInsertionTarget()}
              type="button"
            >
              Use Detected App
            </button>
          </div>
        </div>

        <div className="insertion-test-grid">
          <label className="field">
            <span>Test text</span>
            <textarea
              rows={4}
              value={insertionTestText}
              onChange={(event) => setInsertionTestText(event.target.value)}
            />
          </label>

          <article className="target-card">
            <span>Captured target</span>
            <strong>
              {insertionTarget
                ? insertionTarget.processName ?? "Unknown process"
                : "No target captured"}
            </strong>
            <p>{insertionTarget?.title || "Capture a target app before testing insertion."}</p>
            {insertionTarget?.processPath ? <p>{insertionTarget.processPath}</p> : null}
          </article>
        </div>

        <div className="test-actions">
          <button
            className="secondary-button"
            disabled={!insertionTarget || Boolean(busyMessage)}
            onClick={() => void runInsertionTest("clipboard")}
            type="button"
          >
            Test Clipboard Paste
          </button>
          <button
            className="secondary-button"
            disabled={!insertionTarget || Boolean(busyMessage)}
            onClick={() => void runInsertionTest("keyboard")}
            type="button"
          >
            Test Unicode Typing
          </button>
          <button
            className="secondary-button"
            disabled={!insertionTarget || Boolean(busyMessage)}
            onClick={() => void runInsertionTest("chunked")}
            type="button"
          >
            Test Chunked Typing
          </button>
        </div>

        {insertionTestResult ? (
          <p className="settings-note">{insertionTestResult}</p>
        ) : null}
      </section>

      {state.settings ? (
        <section className="settings-panel" aria-label="VoxType settings">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Settings</p>
              <h2>Local app settings</h2>
            </div>
          </div>

          <div className="settings-grid">
            <label className="field">
              <span>Whisper executable path</span>
              <input
                placeholder="whisper-cli or C:\\path\\to\\whisper-cli.exe"
                value={state.settings.whisperExecutablePath}
                onChange={(event) =>
                  void updateSettings({ whisperExecutablePath: event.target.value })
                }
              />
            </label>

            <label className="field">
              <span>Model directory</span>
              <input
                value={state.settings.modelDirectory}
                onChange={(event) => void updateSettings({ modelDirectory: event.target.value })}
              />
            </label>

            <label className="field">
              <span>Insertion mode</span>
              <select
                value={state.settings.insertionMode}
                onChange={(event) =>
                  void updateSettings({ insertionMode: event.target.value as InsertionMode })
                }
              >
                <option value="clipboard">Clipboard paste</option>
                <option value="keyboard">Keyboard emulation</option>
                <option value="chunked">Remote-safe chunked typing</option>
              </select>
            </label>

            <label className="field">
              <span>Dictation hotkey</span>
              <button
                className="hotkey-capture-button"
                onClick={() => setCapturingHotkey("dictationToggleHotkey")}
                type="button"
              >
                {capturingHotkey === "dictationToggleHotkey"
                  ? "Press a key combination..."
                  : state.settings.dictationToggleHotkey}
              </button>
            </label>

            <label className="field">
              <span>Show VoxType hotkey</span>
              <button
                className="hotkey-capture-button"
                onClick={() => setCapturingHotkey("showWindowHotkey")}
                type="button"
              >
                {capturingHotkey === "showWindowHotkey"
                  ? "Press a key combination..."
                  : state.settings.showWindowHotkey}
              </button>
            </label>

            <label className="field">
              <span>Remote typing delay</span>
              <input
                max={1000}
                min={0}
                type="number"
                value={state.settings.remoteTypingDelayMs}
                onChange={(event) =>
                  void updateSettings({ remoteTypingDelayMs: Number(event.target.value) })
                }
              />
            </label>

            <label className="field">
              <span>Remote typing chunk size</span>
              <input
                max={250}
                min={1}
                type="number"
                value={state.settings.remoteTypingChunkSize}
                onChange={(event) =>
                  void updateSettings({ remoteTypingChunkSize: Number(event.target.value) })
                }
              />
            </label>

            <label className="toggle">
              <input
                checked={state.settings.restoreClipboard}
                type="checkbox"
                onChange={(event) =>
                  void updateSettings({ restoreClipboard: event.target.checked })
                }
              />
              <span>Restore clipboard after paste insertion</span>
            </label>

            <label className="toggle">
              <input
                checked={state.settings.offlineMode}
                type="checkbox"
                onChange={(event) => void updateSettings({ offlineMode: event.target.checked })}
              />
              <span>Offline mode after models are installed</span>
            </label>

            <label className="toggle">
              <input
                checked={state.settings.autoMuteSystemAudio}
                type="checkbox"
                onChange={(event) =>
                  void updateSettings({ autoMuteSystemAudio: event.target.checked })
                }
              />
              <span>Mute system audio while recording</span>
            </label>
          </div>
          <p className="settings-note">
            Registered hotkeys: dictation{" "}
            {state.hotkeys?.dictationToggleHotkey ?? "not registered"}, show window{" "}
            {state.hotkeys?.showWindowHotkey ?? "not registered"}.
          </p>
        </section>
      ) : null}

      <section className="history-panel" aria-label="Transcript history">
        <div className="section-heading">
          <div>
            <p className="eyebrow">History</p>
            <h2>Recent transcripts</h2>
          </div>
        </div>

        <div className="history-list">
          {state.history.length === 0 ? (
            <p className="empty-state">Transcripts will appear here after local Whisper runs.</p>
          ) : (
            state.history.map((entry) => (
              <article className="history-row" key={entry.id}>
                <span>{new Date(entry.createdAt).toLocaleString()}</span>
                <p>{entry.text}</p>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function joinErrors(primary: string, secondary: string | null): string {
  return secondary ? `${primary} ${secondary}` : primary;
}

function insertionModeLabel(mode: InsertionMode): string {
  if (mode === "clipboard") {
    return "clipboard paste";
  }

  if (mode === "keyboard") {
    return "Unicode typing";
  }

  return "chunked typing";
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}
