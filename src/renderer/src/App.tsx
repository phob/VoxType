import { useEffect, useRef, useState } from "react";
import { startPcmRecorder, type PcmRecorder } from "./audio-recorder";
import { type LocalModel } from "../../../shared/models";
import { type WhisperRuntime } from "../../../shared/runtimes";
import { type AppSettings, type InsertionMode } from "../../../shared/settings";
import { type TranscriptEntry } from "../../../shared/transcripts";
import {
  type ActiveWindowInfo,
  type WindowsHelperStatus
} from "../../../shared/windows-helper";

type AppState = {
  models: LocalModel[];
  runtime: WhisperRuntime | null;
  settings: AppSettings | null;
  history: TranscriptEntry[];
  windowsHelper: WindowsHelperStatus | null;
  activeWindow: ActiveWindowInfo | null;
};

export function App(): JSX.Element {
  const recorderRef = useRef<PcmRecorder | null>(null);
  const [version, setVersion] = useState<string>("0.1.0");
  const [state, setState] = useState<AppState>({
    models: [],
    runtime: null,
    settings: null,
    history: [],
    windowsHelper: null,
    activeWindow: null
  });
  const [recording, setRecording] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeModel = state.models.find((model) => model.id === state.settings?.activeModelId);
  const latestTranscript = state.history[0];

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    const [appVersion, settings, models, runtime, history, windowsHelper] = await Promise.all([
      window.voxtype.getVersion(),
      window.voxtype.settings.get(),
      window.voxtype.models.list(),
      window.voxtype.runtime.getWhisper(),
      window.voxtype.history.list(),
      window.voxtype.windowsHelper.status()
    ]);

    setVersion(appVersion);
    setState({ settings, models, runtime, history, windowsHelper, activeWindow: null });
  }

  async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
    setState((current) => ({
      ...current,
      settings: current.settings ? { ...current.settings, ...patch } : current.settings
    }));
    setState((current) => current);
    const settings = await window.voxtype.settings.update(patch);
    const models = await window.voxtype.models.list();
    setState((current) => ({ ...current, settings, models }));
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
      recorderRef.current = await startPcmRecorder();
      setRecording(true);
    } catch (recordingError) {
      setError(formatError(recordingError));
    }
  }

  async function stopAndTranscribe(): Promise<void> {
    if (!recorderRef.current) {
      return;
    }

    setRecording(false);
    setBusyMessage("Transcribing locally...");

    try {
      const wavBytes = await recorderRef.current.stop();
      recorderRef.current = null;
      const result = await window.voxtype.transcription.transcribeWav(wavBytes);
      if (state.settings?.insertionMode === "clipboard") {
        await window.voxtype.insertion.copy(result.entry.text);
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
      setError(formatError(transcriptionError));
    } finally {
      setBusyMessage(null);
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

  return (
    <main className="app-shell">
      <section className="intro">
        <div>
          <p className="eyebrow">VoxType {version}</p>
          <h1>Local dictation for real Windows work.</h1>
          <p className="lede">
            Record audio, run a local Whisper model, and prepare the transcript for insertion.
            Press Ctrl+Shift+Space to bring VoxType forward.
          </p>
        </div>
        <div className="status-panel" aria-label="Application status">
          <span className={recording ? "status-dot recording-dot" : "status-dot"} />
          <div>
            <strong>{recording ? "Listening..." : busyMessage ?? "Ready for local dictation"}</strong>
            <span>{activeModel ? `${activeModel.name} is selected.` : "Choose a model below."}</span>
          </div>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace-grid">
        <section className="tool-panel" aria-label="Dictation">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Dictation</p>
              <h2>Phase 1 workflow</h2>
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
          </div>
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
