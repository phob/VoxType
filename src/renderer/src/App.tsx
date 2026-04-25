import { useEffect, useRef, useState } from "react";
import {
  startNativePcmRecorder,
  type PcmRecorder,
  type PcmRecordingResult
} from "./audio-recorder";
import { eventToAccelerator } from "./hotkey-capture";
import { type DictionaryEntry } from "../../../shared/dictionary";
import { type HotkeyStatus } from "../../../shared/hotkeys";
import { type LocalModel } from "../../../shared/models";
import { type WhisperRuntime } from "../../../shared/runtimes";
import {
  type AppProfile,
  type AppSettings,
  type InsertionMode,
  type RecorderCaptureMode,
  type RecordingCoordinationMode
} from "../../../shared/settings";
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
  dictionary: DictionaryEntry[];
  windowsHelper: WindowsHelperStatus | null;
  activeWindow: ActiveWindowInfo | null;
  hotkeys: HotkeyStatus | null;
};

type DevTab = "dictation" | "models" | "insertion" | "profiles" | "dictionary" | "settings" | "logs";
type HotkeyCaptureTarget =
  | "dictationToggleHotkey"
  | "showWindowHotkey"
  | "recordingStartHotkey"
  | "recordingStopHotkey";

const devTabs: Array<{ id: DevTab; label: string }> = [
  { id: "dictation", label: "Dictation" },
  { id: "models", label: "Models" },
  { id: "insertion", label: "Insertion" },
  { id: "profiles", label: "Profiles" },
  { id: "dictionary", label: "Dictionary" },
  { id: "settings", label: "Settings" },
  { id: "logs", label: "Logs" }
];

export function App(): JSX.Element {
  const recorderRef = useRef<PcmRecorder | null>(null);
  const hotkeyTargetRef = useRef<ActiveWindowInfo | null>(null);
  const systemAudioMutedByVoxTypeRef = useRef(false);
  const recordingStopHotkeyRef = useRef<string | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const [version, setVersion] = useState<string>("0.1.0");
  const [state, setState] = useState<AppState>({
    models: [],
    runtime: null,
    settings: null,
    history: [],
    dictionary: [],
    windowsHelper: null,
    activeWindow: null,
    hotkeys: null
  });
  const [recording, setRecording] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturingHotkey, setCapturingHotkey] = useState<HotkeyCaptureTarget | null>(null);
  const [insertionTarget, setInsertionTarget] = useState<ActiveWindowInfo | null>(null);
  const [insertionTestText, setInsertionTestText] = useState(
    "VoxType insertion test: cafe, naive, aeoeue, Unicode -> äöü é 漢字 123."
  );
  const [insertionTestResult, setInsertionTestResult] = useState<string | null>(null);
  const [dictionaryPreferred, setDictionaryPreferred] = useState("");
  const [dictionaryMatches, setDictionaryMatches] = useState("");
  const [dictionaryCategory, setDictionaryCategory] = useState("general");
  const [dictionaryAppProcess, setDictionaryAppProcess] = useState("");
  const [fixLastText, setFixLastText] = useState("");
  const [lastRecordingResult, setLastRecordingResult] = useState<PcmRecordingResult | null>(null);
  const [playingTranscriptId, setPlayingTranscriptId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DevTab>("dictation");

  const activeModel = state.models.find((model) => model.id === state.settings?.activeModelId);
  const latestTranscript = state.history[0];
  const currentTarget = insertionTarget ?? state.activeWindow;
  const appStatus = error ? "Error" : recording ? "Recording" : busyMessage ? busyMessage : "Ready";

  useEffect(() => {
    void refresh();

    return () => {
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current = null;
      }

      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
        audioObjectUrlRef.current = null;
      }
    };
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
    const [appVersion, settings, models, runtime, history, dictionary, windowsHelper, hotkeys] =
      await Promise.all([
      window.voxtype.getVersion(),
      window.voxtype.settings.get(),
      window.voxtype.models.list(),
      window.voxtype.runtime.getWhisper(),
      window.voxtype.history.list(),
      window.voxtype.dictionary.list(),
      window.voxtype.windowsHelper.status(),
      window.voxtype.hotkeys.status()
    ]);

    setVersion(appVersion);
    setState({
      settings,
      models,
      runtime,
      history,
      dictionary,
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

      recorderRef.current = await startNativePcmRecorder(state.settings);
      await startRecordingCoordination(state.settings);
      setRecording(true);
    } catch (recordingError) {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      const recorderStopError = recorder
        ? await recorder.stop().then(
            () => null,
            (stopError) => formatError(stopError)
          )
        : null;
      const coordinationError = await stopRecordingCoordination();
      const unmuteError = await unmuteSystemAudio();
      setError(
        joinErrors(
          joinErrors(joinErrors(formatError(recordingError), recorderStopError), coordinationError),
          unmuteError
        )
      );
    }
  }

  async function handleHotkeyStart(payload: DictationHotkeyPayload): Promise<void> {
    if (recording || recorderRef.current) {
      return;
    }

    hotkeyTargetRef.current = payload.target;
    const settings = await window.voxtype.settings.get();
    setState((current) => ({
      ...current,
      activeWindow: payload.target,
      settings
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
      const recordingResult = await recorderRef.current.stop();
      recorderRef.current = null;
      const coordinationError = await stopRecordingCoordination();
      const unmuteError = await unmuteSystemAudio();
      setLastRecordingResult(recordingResult);

      if (recordingResult.vad.enabled && !recordingResult.vad.speechDetected) {
        const cleanupError = joinErrors(coordinationError ?? "", unmuteError).trim();
        if (cleanupError) {
          setError(`${recordingResult.vad.skippedReason ?? "No speech detected."} ${cleanupError}`);
        } else {
          setError(recordingResult.vad.skippedReason ?? "No speech detected.");
        }
        return;
      }

      const result = await window.voxtype.transcription.transcribeWav(recordingResult.wavBytes, {
        processName: options?.pasteTarget?.processName
      });
      if (unmuteError) {
        setError(unmuteError);
      }
      if (coordinationError) {
        setError(coordinationError);
      }
      if (state.settings?.insertionMode === "clipboard" && !options?.pasteTarget?.hwnd) {
        await window.voxtype.insertion.copy(result.entry.text);
      } else if (options?.pasteTarget?.hwnd) {
        await window.voxtype.insertion.insertWindow(
          result.entry.text,
          options.pasteTarget.hwnd,
          options.pasteTarget.processName
        );
      }
      const [runtime, history, dictionary] = await Promise.all([
        window.voxtype.runtime.getWhisper(),
        window.voxtype.history.list(),
        window.voxtype.dictionary.list()
      ]);
      setState((current) => ({
        ...current,
        runtime,
        dictionary,
        history: history.length > 0 ? history : [result.entry, ...current.history]
      }));
    } catch (transcriptionError) {
      const coordinationError = await stopRecordingCoordination();
      const unmuteError = await unmuteSystemAudio();
      setError(joinErrors(joinErrors(formatError(transcriptionError), coordinationError), unmuteError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function startRecordingCoordination(settings: AppSettings | null): Promise<void> {
    if (!settings || settings.recordingCoordinationMode !== "sendHotkey") {
      return;
    }

    await window.voxtype.windowsHelper.sendHotkey(settings.recordingStartHotkey);
    recordingStopHotkeyRef.current = settings.recordingStopHotkey || settings.recordingStartHotkey;
  }

  async function stopRecordingCoordination(): Promise<string | null> {
    const stopHotkey = recordingStopHotkeyRef.current;

    if (!stopHotkey) {
      return null;
    }

    recordingStopHotkeyRef.current = null;

    try {
      await window.voxtype.windowsHelper.sendHotkey(stopHotkey);
      return null;
    } catch (coordinationError) {
      return `Failed to restore recording coordination: ${formatError(coordinationError)}`;
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
      const settings = await window.voxtype.settings.get();

      setState((current) => ({ ...current, windowsHelper, activeWindow, settings }));
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
      const settings = await window.voxtype.settings.get();

      setInsertionTarget(activeWindow);
      setState((current) => ({ ...current, windowsHelper, activeWindow, settings }));
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
        mode,
        insertionTarget.processName
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

  async function updateAppProfile(
    profile: AppProfile,
    patch: Partial<Pick<AppProfile, "insertionMode" | "writingStyle">>
  ): Promise<void> {
    const nextProfile = {
      insertionMode: patch.insertionMode ?? profile.insertionMode,
      writingStyle: patch.writingStyle ?? profile.writingStyle
    };
    const settings = await window.voxtype.appProfiles.update(profile.processName, nextProfile);
    setState((current) => ({ ...current, settings }));
  }

  async function addDictionaryEntry(): Promise<void> {
    setError(null);

    try {
      const dictionary = await window.voxtype.dictionary.add({
        preferred: dictionaryPreferred,
        matches: splitMatches(dictionaryMatches),
        category: dictionaryCategory || "general",
        appProcessName: dictionaryAppProcess || null,
        source: "user"
      });
      setState((current) => ({ ...current, dictionary }));
      setDictionaryPreferred("");
      setDictionaryMatches("");
      setDictionaryCategory("general");
      setDictionaryAppProcess("");
    } catch (dictionaryError) {
      setError(formatError(dictionaryError));
    }
  }

  async function toggleDictionaryEntry(entry: DictionaryEntry): Promise<void> {
    const dictionary = await window.voxtype.dictionary.update(entry.id, {
      enabled: !entry.enabled
    });
    setState((current) => ({ ...current, dictionary }));
  }

  async function removeDictionaryEntry(entry: DictionaryEntry): Promise<void> {
    const dictionary = await window.voxtype.dictionary.remove(entry.id);
    setState((current) => ({ ...current, dictionary }));
  }

  async function learnFixLastDictation(): Promise<void> {
    if (!latestTranscript || !fixLastText.trim()) {
      setError("Enter corrected text for the latest transcript before saving a correction.");
      return;
    }

    setError(null);

    try {
      const dictionary = await window.voxtype.dictionary.add({
        preferred: fixLastText,
        matches: [latestTranscript.text],
        category: "correction",
        source: "correction"
      });
      setState((current) => ({ ...current, dictionary }));
      setFixLastText("");
    } catch (dictionaryError) {
      setError(formatError(dictionaryError));
    }
  }

  async function playTranscriptAudio(entry: TranscriptEntry): Promise<void> {
    setError(null);

    try {
      if (playingTranscriptId === entry.id) {
        stopTranscriptAudio();
        return;
      }

      stopTranscriptAudio();

      const audioBytes = await window.voxtype.history.audio(entry.id);
      const blob = new Blob([audioBytes], { type: "audio/wav" });
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);

      audioElementRef.current = audio;
      audioObjectUrlRef.current = objectUrl;
      setPlayingTranscriptId(entry.id);

      audio.addEventListener(
        "ended",
        () => {
          stopTranscriptAudio();
        },
        { once: true }
      );
      audio.addEventListener(
        "error",
        () => {
          setError("Could not play the saved transcript audio.");
          stopTranscriptAudio();
        },
        { once: true }
      );

      await audio.play();
    } catch (audioError) {
      stopTranscriptAudio();
      setError(formatError(audioError));
    }
  }

  function stopTranscriptAudio(): void {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current = null;
    }

    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }

    setPlayingTranscriptId(null);
  }

  return (
    <main className="dev-shell">
      <header className="dev-toolbar">
        <div className="app-title">VoxType Dev</div>
        <div className="toolbar-status">
          <span className={recording ? "status-dot status-dot-recording" : "status-dot"} />
          <code>{appStatus}</code>
        </div>
        <select
          disabled={!state.settings}
          value={state.settings?.activeModelId ?? ""}
          onChange={(event) => void updateSettings({ activeModelId: event.target.value })}
        >
          <option value="">model</option>
          {state.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.id}
            </option>
          ))}
        </select>
        <button disabled={Boolean(busyMessage) || recording} onClick={() => void startRecording()} type="button">
          Start
        </button>
        <button disabled={!recording} onClick={() => void stopAndTranscribe()} type="button">
          Stop
        </button>
        <code className="toolbar-code">{currentTarget?.processName ?? "target:none"}</code>
        <code className="toolbar-code">{state.settings?.dictationToggleHotkey ?? "hotkey:none"}</code>
        <button onClick={() => void refreshActiveWindow()} type="button">
          Refresh
        </button>
      </header>

      {error ? (
        <div className="inline-error">
          <code>error</code>
          <span>{error}</span>
        </div>
      ) : null}

      <nav className="dev-tabs" aria-label="Developer tabs">
        {devTabs.map((tab) => (
          <button
            className={activeTab === tab.id ? "active" : ""}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="dev-panel">
        {activeTab === "dictation" ? (
          <div className="dictation-layout">
            <section className="panel-block">
              <h2>control</h2>
              <div className="button-row">
                <button disabled={Boolean(busyMessage) || recording} onClick={() => void startRecording()} type="button">
                  Start
                </button>
                <button disabled={!recording} onClick={() => void stopAndTranscribe()} type="button">
                  Stop
                </button>
                <button disabled={!latestTranscript} onClick={() => void copyLatestTranscript()} type="button">
                  Copy
                </button>
                <button disabled={!latestTranscript} onClick={() => void pasteLatestTranscript()} type="button">
                  Insert
                </button>
              </div>
              {state.settings ? (
                <div className="form-grid compact">
                  <label className="checkbox-field">
                    <input
                      checked={state.settings.vadEnabled}
                      type="checkbox"
                      onChange={(event) => void updateSettings({ vadEnabled: event.target.checked })}
                    />
                    VAD
                  </label>
                  <label className="checkbox-field">
                    <input
                      checked={state.settings.autoMuteSystemAudio}
                      type="checkbox"
                      onChange={(event) =>
                        void updateSettings({ autoMuteSystemAudio: event.target.checked })
                      }
                    />
                    mute
                  </label>
                  <label className="dev-field">
                    <span>recorderCaptureMode</span>
                    <select
                      value={state.settings.recorderCaptureMode}
                      onChange={(event) =>
                        void updateSettings({
                          recorderCaptureMode: event.target.value as RecorderCaptureMode
                        })
                      }
                    >
                      <option value="sharedCapture">sharedCapture</option>
                      <option value="exclusiveCapturePreferred">exclusiveCapturePreferred</option>
                      <option value="exclusiveCaptureRequired">exclusiveCaptureRequired</option>
                    </select>
                  </label>
                  <label className="dev-field">
                    <span>recordingCoordinationMode</span>
                    <select
                      value={state.settings.recordingCoordinationMode}
                      onChange={(event) =>
                        void updateSettings({
                          recordingCoordinationMode:
                            event.target.value as RecordingCoordinationMode
                        })
                      }
                    >
                      <option value="none">none</option>
                      <option value="sendHotkey">sendHotkey</option>
                    </select>
                  </label>
                  <label className="dev-field">
                    <span>insertionMode</span>
                    <select
                      value={state.settings.insertionMode}
                      onChange={(event) =>
                        void updateSettings({ insertionMode: event.target.value as InsertionMode })
                      }
                    >
                      <option value="clipboard">clipboard</option>
                      <option value="keyboard">keyboard</option>
                      <option value="chunked">chunked</option>
                    </select>
                  </label>
                </div>
              ) : null}
            </section>

            <section className="panel-block">
              <h2>state</h2>
              <dl className="kv-grid">
                <dt>state</dt>
                <dd>{appStatus}</dd>
                <dt>model</dt>
                <dd>{activeModel?.id ?? "none"}</dd>
                <dt>runtime</dt>
                <dd>{state.runtime ? `${state.runtime.version} ${state.runtime.backend}` : "none"}</dd>
                <dt>helper</dt>
                <dd>{state.windowsHelper?.available ? "available" : "unavailable"}</dd>
                <dt>captureMode</dt>
                <dd>{lastRecordingResult?.captureMode ?? state.settings?.recorderCaptureMode ?? "none"}</dd>
                <dt>target</dt>
                <dd>{currentTarget?.processName ?? "none"}</dd>
                <dt>hwnd</dt>
                <dd>{currentTarget?.hwnd ?? "none"}</dd>
              </dl>
            </section>

            <section className="panel-block transcript-block">
              <h2>latestTranscript</h2>
              <pre>{latestTranscript?.text ?? "empty"}</pre>
              {latestTranscript ? (
                <div className="button-row">
                  <button onClick={() => void copyLatestTranscript()} type="button">
                    Copy
                  </button>
                  <button onClick={() => void pasteLatestTranscript()} type="button">
                    Insert
                  </button>
                  <button
                    disabled={!latestTranscript.audioFileName}
                    onClick={() => void playTranscriptAudio(latestTranscript)}
                    type="button"
                  >
                    {playingTranscriptId === latestTranscript.id ? "Stop" : "Play"}
                  </button>
                </div>
              ) : null}
            </section>

            <section className="panel-block">
              <h2>vad</h2>
              <dl className="kv-grid">
                <dt>enabled</dt>
                <dd>{String(lastRecordingResult?.vad.enabled ?? state.settings?.vadEnabled ?? false)}</dd>
                <dt>speech</dt>
                <dd>{String(lastRecordingResult?.vad.speechDetected ?? false)}</dd>
                <dt>segments</dt>
                <dd>{lastRecordingResult?.vad.speechSegments ?? 0}</dd>
                <dt>originalMs</dt>
                <dd>{lastRecordingResult?.vad.originalDurationMs ?? 0}</dd>
                <dt>trimmedMs</dt>
                <dd>{lastRecordingResult?.vad.trimmedDurationMs ?? 0}</dd>
                <dt>removedMs</dt>
                <dd>{lastRecordingResult?.vad.removedDurationMs ?? 0}</dd>
              </dl>
            </section>

            <section className="panel-block log-block">
              <h2>events</h2>
              <pre>
                {[
                  `status=${appStatus}`,
                  `model=${activeModel?.id ?? "none"}`,
                  `target=${currentTarget?.processName ?? "none"}`,
                  `history=${state.history.length}`,
                  `dictionary=${state.dictionary.length}`,
                  insertionTestResult ? `insertionTest=${insertionTestResult}` : null,
                  lastRecordingResult
                    ? `vad speech=${lastRecordingResult.vad.speechDetected} trimmed=${lastRecordingResult.vad.removedDurationMs}ms`
                    : null
                ]
                  .filter(Boolean)
                  .join("\n")}
              </pre>
            </section>
          </div>
        ) : null}

        {activeTab === "models" ? (
          <div className="stack">
            <section className="panel-block">
              <h2>models</h2>
              <table>
                <thead>
                  <tr>
                    <th>id</th>
                    <th>name</th>
                    <th>size</th>
                    <th>status</th>
                    <th>path</th>
                    <th>action</th>
                  </tr>
                </thead>
                <tbody>
                  {state.models.map((model) => (
                    <tr key={model.id}>
                      <td><code>{model.id}</code></td>
                      <td>{model.name}</td>
                      <td>{model.sizeLabel}</td>
                      <td>{state.settings?.activeModelId === model.id ? "selected" : model.status}</td>
                      <td><code>{model.localPath}</code></td>
                      <td>
                        <div className="table-actions">
                          <button onClick={() => void updateSettings({ activeModelId: model.id })} type="button">
                            Select
                          </button>
                          <button
                            disabled={model.status === "downloaded" || Boolean(busyMessage)}
                            onClick={() => void downloadModel(model.id)}
                            type="button"
                          >
                            Download
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="panel-block">
              <h2>runtime</h2>
              <table>
                <tbody>
                  <tr>
                    <th>name</th>
                    <td>{state.runtime?.name ?? "none"}</td>
                    <th>version</th>
                    <td>{state.runtime?.version ?? "none"}</td>
                    <th>status</th>
                    <td>{state.runtime?.status ?? "none"}</td>
                    <td>
                      <button
                        disabled={state.runtime?.status === "installed" || Boolean(busyMessage)}
                        onClick={() => void installRuntime()}
                        type="button"
                      >
                        Install
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <th>exe</th>
                    <td colSpan={6}><code>{state.runtime?.executablePath ?? "none"}</code></td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
        ) : null}

        {activeTab === "insertion" ? (
          <div className="stack">
            <section className="panel-block">
              <h2>target</h2>
              <dl className="kv-grid wide">
                <dt>process</dt>
                <dd>{currentTarget?.processName ?? "none"}</dd>
                <dt>title</dt>
                <dd>{currentTarget?.title ?? "none"}</dd>
                <dt>hwnd</dt>
                <dd>{currentTarget?.hwnd ?? "none"}</dd>
                <dt>path</dt>
                <dd>{currentTarget?.processPath ?? "none"}</dd>
              </dl>
              <div className="button-row">
                <button onClick={() => void captureInsertionTarget()} type="button">Capture</button>
                <button disabled={!state.activeWindow} onClick={() => void useDetectedAppAsInsertionTarget()} type="button">
                  UseActive
                </button>
                <button disabled={!insertionTarget || Boolean(busyMessage)} onClick={() => void runInsertionTest("clipboard")} type="button">
                  TestClipboard
                </button>
                <button disabled={!insertionTarget || Boolean(busyMessage)} onClick={() => void runInsertionTest("keyboard")} type="button">
                  TestKeyboard
                </button>
                <button disabled={!insertionTarget || Boolean(busyMessage)} onClick={() => void runInsertionTest("chunked")} type="button">
                  TestChunked
                </button>
              </div>
            </section>

            <section className="panel-block">
              <h2>payload</h2>
              <textarea value={insertionTestText} onChange={(event) => setInsertionTestText(event.target.value)} />
              <div className="result-row">
                <code>result</code>
                <span>{insertionTestResult ?? "none"}</span>
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === "profiles" ? (
          <section className="panel-block">
            <h2>profiles</h2>
            <table>
              <thead>
                <tr>
                  <th>app</th>
                  <th>process</th>
                  <th>path</th>
                  <th>insertion</th>
                  <th>style</th>
                </tr>
              </thead>
              <tbody>
                {state.settings?.appProfiles.length ? (
                  state.settings.appProfiles.map((profile) => (
                    <tr key={profile.id}>
                      <td>{profile.displayName}</td>
                      <td><code>{profile.processName}</code></td>
                      <td><code>{profile.processPath ?? "none"}</code></td>
                      <td>
                        <select
                          value={profile.insertionMode}
                          onChange={(event) =>
                            void updateAppProfile(profile, {
                              insertionMode: event.target.value as InsertionMode
                            })
                          }
                        >
                          <option value="clipboard">clipboard</option>
                          <option value="keyboard">keyboard</option>
                          <option value="chunked">chunked</option>
                        </select>
                      </td>
                      <td>
                        <select
                          value={profile.writingStyle}
                          onChange={(event) =>
                            void updateAppProfile(profile, {
                              writingStyle: event.target.value as AppProfile["writingStyle"]
                            })
                          }
                        >
                          <option value="default">default</option>
                          <option value="chat">chat</option>
                          <option value="professional">professional</option>
                        </select>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5}>empty</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        ) : null}

        {activeTab === "dictionary" ? (
          <div className="split-layout">
            <section className="panel-block">
              <h2>entry</h2>
              <div className="form-grid">
                <label className="dev-field">
                  <span>preferred</span>
                  <input value={dictionaryPreferred} onChange={(event) => setDictionaryPreferred(event.target.value)} />
                </label>
                <label className="dev-field">
                  <span>matches</span>
                  <textarea value={dictionaryMatches} onChange={(event) => setDictionaryMatches(event.target.value)} />
                </label>
                <label className="dev-field">
                  <span>category</span>
                  <input value={dictionaryCategory} onChange={(event) => setDictionaryCategory(event.target.value)} />
                </label>
                <label className="dev-field">
                  <span>scope</span>
                  <select value={dictionaryAppProcess} onChange={(event) => setDictionaryAppProcess(event.target.value)}>
                    <option value="">all</option>
                    {state.settings?.appProfiles.map((profile) => (
                      <option key={profile.id} value={profile.processName}>
                        {profile.processName}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="button-row">
                <button disabled={!dictionaryPreferred.trim()} onClick={() => void addDictionaryEntry()} type="button">
                  Save
                </button>
              </div>

              <h2>fixLatest</h2>
              <textarea
                disabled={!latestTranscript}
                value={fixLastText}
                onChange={(event) => setFixLastText(event.target.value)}
              />
              <div className="button-row">
                <button
                  disabled={!latestTranscript || !fixLastText.trim()}
                  onClick={() => void learnFixLastDictation()}
                  type="button"
                >
                  SaveCorrection
                </button>
              </div>
            </section>

            <section className="panel-block">
              <h2>dictionary</h2>
              <table>
                <thead>
                  <tr>
                    <th>preferred</th>
                    <th>source</th>
                    <th>category</th>
                    <th>scope</th>
                    <th>enabled</th>
                    <th>actions</th>
                  </tr>
                </thead>
                <tbody>
                  {state.dictionary.length ? (
                    state.dictionary.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.preferred}</td>
                        <td>{entry.source}</td>
                        <td>{entry.category}</td>
                        <td><code>{entry.appProcessName ?? "all"}</code></td>
                        <td>{String(entry.enabled)}</td>
                        <td>
                          <div className="table-actions">
                            <button onClick={() => void toggleDictionaryEntry(entry)} type="button">
                              {entry.enabled ? "Disable" : "Enable"}
                            </button>
                            <button onClick={() => void removeDictionaryEntry(entry)} type="button">
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>empty</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </div>
        ) : null}

        {activeTab === "settings" && state.settings ? (
          <section className="panel-block">
            <h2>settings</h2>
            <div className="settings-form">
              <label className="dev-field wide">
                <span>whisperExecutablePath</span>
                <input
                  value={state.settings.whisperExecutablePath}
                  onChange={(event) => void updateSettings({ whisperExecutablePath: event.target.value })}
                />
              </label>
              <label className="dev-field wide">
                <span>modelDirectory</span>
                <input
                  value={state.settings.modelDirectory}
                  onChange={(event) => void updateSettings({ modelDirectory: event.target.value })}
                />
              </label>
              <label className="dev-field">
                <span>insertionMode</span>
                <select
                  value={state.settings.insertionMode}
                  onChange={(event) =>
                    void updateSettings({ insertionMode: event.target.value as InsertionMode })
                  }
                >
                  <option value="clipboard">clipboard</option>
                  <option value="keyboard">keyboard</option>
                  <option value="chunked">chunked</option>
                </select>
              </label>
              <label className="dev-field">
                <span>recorderCaptureMode</span>
                <select
                  value={state.settings.recorderCaptureMode}
                  onChange={(event) =>
                    void updateSettings({
                      recorderCaptureMode: event.target.value as RecorderCaptureMode
                    })
                  }
                >
                  <option value="sharedCapture">sharedCapture</option>
                  <option value="exclusiveCapturePreferred">exclusiveCapturePreferred</option>
                  <option value="exclusiveCaptureRequired">exclusiveCaptureRequired</option>
                </select>
              </label>
              <label className="dev-field">
                <span>recordingCoordinationMode</span>
                <select
                  value={state.settings.recordingCoordinationMode}
                  onChange={(event) =>
                    void updateSettings({
                      recordingCoordinationMode: event.target.value as RecordingCoordinationMode
                    })
                  }
                >
                  <option value="none">none</option>
                  <option value="sendHotkey">sendHotkey</option>
                </select>
              </label>
              <label className="dev-field">
                <span>recordingStartHotkey</span>
                <button onClick={() => setCapturingHotkey("recordingStartHotkey")} type="button">
                  {capturingHotkey === "recordingStartHotkey"
                    ? "capture..."
                    : state.settings.recordingStartHotkey || "unset"}
                </button>
              </label>
              <label className="dev-field">
                <span>recordingStopHotkey</span>
                <button onClick={() => setCapturingHotkey("recordingStopHotkey")} type="button">
                  {capturingHotkey === "recordingStopHotkey"
                    ? "capture..."
                    : state.settings.recordingStopHotkey || "same as start"}
                </button>
              </label>
              <label className="dev-field">
                <span>dictationToggleHotkey</span>
                <button onClick={() => setCapturingHotkey("dictationToggleHotkey")} type="button">
                  {capturingHotkey === "dictationToggleHotkey"
                    ? "capture..."
                    : state.settings.dictationToggleHotkey}
                </button>
              </label>
              <label className="dev-field">
                <span>showWindowHotkey</span>
                <button onClick={() => setCapturingHotkey("showWindowHotkey")} type="button">
                  {capturingHotkey === "showWindowHotkey" ? "capture..." : state.settings.showWindowHotkey}
                </button>
              </label>
              <label className="dev-field">
                <span>remoteTypingDelayMs</span>
                <input
                  max={1000}
                  min={0}
                  type="number"
                  value={state.settings.remoteTypingDelayMs}
                  onChange={(event) => void updateSettings({ remoteTypingDelayMs: Number(event.target.value) })}
                />
              </label>
              <label className="dev-field">
                <span>remoteTypingChunkSize</span>
                <input
                  max={250}
                  min={1}
                  type="number"
                  value={state.settings.remoteTypingChunkSize}
                  onChange={(event) => void updateSettings({ remoteTypingChunkSize: Number(event.target.value) })}
                />
              </label>
              <label className="dev-field">
                <span>vadPositiveSpeechThreshold</span>
                <input
                  max={0.95}
                  min={0.05}
                  step={0.05}
                  type="number"
                  value={state.settings.vadPositiveSpeechThreshold}
                  onChange={(event) =>
                    void updateSettings({ vadPositiveSpeechThreshold: Number(event.target.value) })
                  }
                />
              </label>
              <label className="dev-field">
                <span>vadNegativeSpeechThreshold</span>
                <input
                  max={0.9}
                  min={0.01}
                  step={0.05}
                  type="number"
                  value={state.settings.vadNegativeSpeechThreshold}
                  onChange={(event) =>
                    void updateSettings({ vadNegativeSpeechThreshold: Number(event.target.value) })
                  }
                />
              </label>
              <label className="dev-field">
                <span>vadMinSpeechMs</span>
                <input
                  max={5000}
                  min={50}
                  type="number"
                  value={state.settings.vadMinSpeechMs}
                  onChange={(event) => void updateSettings({ vadMinSpeechMs: Number(event.target.value) })}
                />
              </label>
              <label className="dev-field">
                <span>vadPreSpeechPadMs</span>
                <input
                  max={1000}
                  min={0}
                  type="number"
                  value={state.settings.vadPreSpeechPadMs}
                  onChange={(event) => void updateSettings({ vadPreSpeechPadMs: Number(event.target.value) })}
                />
              </label>
              <label className="checkbox-field">
                <input
                  checked={state.settings.restoreClipboard}
                  type="checkbox"
                  onChange={(event) => void updateSettings({ restoreClipboard: event.target.checked })}
                />
                restoreClipboard
              </label>
              <label className="checkbox-field">
                <input
                  checked={state.settings.offlineMode}
                  type="checkbox"
                  onChange={(event) => void updateSettings({ offlineMode: event.target.checked })}
                />
                offlineMode
              </label>
              <label className="checkbox-field">
                <input
                  checked={state.settings.autoMuteSystemAudio}
                  type="checkbox"
                  onChange={(event) => void updateSettings({ autoMuteSystemAudio: event.target.checked })}
                />
                autoMuteSystemAudio
              </label>
              <label className="checkbox-field">
                <input
                  checked={state.settings.vadEnabled}
                  type="checkbox"
                  onChange={(event) => void updateSettings({ vadEnabled: event.target.checked })}
                />
                vadEnabled
              </label>
            </div>
            <div className="result-row">
              <code>hotkeys</code>
              <span>
                dictation={state.hotkeys?.dictationToggleHotkey ?? "none"} show=
                {state.hotkeys?.showWindowHotkey ?? "none"}
              </span>
            </div>
          </section>
        ) : null}

        {activeTab === "logs" ? (
          <section className="panel-block">
            <h2>logs</h2>
            <div className="button-row">
              <button type="button">All</button>
              <button type="button">Clear</button>
              <button type="button">Export</button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>level</th>
                  <th>subsystem</th>
                  <th>message</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>info</td>
                  <td>app</td>
                  <td><code>version={version}</code></td>
                </tr>
                <tr>
                  <td>info</td>
                  <td>state</td>
                  <td><code>status={appStatus}</code></td>
                </tr>
                <tr>
                  <td>info</td>
                  <td>model</td>
                  <td><code>active={activeModel?.id ?? "none"}</code></td>
                </tr>
                <tr>
                  <td>info</td>
                  <td>windows</td>
                  <td><code>target={currentTarget?.processName ?? "none"}</code></td>
                </tr>
                <tr>
                  <td>{error ? "error" : "info"}</td>
                  <td>error</td>
                  <td><code>{error ?? "none"}</code></td>
                </tr>
              </tbody>
            </table>
          </section>
        ) : null}
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

function writingStyleLabel(style: AppProfile["writingStyle"]): string {
  if (style === "chat") {
    return "chat style";
  }

  if (style === "professional") {
    return "professional style";
  }

  return "default style";
}

function profileForWindow(
  profiles: AppProfile[],
  windowInfo: ActiveWindowInfo | null
): AppProfile | null {
  if (!windowInfo?.processName) {
    return null;
  }

  const processName = windowInfo.processName.toLowerCase();
  return profiles.find((profile) => profile.processName === processName) ?? null;
}

function splitMatches(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((match) => match.trim())
    .filter(Boolean);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }

  return `${(milliseconds / 1000).toFixed(1)} s`;
}
