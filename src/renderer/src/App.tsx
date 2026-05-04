import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Code2,
  Download,
  FileText,
  History,
  Home,
  Keyboard,
  Minus,
  MoreVertical,
  Play,
  Plus,
  Settings,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
  Zap,
  type LucideIcon
} from "lucide-react";
import {
  startNativePcmRecorder,
  type PcmRecorder,
  type PcmRecordingResult
} from "./audio-recorder";
import { eventToAccelerator } from "./hotkey-capture";
import { type DictionaryEntry } from "../../../shared/dictionary";
import { type HardwareAccelerationReport } from "../../../shared/hardware";
import { type HotkeyStatus } from "../../../shared/hotkeys";
import { type LocalModel } from "../../../shared/models";
import { type OcrPromptContext } from "../../../shared/ocr-context";
import { type OcrResult } from "../../../shared/ocr";
import { type WhisperRuntime, type WhisperRuntimePreference } from "../../../shared/runtimes";
import {
  type AppProfile,
  type AppSettings,
  type InsertionMode,
  type OcrTermMode,
  type ProfileWhisperLanguage,
  type RecorderCaptureMode,
  type RecordingCoordinationMode,
  type WhisperLanguage
} from "../../../shared/settings";
import { type TranscriptEntry } from "../../../shared/transcripts";
import { type UpdateStatus } from "../../../shared/updates";
import {
  type ActiveWindowInfo,
  type DictationHotkeyPayload,
  type RecordingOverlayState,
  type ScreenshotCaptureMode,
  type ScreenshotCaptureResult,
  type WindowsHelperStatus
} from "../../../shared/windows-helper";

const voxtypeLogoUrl = new URL("../../../resources/icons/voxtype-logo-transparent.png", import.meta.url).href;

type AppState = {
  models: LocalModel[];
  runtime: WhisperRuntime | null;
  runtimes: WhisperRuntime[];
  settings: AppSettings | null;
  history: TranscriptEntry[];
  dictionary: DictionaryEntry[];
  hardware: HardwareAccelerationReport | null;
  windowsHelper: WindowsHelperStatus | null;
  activeWindow: ActiveWindowInfo | null;
  hotkeys: HotkeyStatus | null;
};

type ReleaseTab =
  | "general"
  | "hotkeys"
  | "models"
  | "profiles"
  | "dictionary"
  | "history"
  | "settings";
type ReleaseModelFilter = "all" | "installed" | "available";
type ReleaseIconName =
  | "home"
  | "keyboard"
  | "box"
  | "book"
  | "file"
  | "user"
  | "history"
  | "settings"
  | "code"
  | "bolt"
  | "arrowRight"
  | "shield";

const releaseIcons: Record<ReleaseIconName, LucideIcon> = {
  home: Home,
  keyboard: Keyboard,
  box: Box,
  book: BookOpen,
  file: FileText,
  user: UserPlus,
  history: History,
  settings: Settings,
  code: Code2,
  bolt: Zap,
  arrowRight: ArrowRight,
  shield: ShieldCheck
};

type DevTab =
  | "dictation"
  | "models"
  | "insertion"
  | "profiles"
  | "dictionary"
  | "ocr"
  | "settings"
  | "logs";
type HotkeyCaptureTarget =
  | "dictationToggleHotkey"
  | "dictationHoldHotkey"
  | "showWindowHotkey"
  | "recordingStartHotkey"
  | "recordingStopHotkey";

type SelectOption<T extends string> = {
  label: string;
  meta?: string;
  value: T;
};

const insertionModeOptions: Array<SelectOption<InsertionMode>> = [
  { label: "Clipboard paste", value: "clipboard" },
  { label: "Direct typing", value: "keyboard" },
  { label: "Remote-safe typing", value: "chunked" },
  { label: "Remote clipboard", value: "remoteClipboard" }
];

const writingStyleOptions: Array<SelectOption<AppProfile["writingStyle"]>> = [
  { label: "Default", value: "default" },
  { label: "Chat", value: "chat" },
  { label: "Professional", value: "professional" }
];

const whisperLanguageOptions: Array<SelectOption<WhisperLanguage>> = [
  { label: "Auto", value: "auto" },
  { label: "English", meta: "EN", value: "en" },
  { label: "German", meta: "DE", value: "de" },
  { label: "French", meta: "FR", value: "fr" },
  { label: "Spanish", meta: "ES", value: "es" },
  { label: "Italian", meta: "IT", value: "it" },
  { label: "Portuguese", meta: "PT", value: "pt" },
  { label: "Dutch", meta: "NL", value: "nl" },
  { label: "Polish", meta: "PL", value: "pl" },
  { label: "Russian", meta: "RU", value: "ru" },
  { label: "Japanese", meta: "JA", value: "ja" },
  { label: "Korean", meta: "KO", value: "ko" },
  { label: "Chinese", meta: "ZH", value: "zh" }
];

const profileWhisperLanguageOptions: Array<SelectOption<ProfileWhisperLanguage>> = [
  { label: "Inherit", value: "inherit" },
  ...whisperLanguageOptions
];

const devTabs: Array<{ id: DevTab; label: string }> = [
  { id: "dictation", label: "Dictation" },
  { id: "models", label: "Models" },
  { id: "insertion", label: "Insertion" },
  { id: "profiles", label: "Profiles" },
  { id: "dictionary", label: "Dictionary" },
  { id: "ocr", label: "OCR" },
  { id: "settings", label: "Settings" },
  { id: "logs", label: "Logs" }
];

const defaultOverlayState: RecordingOverlayState = {
  visible: false,
  mode: "recording",
  level: 0,
  message: "Recording"
};
const manualUpdateCheckCooldownSeconds = 30;

export function App(): JSX.Element {
  const isOverlay = new URLSearchParams(window.location.search).get("overlay") === "1";
  const recorderRef = useRef<PcmRecorder | null>(null);
  const hotkeyTargetRef = useRef<ActiveWindowInfo | null>(null);
  const hotkeyOcrContextRef = useRef<OcrPromptContext | null>(null);
  const hotkeySessionIdRef = useRef<number | null>(null);
  const systemAudioMutedByVoxTypeRef = useRef(false);
  const recordingStopHotkeyRef = useRef<string | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const modelDeleteTimerRef = useRef<number | null>(null);
  const checkedForUpdatesRef = useRef(false);
  const [version, setVersion] = useState<string>("0.1.0");
  const [isDeveloperBuild, setIsDeveloperBuild] = useState(true);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [manualUpdateCooldownSeconds, setManualUpdateCooldownSeconds] = useState(0);
  const [state, setState] = useState<AppState>({
    models: [],
    runtime: null,
    runtimes: [],
    settings: null,
    history: [],
    dictionary: [],
    hardware: null,
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
  const [editingDictionaryEntryId, setEditingDictionaryEntryId] = useState<string | null>(null);
  const [dictionaryModalOpen, setDictionaryModalOpen] = useState(false);
  const [fixLastText, setFixLastText] = useState("");
  const [lastRecordingResult, setLastRecordingResult] = useState<PcmRecordingResult | null>(null);
  const [screenshotMode, setScreenshotMode] = useState<ScreenshotCaptureMode>("activeWindow");
  const [latestScreenshot, setLatestScreenshot] = useState<ScreenshotCaptureResult | null>(null);
  const [latestOcrResult, setLatestOcrResult] = useState<OcrResult | null>(null);
  const [latestOcrContext, setLatestOcrContext] = useState<OcrPromptContext | null>(null);
  const [playingTranscriptId, setPlayingTranscriptId] = useState<string | null>(null);
  const [releaseTab, setReleaseTab] = useState<ReleaseTab>("general");
  const [releaseModelFilter, setReleaseModelFilter] = useState<ReleaseModelFilter>("all");
  const [activeTab, setActiveTab] = useState<DevTab>("dictation");
  const [confirmingDeleteModelId, setConfirmingDeleteModelId] = useState<string | null>(null);
  const [capturingProfileHotkey, setCapturingProfileHotkey] = useState<string | null>(null);
  const [selectedProfileProcessName, setSelectedProfileProcessName] = useState<string | null>(
    null
  );
  const [overlayState, setOverlayState] = useState<RecordingOverlayState>(defaultOverlayState);

  const activeModel = state.models.find((model) => model.id === state.settings?.activeModelId);
  const selectedProfile =
    state.settings?.appProfiles.find(
      (profile) => profile.processName === selectedProfileProcessName
    ) ?? null;
  const latestTranscript = state.history[0];
  const currentTarget = insertionTarget ?? state.activeWindow;
  const generatedWhisperPrompt = buildWhisperPromptPreview(
    state.dictionary,
    currentTarget?.processName ?? null,
    latestOcrContext?.terms ?? []
  );
  const effectiveWhisperPrompt = combineWhisperPromptPreview(
    generatedWhisperPrompt,
    state.settings?.whisperPromptOverride ?? ""
  );
  const appStatus = error ? "Error" : recording ? "Recording" : busyMessage ? busyMessage : "Ready";
  const activeRuntimeLabel = state.runtime
    ? `${state.runtime.backend.toUpperCase()} · ${state.runtime.status}`
    : "Runtime not ready";
  const releaseModels = state.models.filter((model) => {
    if (releaseModelFilter === "installed") {
      return model.status === "downloaded";
    }

    if (releaseModelFilter === "available") {
      return model.status !== "downloaded";
    }

    return true;
  });
  const savedDictionaryTerms = new Set(
    state.dictionary.map((entry) => entry.preferred.trim().toLowerCase()).filter(Boolean)
  );
  const updateButtonLabel =
    updateStatus?.state === "checking"
      ? "Checking"
      : updateStatus?.state === "downloading"
      ? "Downloading"
      : updateStatus?.state === "installing"
        ? "Installing"
        : updateStatus?.available
          ? "Update"
          : manualUpdateCooldownSeconds > 0
            ? `${manualUpdateCooldownSeconds}s`
            : "Stable";
  const updateButtonDisabled =
    updateStatus?.state === "checking" ||
    updateStatus?.state === "downloading" ||
    updateStatus?.state === "installing" ||
    (!updateStatus?.available && manualUpdateCooldownSeconds > 0);

  useEffect(() => {
    if (isOverlay) {
      void window.voxtype.recordingOverlay.getState().then(setOverlayState);
      const removeOverlayState = window.voxtype.recordingOverlay.onState(setOverlayState);
      return removeOverlayState;
    }

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

      if (modelDeleteTimerRef.current !== null) {
        window.clearTimeout(modelDeleteTimerRef.current);
      }
    };
  }, [isOverlay]);

  useEffect(() => {
    if (isOverlay) {
      return;
    }

    const removeStart = window.voxtype.dictation.onHotkeyStart((payload) => {
      void handleHotkeyStart(payload);
    });
    const removeStop = window.voxtype.dictation.onHotkeyStop((payload) => {
      void handleHotkeyStop(payload);
    });
    const removeOcrContext = window.voxtype.dictation.onOcrContext((payload) => {
      if (hotkeySessionIdRef.current !== payload.sessionId) {
        return;
      }

      hotkeyOcrContextRef.current = payload.ocrContext;
      setLatestOcrContext(payload.ocrContext);
    });

    void window.voxtype.dictation.getHotkeyState().then((hotkeyState) => {
      if (hotkeyState.recording) {
        void handleHotkeyStart({
          sessionId: hotkeyState.sessionId,
          target: hotkeyState.target,
          ocrContext: hotkeyState.ocrContext
        });
      }
    });

    return () => {
      removeStart();
      removeStop();
      removeOcrContext();
    };
  }, [activeModel?.status, state.settings?.insertionMode, recording, isOverlay]);

  useEffect(() => {
    if (isOverlay || !state.settings || checkedForUpdatesRef.current) {
      return;
    }

    checkedForUpdatesRef.current = true;
    void checkForUpdates();
  }, [isOverlay, state.settings]);

  useEffect(() => {
    if (isOverlay) {
      return;
    }

    if (!capturingHotkey && !capturingProfileHotkey) {
      return;
    }

    let active = true;
    void window.voxtype.hotkeys.suspend().then((hotkeys) => {
      if (active) {
        setState((current) => ({ ...current, hotkeys }));
      }
    });

    return () => {
      active = false;
      void window.voxtype.hotkeys.resume().then((hotkeys) => {
        setState((current) => ({ ...current, hotkeys }));
      });
    };
  }, [capturingHotkey, capturingProfileHotkey, isOverlay]);

  useEffect(() => {
    if (manualUpdateCooldownSeconds <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setManualUpdateCooldownSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [manualUpdateCooldownSeconds]);

  useEffect(() => {
    if (isOverlay) {
      return;
    }

    if (!capturingHotkey && !capturingProfileHotkey) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setCapturingHotkey(null);
        if (capturingProfileHotkey) {
          void updateProfileHotkey(capturingProfileHotkey, "");
        }
        setCapturingProfileHotkey(null);
        return;
      }

      const accelerator = eventToAccelerator(event);

      if (!accelerator) {
        return;
      }

      if (capturingProfileHotkey) {
        const duplicate = findDuplicateHotkey(accelerator, `profile:${capturingProfileHotkey}`);

        if (duplicate) {
          setError(`${accelerator} is already assigned to ${duplicate}.`);
          return;
        }

        setError(null);
        void updateProfileHotkey(capturingProfileHotkey, accelerator);
        setCapturingProfileHotkey(null);
        return;
      }

      if (capturingHotkey) {
        const duplicate = findDuplicateHotkey(accelerator, capturingHotkey);

        if (duplicate) {
          setError(`${accelerator} is already assigned to ${duplicate}.`);
          return;
        }

        setError(null);
        void updateSettings({ [capturingHotkey]: accelerator });
        setCapturingHotkey(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [capturingHotkey, capturingProfileHotkey, state.settings]);

  async function refresh(): Promise<void> {
    const [
      appInfo,
      updates,
      settings,
      models,
      runtime,
      runtimes,
      hardware,
      history,
      dictionary,
      windowsHelper,
      hotkeys
    ] =
      await Promise.all([
      window.voxtype.getAppInfo(),
      window.voxtype.updates.status(),
      window.voxtype.settings.get(),
      window.voxtype.models.list(),
      window.voxtype.runtime.getWhisper(),
      window.voxtype.runtime.listWhisper(),
      window.voxtype.hardware.getAccelerationReport(),
      window.voxtype.history.list(),
      window.voxtype.dictionary.list(),
      window.voxtype.windowsHelper.status(),
      window.voxtype.hotkeys.status()
    ]);

    setVersion(appInfo.versionLabel);
    setIsDeveloperBuild(appInfo.isDeveloperBuild);
    setUpdateStatus(updates);
    setState({
      settings,
      models,
      runtime,
      runtimes,
      hardware,
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

  function captureHotkey(event: MouseEvent, target: HotkeyCaptureTarget): void {
    if (event.button !== 0) {
      return;
    }

    setCapturingHotkey(target);
  }

  function clearHotkey(event: MouseEvent, target: HotkeyCaptureTarget): void {
    event.preventDefault();
    event.stopPropagation();
    setCapturingHotkey((current) => (current === target ? null : current));
    const patch: Pick<AppSettings, HotkeyCaptureTarget> = {
      dictationToggleHotkey: state.settings?.dictationToggleHotkey ?? "",
      dictationHoldHotkey: state.settings?.dictationHoldHotkey ?? "",
      showWindowHotkey: state.settings?.showWindowHotkey ?? "",
      recordingStartHotkey: state.settings?.recordingStartHotkey ?? "",
      recordingStopHotkey: state.settings?.recordingStopHotkey ?? "",
      [target]: ""
    };
    void updateSettings(patch);
  }

  function findDuplicateHotkey(accelerator: string, target: HotkeyCaptureTarget | `profile:${string}`): string | null {
    const normalized = normalizeHotkey(accelerator);

    for (const entry of appHotkeyEntries(state.settings)) {
      if (entry.id !== target && normalizeHotkey(entry.value) === normalized) {
        return entry.label;
      }
    }

    for (const profile of state.settings?.appProfiles ?? []) {
      const id = `profile:${profile.processName}` as const;

      if (
        id !== target &&
        profile.postTranscriptionHotkey.trim() &&
        normalizeHotkey(profile.postTranscriptionHotkey) === normalized
      ) {
        return `${profile.displayName} send key`;
      }
    }

    return null;
  }

  async function checkForUpdates(options: { manual?: boolean } = {}): Promise<void> {
    if (options.manual) {
      if (updateStatus?.state === "checking" || manualUpdateCooldownSeconds > 0) {
        return;
      }

      setManualUpdateCooldownSeconds(manualUpdateCheckCooldownSeconds);
    }

    try {
      const updates = await window.voxtype.updates.check();
      setUpdateStatus(updates);
    } catch (updateError) {
      setUpdateStatus((current) =>
        current
          ? { ...current, state: "error", error: formatError(updateError), available: false }
          : null
      );
    }
  }

  async function installUpdate(): Promise<void> {
    setError(null);
    setBusyMessage("Downloading update...");

    try {
      const updates = await window.voxtype.updates.install();
      setUpdateStatus(updates);

      if (updates.state === "installing") {
        setBusyMessage("Starting update installer...");
      }
    } catch (updateError) {
      setError(formatError(updateError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function handleUpdateButtonClick(): Promise<void> {
    if (updateStatus?.available) {
      await installUpdate();
      return;
    }

    await checkForUpdates({ manual: true });
  }

  async function installRuntime(): Promise<void> {
    setError(null);
    setBusyMessage("Installing whisper.cpp runtime...");

    try {
      const runtime = await window.voxtype.runtime.installWhisper();
      const runtimes = await window.voxtype.runtime.listWhisper();
      setState((current) => ({ ...current, runtime, runtimes }));
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

  async function deleteModel(modelId: string): Promise<void> {
    if (confirmingDeleteModelId !== modelId) {
      setConfirmingDeleteModelId(modelId);

      if (modelDeleteTimerRef.current !== null) {
        window.clearTimeout(modelDeleteTimerRef.current);
      }

      modelDeleteTimerRef.current = window.setTimeout(() => {
        setConfirmingDeleteModelId((current) => (current === modelId ? null : current));
        modelDeleteTimerRef.current = null;
      }, 3000);
      return;
    }

    setError(null);
    setBusyMessage("Deleting model...");

    if (modelDeleteTimerRef.current !== null) {
      window.clearTimeout(modelDeleteTimerRef.current);
      modelDeleteTimerRef.current = null;
    }

    try {
      const models = await window.voxtype.models.delete(modelId);
      const settings = await window.voxtype.settings.get();
      setState((current) => ({ ...current, models, settings }));
      setConfirmingDeleteModelId(null);
    } catch (deleteError) {
      setError(formatError(deleteError));
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
      await window.voxtype.recordingOverlay.showRecording();
      await playRecordingCue("start");

      if (state.settings?.autoMuteSystemAudio) {
        await window.voxtype.windowsHelper.setSystemMute(true);
        systemAudioMutedByVoxTypeRef.current = true;
      }

      recorderRef.current = await startNativePcmRecorder(state.settings);
      await startRecordingCoordination(state.settings);
      setRecording(true);
    } catch (recordingError) {
      await window.voxtype.recordingOverlay.hide();
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

  async function installSpecificRuntime(runtimeId: string): Promise<void> {
    setError(null);
    setBusyMessage("Installing whisper.cpp runtime...");

    try {
      const runtime = await window.voxtype.runtime.installWhisperRuntime(runtimeId);
      const runtimes = await window.voxtype.runtime.listWhisper();
      setState((current) => ({ ...current, runtime, runtimes }));
    } catch (runtimeError) {
      setError(formatError(runtimeError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function setupFirstRunCuda(): Promise<void> {
    setError(null);
    setBusyMessage("Setting up CUDA runtime...");

    try {
      const result = await window.voxtype.runtime.setupFirstRunCuda();
      const runtimes = await window.voxtype.runtime.listWhisper();
      setState((current) => ({
        ...current,
        runtime: result.runtime,
        runtimes,
        settings: result.settings,
        hardware: result.hardware
      }));
      setInsertionTestResult(result.message);
    } catch (runtimeError) {
      setError(formatError(runtimeError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function refreshHardware(): Promise<void> {
    setError(null);

    try {
      const hardware = await window.voxtype.hardware.getAccelerationReport();
      setState((current) => ({ ...current, hardware }));
    } catch (hardwareError) {
      setError(formatError(hardwareError));
    }
  }

  async function handleHotkeyStart(payload: DictationHotkeyPayload): Promise<void> {
    if (recording || recorderRef.current) {
      if (hotkeySessionIdRef.current === payload.sessionId && payload.ocrContext) {
        hotkeyOcrContextRef.current = payload.ocrContext;
        setLatestOcrContext(payload.ocrContext);
      }

      return;
    }

    hotkeySessionIdRef.current = payload.sessionId;
    hotkeyTargetRef.current = payload.target;
    hotkeyOcrContextRef.current = payload.ocrContext;
    setLatestOcrContext(payload.ocrContext);
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

    if (payload.ocrContext) {
      hotkeyOcrContextRef.current = payload.ocrContext;
      setLatestOcrContext(payload.ocrContext);
    }

    await stopAndTranscribe({
      pasteTarget: hotkeyTargetRef.current,
      ocrContext: hotkeyOcrContextRef.current
    });
    await window.voxtype.dictation.setHotkeyRecording(false);
    hotkeyTargetRef.current = null;
    hotkeyOcrContextRef.current = null;
    hotkeySessionIdRef.current = null;
  }

  async function stopAndTranscribe(options?: {
    pasteTarget?: ActiveWindowInfo | null;
    ocrContext?: OcrPromptContext | null;
  }): Promise<void> {
    if (!recorderRef.current) {
      return;
    }

    setRecording(false);
    setBusyMessage("Transcribing locally...");

    try {
      const recordingResult = await recorderRef.current.stop();
      recorderRef.current = null;
      await window.voxtype.recordingOverlay.showTranscribing();
      const coordinationError = await stopRecordingCoordination();
      const unmuteError = await unmuteSystemAudio();
      await playRecordingCue("stop");
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
        processName: options?.pasteTarget?.processName ?? hotkeyTargetRef.current?.processName,
        ocrContext: options?.ocrContext ?? hotkeyOcrContextRef.current
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
        await sendProfilePostTranscriptionHotkey(options.pasteTarget.processName);
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
      await window.voxtype.recordingOverlay.hide();
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

    await insertTranscript(latestTranscript);
  }

  async function insertTranscript(entry: TranscriptEntry): Promise<void> {
    setError(null);

    try {
      await window.voxtype.insertion.insertActive(entry.text);
      setBusyMessage("Inserted transcript into the active app.");
      window.setTimeout(() => setBusyMessage(null), 1800);
    } catch (pasteError) {
      setError(formatError(pasteError));
    }
  }

  async function copyTranscript(entry: TranscriptEntry): Promise<void> {
    await window.voxtype.insertion.copy(entry.text);
    setBusyMessage("Copied transcript to clipboard.");
    window.setTimeout(() => setBusyMessage(null), 1800);
  }

  async function cleanupHistory(): Promise<void> {
    setError(null);

    try {
      const history = await window.voxtype.history.cleanup();
      setState((current) => ({ ...current, history }));
      setBusyMessage("Cleaned up old history.");
      window.setTimeout(() => setBusyMessage(null), 1800);
    } catch (cleanupError) {
      setError(formatError(cleanupError));
    }
  }

  async function transcribeLatestTranscript(): Promise<void> {
    if (!latestTranscript?.audioFileName) {
      return;
    }

    setError(null);
    setBusyMessage("Transcribing saved audio...");

    try {
      const audioBytes = await window.voxtype.history.audio(latestTranscript.id);
      const result = await window.voxtype.transcription.transcribeWav(audioBytes, {
        processName: currentTarget?.processName ?? hotkeyTargetRef.current?.processName,
        ocrContext: latestOcrContext ?? hotkeyOcrContextRef.current
      });
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
      setError(formatError(transcriptionError));
    } finally {
      setBusyMessage(null);
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

  async function addCurrentAppProfile(): Promise<void> {
    setError(null);
    setBusyMessage("Detecting current app...");

    try {
      const [windowsHelper, activeWindow] = await Promise.all([
        window.voxtype.windowsHelper.status(),
        window.voxtype.windowsHelper.activeWindow()
      ]);
      await window.voxtype.appProfiles.ensure(activeWindow);
      const settings = await window.voxtype.settings.get();
      setState((current) => ({ ...current, windowsHelper, activeWindow, settings }));
      setBusyMessage(`Added ${activeWindow.processName}.`);
      window.setTimeout(() => setBusyMessage(null), 1800);
    } catch (profileError) {
      setError(formatError(profileError));
      setBusyMessage(null);
    }
  }

  async function captureScreenshot(): Promise<void> {
    setError(null);
    setBusyMessage("Capturing screenshot...");

    try {
      const screenshot = await window.voxtype.windowsHelper.captureScreenshot(screenshotMode);
      setLatestScreenshot(screenshot);
      setLatestOcrResult(null);
    } catch (screenshotError) {
      setError(formatError(screenshotError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function recognizeLatestScreenshot(): Promise<void> {
    if (!latestScreenshot) {
      return;
    }

    setError(null);
    setBusyMessage("Running Windows OCR...");

    try {
      const ocrResult = await window.voxtype.ocr.recognizeScreenshot(
        latestScreenshot.path,
        latestScreenshot.mode
      );
      setLatestOcrResult(ocrResult);
    } catch (ocrError) {
      setError(formatError(ocrError));
    } finally {
      setBusyMessage(null);
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
    patch: Partial<
      Pick<
        AppProfile,
        | "insertionMode"
        | "writingStyle"
        | "recordingCoordinationMode"
        | "recordingStartHotkey"
        | "recordingStopHotkey"
        | "postTranscriptionHotkey"
        | "whisperLanguage"
        | "neverSuspendDictationInFullscreen"
      >
    >
  ): Promise<void> {
    const nextProfile = {
      insertionMode: patch.insertionMode ?? profile.insertionMode,
      writingStyle: patch.writingStyle ?? profile.writingStyle,
      recordingCoordinationMode:
        patch.recordingCoordinationMode ?? profile.recordingCoordinationMode,
      recordingStartHotkey: patch.recordingStartHotkey ?? profile.recordingStartHotkey,
      recordingStopHotkey: patch.recordingStopHotkey ?? profile.recordingStopHotkey,
      postTranscriptionHotkey:
        patch.postTranscriptionHotkey ?? profile.postTranscriptionHotkey,
      whisperLanguage: patch.whisperLanguage ?? profile.whisperLanguage,
      neverSuspendDictationInFullscreen:
        patch.neverSuspendDictationInFullscreen ??
        profile.neverSuspendDictationInFullscreen
    };
    const settings = await window.voxtype.appProfiles.update(profile.processName, nextProfile);
    setState((current) => ({ ...current, settings }));
  }

  async function removeAppProfile(profile: AppProfile): Promise<void> {
    const settings = await window.voxtype.appProfiles.remove(profile.processName);
    setState((current) => ({ ...current, settings }));

    if (selectedProfileProcessName === profile.processName) {
      setSelectedProfileProcessName(null);
    }

    if (capturingProfileHotkey === profile.processName) {
      setCapturingProfileHotkey(null);
    }
  }

  function closeProfileModal(): void {
    setSelectedProfileProcessName(null);
    setCapturingProfileHotkey(null);
  }

  async function updateProfileHotkey(processName: string, accelerator: string): Promise<void> {
    const profile = state.settings?.appProfiles.find((item) => item.processName === processName);

    if (!profile) {
      return;
    }

    await updateAppProfile(profile, { postTranscriptionHotkey: accelerator });
  }

  async function sendProfilePostTranscriptionHotkey(
    processName: string | null | undefined
  ): Promise<void> {
    if (!processName) {
      return;
    }

    const normalizedProcess = processName.toLowerCase();
    const profile = state.settings?.appProfiles.find(
      (item) => item.processName === normalizedProcess
    );
    const hotkey = profile?.postTranscriptionHotkey.trim();

    if (!hotkey) {
      return;
    }

    await wait(120);
    await window.voxtype.windowsHelper.sendHotkey(hotkey);
  }

  function clearDictionaryForm(): void {
    setDictionaryPreferred("");
    setDictionaryMatches("");
    setDictionaryCategory("general");
    setDictionaryAppProcess("");
    setEditingDictionaryEntryId(null);
  }

  function selectDictionaryEntry(entry: DictionaryEntry): void {
    setDictionaryPreferred(entry.preferred);
    setDictionaryMatches(entry.matches.join("\n"));
    setDictionaryCategory(entry.category);
    setDictionaryAppProcess(entry.appProcessName ?? "");
    setEditingDictionaryEntryId(entry.id);
  }

  function openNewDictionaryModal(): void {
    clearDictionaryForm();
    setDictionaryModalOpen(true);
  }

  function openEditDictionaryModal(entry: DictionaryEntry): void {
    selectDictionaryEntry(entry);
    setDictionaryModalOpen(true);
  }

  function closeDictionaryModal(): void {
    setDictionaryModalOpen(false);
    clearDictionaryForm();
  }

  async function saveDictionaryEntryFromModal(): Promise<void> {
    const saved = await saveDictionaryEntry();
    if (saved) {
      setDictionaryModalOpen(false);
    }
  }

  async function saveDictionaryEntry(): Promise<boolean> {
    setError(null);

    try {
      const entryInput = {
        preferred: dictionaryPreferred,
        matches: splitMatches(dictionaryMatches),
        category: dictionaryCategory || "general",
        appProcessName: dictionaryAppProcess || null
      };
      const dictionary = editingDictionaryEntryId
        ? await window.voxtype.dictionary.update(editingDictionaryEntryId, entryInput)
        : await window.voxtype.dictionary.add({
            ...entryInput,
            source: "user"
          });
      setState((current) => ({ ...current, dictionary }));
      clearDictionaryForm();
      return true;
    } catch (dictionaryError) {
      setError(formatError(dictionaryError));
      return false;
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
    if (editingDictionaryEntryId === entry.id) {
      clearDictionaryForm();
    }
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

  async function saveOcrTerm(term: string): Promise<void> {
    const preferred = term.trim();

    if (!preferred) {
      return;
    }

    setError(null);

    try {
      const dictionary = await window.voxtype.dictionary.add({
        preferred,
        category: "ocr",
        appProcessName: latestOcrContext?.processName ?? null,
        source: "ocr"
      });
      setState((current) => ({ ...current, dictionary }));
    } catch (dictionaryError) {
      setError(formatError(dictionaryError));
    }
  }

  async function copyOcrRawText(): Promise<void> {
    if (!latestOcrContext?.rawText) {
      return;
    }

    await window.voxtype.insertion.copy(latestOcrContext.rawText);
    setBusyMessage("Copied raw OCR text.");
    window.setTimeout(() => setBusyMessage(null), 1800);
  }

  async function copyOcrTerms(): Promise<void> {
    if (!latestOcrContext?.terms.length) {
      return;
    }

    await window.voxtype.insertion.copy(latestOcrContext.terms.join(", "));
    setBusyMessage("Copied OCR terms.");
    window.setTimeout(() => setBusyMessage(null), 1800);
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

  if (isOverlay) {
    return <RecordingOverlay state={overlayState} />;
  }

  if (!state.settings) {
    return (
      <main className="app-shell">
        <WindowTitleBar title="VoxType" />
        <header className="app-header">
          <div>
            <div className="app-brand">VoxType</div>
            <p>Local dictation for Windows</p>
          </div>
        </header>
        <section className="dictation-home">
          <div className="dictation-status">
            <span className="status-dot" />
            <div>
              <strong>Loading</strong>
              <span>Preparing local dictation</span>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (!state.settings.developerModeEnabled || !isDeveloperBuild) {
    return (
      <main className="app-shell release-shell">
        <WindowTitleBar title="VoxType" />
        <aside className="release-sidebar" aria-label="Main navigation">
          <div className="release-sidebar-spacer" />
          <nav className="release-nav">
            {([
              ["general", "Home", "home"],
              ["hotkeys", "Hotkeys", "keyboard"],
              ["models", "Models", "box"],
              ["profiles", "Profiles", "user"],
              ["dictionary", "Dictionary", "book"],
              ["history", "History", "history"]
            ] as Array<[ReleaseTab, string, ReleaseIconName]>).map(([tab, label, icon]) => (
              <button
                className={releaseTab === tab ? "active" : ""}
                key={tab}
                onClick={() => setReleaseTab(tab)}
                type="button"
              >
                <span className="release-nav-icon" aria-hidden="true">
                  <ReleaseIcon name={icon} />
                </span>
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="release-sidebar-bottom">
            <button
              className={
                releaseTab === "settings" ? "release-settings-link active" : "release-settings-link"
              }
              onClick={() => setReleaseTab("settings")}
              type="button"
            >
              <span className="release-nav-icon" aria-hidden="true">
                <ReleaseIcon name="settings" />
              </span>
              <span>Settings</span>
            </button>
            <aside className="sidebar-system-card" aria-label="System status">
              <div className="sidebar-system-head">
                <span className={recording ? "status-dot status-dot-recording" : "status-dot"} />
                <strong>{recording ? "Listening" : appStatus}</strong>
                <p>{error ? "Attention needed" : "All systems go"}</p>
              </div>
              <div className="sidebar-system-foot">
                <span>{version}</span>
                <button
                  className={updateStatus?.available ? "update-available" : ""}
                  disabled={updateButtonDisabled}
                  onClick={() => void handleUpdateButtonClick()}
                  title={
                    updateStatus?.available && updateStatus.latestVersion
                      ? `Install VoxType ${updateStatus.latestVersion}`
                      : manualUpdateCooldownSeconds > 0
                        ? `Check again in ${manualUpdateCooldownSeconds} seconds`
                        : updateStatus?.error ?? "Check for updates"
                  }
                  type="button"
                >
                  {updateButtonLabel}
                </button>
              </div>
            </aside>
          </div>
        </aside>

        <div className="release-main">
          <header className="release-hero">
            <div className="release-hero-copy">
              <h1>VoxType</h1>
              <p>Local dictation for Windows</p>
            </div>
            {isDeveloperBuild ? (
              <button
                className="developer-button"
                onClick={() => void updateSettings({ developerModeEnabled: true })}
                type="button"
              >
                <ReleaseIcon name="code" decorative />
                <span>Developer</span>
              </button>
            ) : null}
          </header>

          {error ? (
            <div className="inline-error release-error">
              <code>error</code>
              <span>{error}</span>
            </div>
          ) : null}
          {busyMessage ? (
            <div className="release-toast" role="status">
              <CheckCircle2 aria-hidden="true" className="release-icon-svg" />
              <span>{busyMessage}</span>
            </div>
          ) : null}

          {releaseTab === "general" ? (
            <div className="release-home-stack">
            <section className="release-panel release-summary-panel">
              <dl className="home-summary">
                <div>
                  <dt>Hotkey</dt>
                  <dd>{state.settings.dictationToggleHotkey || "Unset"}</dd>
                </div>
                <div>
                  <dt>Runtime</dt>
                  <dd>{activeRuntimeLabel}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{activeModel?.name ?? state.settings.activeModelId}</dd>
                </div>
                <div>
                  <dt>GPU</dt>
                  <dd>{state.hardware?.bestGpu?.name ?? "CPU fallback"}</dd>
                </div>
              </dl>
            </section>
            <section className="release-panel settings-panel">
              <div className="settings-list">
                <label className="setting-row">
                  <span>
                    <strong>Language</strong>
                    <small>Auto-detect or force Whisper to listen for one language.</small>
                  </span>
                  <ReleaseSelect
                    ariaLabel="Whisper language"
                    options={whisperLanguageOptions}
                    value={state.settings.whisperLanguage}
                    onChange={(value) => void updateSettings({ whisperLanguage: value })}
                  />
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Start with Windows</strong>
                    <small>Register VoxType to launch automatically when you sign in.</small>
                  </span>
                  <input
                    checked={state.settings.startWithWindows}
                    type="checkbox"
                    onChange={(event) =>
                      void updateSettings({ startWithWindows: event.target.checked })
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Start minimized</strong>
                    <small>Start as a tray icon; double-click it to open VoxType.</small>
                  </span>
                  <input
                    checked={state.settings.startMinimized}
                    type="checkbox"
                    onChange={(event) => void updateSettings({ startMinimized: event.target.checked })}
                  />
                </label>
              </div>
            </section>
            <section className="release-panel recent-history-panel">
              <div className="section-title-row">
                <div className="release-panel-title">
                  <ReleaseIcon name="history" decorative />
                  <h2>Recent history</h2>
                </div>
                <button className="ghost-link-button" onClick={() => setReleaseTab("history")} type="button">
                  <span>View all history</span>
                  <ReleaseIcon name="arrowRight" decorative />
                </button>
              </div>
              <div className="recent-history-list">
                {state.history.length ? (
                  state.history.slice(0, 2).map((entry) => (
                    <article className="recent-history-row" key={entry.id}>
                      <FileText aria-hidden="true" className="release-icon-svg" />
                      <p>{entry.text}</p>
                      <time>{formatRelativeTimestamp(entry.createdAt)}</time>
                      <button aria-label="Transcript actions" type="button">
                        <MoreVertical aria-hidden="true" className="release-icon-svg" />
                      </button>
                    </article>
                  ))
                ) : (
                  <p className="empty-state">No transcriptions yet.</p>
                )}
              </div>
            </section>
            </div>
          ) : null}

          {releaseTab === "settings" ? (
            <section className="release-panel settings-panel">
              <div className="section-title-row">
                <div className="release-panel-title">
                  <ReleaseIcon name="settings" decorative />
                  <h2>Settings</h2>
                </div>
              </div>
              <div className="settings-list">
                <label className="setting-row">
                  <span>
                    <strong>Offline mode</strong>
                    <small>Only use assets already installed on this computer.</small>
                  </span>
                  <input
                    checked={state.settings.offlineMode}
                    type="checkbox"
                    onChange={(event) => void updateSettings({ offlineMode: event.target.checked })}
                  />
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Restore clipboard</strong>
                    <small>Put the previous clipboard back after pasting dictation.</small>
                  </span>
                  <input
                    checked={state.settings.restoreClipboard}
                    type="checkbox"
                    onChange={(event) => void updateSettings({ restoreClipboard: event.target.checked })}
                  />
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Mute system audio</strong>
                    <small>Reduce speaker bleed while VoxType is listening.</small>
                  </span>
                  <input
                    checked={state.settings.autoMuteSystemAudio}
                    type="checkbox"
                    onChange={(event) => void updateSettings({ autoMuteSystemAudio: event.target.checked })}
                  />
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Suspend dictation hotkeys in fullscreen apps</strong>
                    <small>Temporarily unregister dictation hotkeys while a fullscreen app is focused.</small>
                  </span>
                  <input
                    checked={state.settings.suspendDictationHotkeysInFullscreenApps}
                    type="checkbox"
                    onChange={(event) =>
                      void updateSettings({
                        suspendDictationHotkeysInFullscreenApps: event.target.checked
                      })
                    }
                  />
                </label>
              </div>
            </section>
          ) : null}

          {releaseTab === "hotkeys" ? (
            <section className="release-panel">
              <div className="release-panel-title">
                <ReleaseIcon name="keyboard" decorative />
                <h2>Hotkeys</h2>
              </div>
              <div className="settings-list">
                <label className="setting-row">
                  <span>
                    <strong>Dictation</strong>
                    <small>Starts and stops dictation from the active app.</small>
                  </span>
                  <button
                    className="release-command-button"
                    onClick={(event) => captureHotkey(event, "dictationToggleHotkey")}
                    onContextMenu={(event) => clearHotkey(event, "dictationToggleHotkey")}
                    title="Click to capture a hotkey. Right-click to clear."
                    type="button"
                  >
                    {capturingHotkey === "dictationToggleHotkey"
                      ? "Press keys..."
                      : state.settings.dictationToggleHotkey || "Unset"}
                  </button>
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Hold to dictate</strong>
                    <small>Records only while this key combination is held down.</small>
                  </span>
                  <button
                    className="release-command-button"
                    onClick={(event) => captureHotkey(event, "dictationHoldHotkey")}
                    onContextMenu={(event) => clearHotkey(event, "dictationHoldHotkey")}
                    title="Click to capture a hotkey. Right-click to clear."
                    type="button"
                  >
                    {capturingHotkey === "dictationHoldHotkey"
                      ? "Press keys..."
                      : state.settings.dictationHoldHotkey || "Unset"}
                  </button>
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Show VoxType</strong>
                    <small>Brings the setup window back when you need it.</small>
                  </span>
                  <button
                    className="release-command-button"
                    onClick={(event) => captureHotkey(event, "showWindowHotkey")}
                    onContextMenu={(event) => clearHotkey(event, "showWindowHotkey")}
                    title="Click to capture a hotkey. Right-click to clear."
                    type="button"
                  >
                    {capturingHotkey === "showWindowHotkey"
                      ? "Press keys..."
                      : state.settings.showWindowHotkey || "Unset"}
                  </button>
                </label>
                <div className="release-status-strip">
                  <ReleaseStatusBadge tone={state.hotkeys?.dictationToggleHotkey ? "ready" : "disabled"}>
                    Dictation{" "}
                    {state.hotkeys?.dictationSuspendedForFullscreen
                      ? `suspended for ${state.hotkeys.fullscreenProcessName ?? "fullscreen app"}`
                      : state.hotkeys?.dictationToggleHotkey
                        ? "registered"
                        : "not registered"}
                  </ReleaseStatusBadge>
                  <ReleaseStatusBadge tone={state.hotkeys?.dictationHoldHotkey ? "ready" : "disabled"}>
                    Hold {state.hotkeys?.dictationHoldHotkey ? "registered" : "not registered"}
                  </ReleaseStatusBadge>
                  <ReleaseStatusBadge tone={state.hotkeys?.showWindowHotkey ? "ready" : "disabled"}>
                    Show window {state.hotkeys?.showWindowHotkey ? "registered" : "not registered"}
                  </ReleaseStatusBadge>
                </div>
              </div>
            </section>
          ) : null}

        {releaseTab === "models" ? (
          <section className="release-panel">
            <div className="release-panel-heading">
              <div className="release-panel-title">
                <ReleaseIcon name="box" decorative />
                <h2>Models</h2>
              </div>
              <div className="release-segmented" role="group" aria-label="Model filter">
                {(["all", "installed", "available"] as ReleaseModelFilter[]).map((filter) => (
                  <button
                    className={releaseModelFilter === filter ? "active" : ""}
                    key={filter}
                    onClick={() => setReleaseModelFilter(filter)}
                    type="button"
                  >
                    {filter[0].toUpperCase() + filter.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="model-list">
              {releaseModels.map((model) => (
                <article className="model-row" key={model.id}>
                  <div>
                    <strong>{model.name}</strong>
                    <div className="release-chip-row">
                      <ReleaseChip>{model.language}</ReleaseChip>
                      <ReleaseChip>{model.sizeLabel}</ReleaseChip>
                      <ReleaseChip tone={model.status === "downloaded" ? "success" : "neutral"}>
                        {model.status === "downloaded" ? "Installed" : "Available"}
                      </ReleaseChip>
                      <ReleaseChip tone="accent">{gpuFitLabel(state.hardware, model.id)}</ReleaseChip>
                    </div>
                    <small>{model.description}</small>
                  </div>
                  <div className="model-actions">
                    <button
                      className="release-secondary-button"
                      disabled={state.settings.activeModelId === model.id}
                      onClick={() => void updateSettings({ activeModelId: model.id })}
                      type="button"
                    >
                      {state.settings.activeModelId === model.id ? "Active" : "Use"}
                    </button>
                    <button
                      className="release-primary-button"
                      disabled={model.status === "downloaded" || Boolean(busyMessage)}
                      onClick={() => void downloadModel(model.id)}
                      type="button"
                    >
                      {model.status !== "downloaded" ? (
                        <Download aria-hidden="true" className="release-icon-svg" />
                      ) : null}
                      {model.status === "downloaded" ? "Installed" : "Download"}
                    </button>
                    <button
                      className={
                        confirmingDeleteModelId === model.id
                          ? "release-destructive-button"
                          : "release-icon-button"
                      }
                      disabled={model.status !== "downloaded" || Boolean(busyMessage)}
                      aria-label={confirmingDeleteModelId === model.id ? `Confirm delete ${model.name}` : `Delete ${model.name}`}
                      data-tooltip={confirmingDeleteModelId === model.id ? "Confirm delete" : "Delete model"}
                      onClick={() => void deleteModel(model.id)}
                      type="button"
                    >
                      {confirmingDeleteModelId === model.id ? "Confirm" : <Trash2 aria-hidden="true" className="release-icon-svg" />}
                    </button>
                  </div>
                </article>
              ))}
              {!releaseModels.length ? <p className="empty-state">No models match this filter.</p> : null}
            </div>
          </section>
        ) : null}

        {releaseTab === "profiles" ? (
          <section className="release-panel">
            <div className="release-panel-heading">
              <div className="release-panel-title">
                <ReleaseIcon name="user" decorative />
                <h2>App Profiles</h2>
              </div>
              <button
                className="release-primary-button"
                disabled={Boolean(busyMessage)}
                onClick={() => void addCurrentAppProfile()}
                type="button"
              >
                <UserPlus aria-hidden="true" className="release-icon-svg" />
                Add Current App
              </button>
            </div>
            <div className="profile-list">
              {state.settings.appProfiles.length ? (
                state.settings.appProfiles.map((profile) => (
                  <article className="profile-row" key={profile.id}>
                    <button
                      className="profile-row-main"
                      onClick={() => setSelectedProfileProcessName(profile.processName)}
                      type="button"
                    >
                      <span className="profile-heading">
                        <strong>{profile.displayName}</strong>
                        <span>{profile.processName}</span>
                      </span>
                      <span className="profile-summary">
                        <span>{insertionModeLabel(profile.insertionMode)}</span>
                        <span>{writingStyleLabel(profile.writingStyle)}</span>
                        <span>{profileWhisperLanguageLabel(profile.whisperLanguage)}</span>
                        <span>{profile.postTranscriptionHotkey || "No send key"}</span>
                        {state.settings.suspendDictationHotkeysInFullscreenApps &&
                        profile.neverSuspendDictationInFullscreen ? (
                          <span>Never suspend</span>
                        ) : null}
                      </span>
                    </button>
                    <button
                      aria-label={`Remove ${profile.displayName} profile`}
                      className="release-icon-button"
                      data-tooltip="Remove profile"
                      disabled={Boolean(busyMessage)}
                      onClick={() => void removeAppProfile(profile)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" className="release-icon-svg" />
                    </button>
                  </article>
                ))
              ) : (
                <p className="empty-state">Profiles appear after VoxType sees an app during dictation.</p>
              )}
            </div>

            {selectedProfile ? (
              <div
                aria-modal="true"
                className="release-modal-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    closeProfileModal();
                  }
                }}
                role="dialog"
              >
                <section className="release-modal profile-modal">
                  <div className="release-modal-header">
                    <div className="release-panel-title">
                      <ReleaseIcon name="user" decorative />
                      <h2>{selectedProfile.displayName}</h2>
                    </div>
                    <button
                      aria-label="Close profile settings"
                      className="release-icon-button"
                      data-tooltip="Close"
                      onClick={closeProfileModal}
                      type="button"
                    >
                      <X aria-hidden="true" className="release-icon-svg" />
                    </button>
                  </div>

                  <div className="profile-modal-meta">
                    <span>{selectedProfile.processName}</span>
                    {selectedProfile.processPath ? <span>{selectedProfile.processPath}</span> : null}
                  </div>

                  <div className="release-form-grid">
                    <div className="release-field">
                      <span>Insert with</span>
                      <ReleaseSelect
                        ariaLabel={`Insertion mode for ${selectedProfile.displayName}`}
                        options={insertionModeOptions}
                        value={selectedProfile.insertionMode}
                        onChange={(value) =>
                          void updateAppProfile(selectedProfile, {
                            insertionMode: value
                          })
                        }
                      />
                    </div>
                    <div className="release-field">
                      <span>Writing style</span>
                      <ReleaseSelect
                        ariaLabel={`Writing style for ${selectedProfile.displayName}`}
                        options={writingStyleOptions}
                        value={selectedProfile.writingStyle}
                        onChange={(value) =>
                          void updateAppProfile(selectedProfile, {
                            writingStyle: value
                          })
                        }
                      />
                    </div>
                    <div className="release-field">
                      <span>Language</span>
                      <ReleaseSelect
                        ariaLabel={`Language for ${selectedProfile.displayName}`}
                        options={profileWhisperLanguageOptions}
                        value={selectedProfile.whisperLanguage}
                        onChange={(value) =>
                          void updateAppProfile(selectedProfile, {
                            whisperLanguage: value
                          })
                        }
                      />
                    </div>
                    <div className="release-field">
                      <span>Send after insert</span>
                      <button
                        className="release-command-button"
                        onClick={() => setCapturingProfileHotkey(selectedProfile.processName)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          void updateAppProfile(selectedProfile, { postTranscriptionHotkey: "" });
                        }}
                        title="Click to capture a hotkey. Press Escape while capturing or right-click to clear."
                        type="button"
                      >
                        {capturingProfileHotkey === selectedProfile.processName
                          ? "Press keys..."
                          : selectedProfile.postTranscriptionHotkey || "None"}
                      </button>
                    </div>
                    {state.settings.suspendDictationHotkeysInFullscreenApps ? (
                      <label className="setting-row">
                        <span>
                          <strong>Never suspend in fullscreen</strong>
                          <small>Keep dictation hotkeys active for this app.</small>
                        </span>
                        <input
                          checked={selectedProfile.neverSuspendDictationInFullscreen}
                          type="checkbox"
                          onChange={(event) =>
                            void updateAppProfile(selectedProfile, {
                              neverSuspendDictationInFullscreen: event.target.checked
                            })
                          }
                        />
                      </label>
                    ) : null}
                  </div>

                  <div className="release-form-actions">
                    <button
                      className="release-destructive-button"
                      disabled={Boolean(busyMessage)}
                      onClick={() => void removeAppProfile(selectedProfile)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" className="release-icon-svg" />
                      Remove
                    </button>
                    <button className="release-primary-button" onClick={closeProfileModal} type="button">
                      Done
                    </button>
                  </div>
                </section>
              </div>
            ) : null}
          </section>
        ) : null}

        {releaseTab === "dictionary" ? (
          <div className="release-dictionary-layout">
            <section className="release-panel release-dictionary-list-panel">
              <div className="release-panel-heading">
                <div className="release-panel-title">
                  <ReleaseIcon name="book" decorative />
                  <h2>Saved Entries</h2>
                </div>
                <div className="release-panel-actions">
                  <ReleaseChip>{state.dictionary.length}</ReleaseChip>
                  <button className="release-primary-button" onClick={openNewDictionaryModal} type="button">
                    <Plus aria-hidden="true" className="release-icon-svg" />
                    Add Entry
                  </button>
                </div>
              </div>

              <div className="dictionary-entry-list">
                {state.dictionary.length ? (
                  state.dictionary.map((entry) => (
                    <article
                      className={
                        editingDictionaryEntryId === entry.id
                          ? "dictionary-entry-row selected"
                          : "dictionary-entry-row"
                      }
                      key={entry.id}
                    >
                      <button
                        className="dictionary-entry-main"
                        onClick={() => openEditDictionaryModal(entry)}
                        type="button"
                      >
                        <strong>{entry.preferred}</strong>
                        <span>
                          {entry.category} · {entry.source} · {entry.appProcessName ?? "all apps"}
                        </span>
                      </button>
                      <div className="dictionary-entry-actions">
                        <button
                          className="release-secondary-button"
                          onClick={() => void toggleDictionaryEntry(entry)}
                          type="button"
                        >
                          {entry.enabled ? "On" : "Off"}
                        </button>
                        <button
                          aria-label={`Delete ${entry.preferred}`}
                          className="release-icon-button"
                          data-tooltip="Delete"
                          onClick={() => void removeDictionaryEntry(entry)}
                          type="button"
                        >
                          <Trash2 aria-hidden="true" className="release-icon-svg" />
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="empty-state">No dictionary entries yet.</p>
                )}
              </div>
            </section>

            <section className="release-panel release-ocr-terms-panel">
              <div className="section-title-row">
                <div className="release-panel-title">
                  <ReleaseIcon name="file" decorative />
                  <h2>Latest OCR Terms</h2>
                </div>
                <ReleaseChip tone={latestOcrContext?.terms.length ? "accent" : "neutral"}>
                  {latestOcrContext?.terms.length ?? 0}
                </ReleaseChip>
              </div>
              {latestOcrContext?.terms.length ? (
                <div className="release-ocr-term-list">
                  {latestOcrContext.terms.map((term) => {
                    const saved = savedDictionaryTerms.has(term.trim().toLowerCase());

                    return (
                      <button
                        className={saved ? "saved" : ""}
                        disabled={saved}
                        key={term}
                        onClick={() => void saveOcrTerm(term)}
                        title={saved ? "Already in dictionary" : "Add to dictionary"}
                        type="button"
                      >
                        {saved ? <Check aria-hidden="true" className="release-icon-svg" /> : null}
                        <span>{term}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="empty-state">No OCR terms captured yet.</p>
              )}
            </section>

            {dictionaryModalOpen ? (
              <div
                aria-modal="true"
                className="release-modal-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    closeDictionaryModal();
                  }
                }}
                role="dialog"
              >
                <section className="release-modal">
                  <div className="release-modal-header">
                    <div className="release-panel-title">
                      <ReleaseIcon name="book" decorative />
                      <h2>{editingDictionaryEntryId ? "Edit Entry" : "Add Entry"}</h2>
                    </div>
                    <button
                      aria-label="Close dictionary entry"
                      className="release-icon-button"
                      data-tooltip="Close"
                      onClick={closeDictionaryModal}
                      type="button"
                    >
                      <X aria-hidden="true" className="release-icon-svg" />
                    </button>
                  </div>

                  <div className="release-form-grid">
                    <label className="release-field">
                      <span>Word or phrase</span>
                      <input
                        autoFocus
                        value={dictionaryPreferred}
                        onChange={(event) => setDictionaryPreferred(event.target.value)}
                      />
                    </label>
                    <label className="release-field">
                      <span>Misheard as</span>
                      <textarea
                        rows={2}
                        value={dictionaryMatches}
                        onChange={(event) => setDictionaryMatches(event.target.value)}
                      />
                    </label>
                    <div className="release-form-split">
                      <label className="release-field">
                        <span>Category</span>
                        <input
                          value={dictionaryCategory}
                          onChange={(event) => setDictionaryCategory(event.target.value)}
                        />
                      </label>
                      <label className="release-field">
                        <span>Scope</span>
                        <select
                          value={dictionaryAppProcess}
                          onChange={(event) => setDictionaryAppProcess(event.target.value)}
                        >
                          <option value="">All apps</option>
                          {state.settings.appProfiles.map((profile) => (
                            <option key={profile.id} value={profile.processName}>
                              {profile.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="release-form-actions">
                    <button className="release-secondary-button" onClick={closeDictionaryModal} type="button">
                      Cancel
                    </button>
                    <button
                      className="release-primary-button"
                      disabled={!dictionaryPreferred.trim()}
                      onClick={() => void saveDictionaryEntryFromModal()}
                      type="button"
                    >
                      {editingDictionaryEntryId ? "Update" : "Add"}
                    </button>
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        ) : null}

        {releaseTab === "history" ? (
          <section className="release-panel">
            <div className="release-panel-heading">
              <div className="release-panel-title">
                <ReleaseIcon name="history" decorative />
                <h2>Latest Transcriptions</h2>
              </div>
              <button
                className="release-secondary-button"
                disabled={state.history.length === 0}
                onClick={() => void cleanupHistory()}
                type="button"
              >
                Cleanup
              </button>
            </div>
            <div className="history-list">
              {state.history.length ? (
                state.history.slice(0, 10).map((entry) => (
                  <article className="history-row" key={entry.id}>
                    <div>
                      <strong>{formatTimestamp(entry.createdAt)}</strong>
                      <p>{entry.text}</p>
                      <small>
                        {entry.modelId} · {formatDuration(entry.durationMs)}
                        {entry.audioFileName ? " · audio saved" : ""}
                      </small>
                    </div>
                    <div className="history-actions">
                      <button
                        aria-label="Copy transcript"
                        className="release-icon-button"
                        data-tooltip="Copy"
                        onClick={() => void copyTranscript(entry)}
                        type="button"
                      >
                        <Clipboard aria-hidden="true" className="release-icon-svg" />
                      </button>
                      <button
                        aria-label="Insert transcript"
                        className="release-icon-button"
                        data-tooltip="Insert"
                        onClick={() => void insertTranscript(entry)}
                        type="button"
                      >
                        <ArrowRight aria-hidden="true" className="release-icon-svg" />
                      </button>
                      <button
                        aria-label={playingTranscriptId === entry.id ? "Stop audio" : "Play audio"}
                        className="release-icon-button"
                        data-tooltip={playingTranscriptId === entry.id ? "Stop audio" : "Play audio"}
                        disabled={!entry.audioFileName}
                        onClick={() => void playTranscriptAudio(entry)}
                        type="button"
                      >
                        <Play aria-hidden="true" className="release-icon-svg" />
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="empty-state">No transcriptions yet.</p>
              )}
            </div>
          </section>
        ) : null}

        </div>
      </main>
    );
  }

  return (
    <main className="dev-shell">
      <WindowTitleBar title="VoxType Dev" />
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
        <button onClick={() => void updateSettings({ developerModeEnabled: false })} type="button">
          ExitDev
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
                      <option value="remoteClipboard">remoteClipboard</option>
                      <option value="keyboard">keyboard</option>
                      <option value="chunked">chunked</option>
                      <option value="windowsMessaging">windowsMessaging</option>
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
                <dt>helperBuild</dt>
                <dd title={state.windowsHelper?.helperModifiedAt ?? undefined}>
                  {formatTimestamp(state.windowsHelper?.helperModifiedAt)}
                </dd>
                <dt>helperSize</dt>
                <dd>{formatBytes(state.windowsHelper?.helperSizeBytes)}</dd>
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
              <dl className="kv-grid">
                <dt>dictionaryFixes</dt>
                <dd>{latestTranscript?.correctionsApplied?.length ?? 0}</dd>
                <dt>ocrFixes</dt>
                <dd>{latestTranscript?.ocrCorrectionsApplied?.length ?? 0}</dd>
              </dl>
              <pre>
                {[
                  ...(latestTranscript?.correctionsApplied ?? []).map((item) => `dictionary: ${item}`),
                  ...(latestTranscript?.ocrCorrectionsApplied ?? []).map((item) => `ocr: ${item}`)
                ].join("\n") || "no corrections"}
              </pre>
              {latestTranscript ? (
                <div className="button-row">
                  <button onClick={() => void copyLatestTranscript()} type="button">
                    Copy
                  </button>
                  <button onClick={() => void pasteLatestTranscript()} type="button">
                    Insert
                  </button>
                  <button
                    disabled={!latestTranscript.audioFileName || Boolean(busyMessage)}
                    onClick={() => void transcribeLatestTranscript()}
                    type="button"
                  >
                    Transcribe
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

            <section className="panel-block transcript-block">
              <h2>whisperPrompt</h2>
              <dl className="kv-grid">
                <dt>mode</dt>
                <dd>{state.settings?.whisperPromptOverride.trim() ? "custom" : "default"}</dd>
                <dt>sent</dt>
                <dd>{latestTranscript?.promptContext ? "yes" : "none"}</dd>
              </dl>
              <textarea
                value={state.settings?.whisperPromptOverride || generatedWhisperPrompt}
                onChange={(event) => void updateSettings({ whisperPromptOverride: event.target.value })}
              />
              <div className="button-row">
                <button
                  disabled={!state.settings?.whisperPromptOverride}
                  onClick={() => void updateSettings({ whisperPromptOverride: "" })}
                  type="button"
                >
                  Default
                </button>
              </div>
              <pre>{latestTranscript?.promptContext ?? (effectiveWhisperPrompt || "empty")}</pre>
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

            <section className="panel-block transcript-block">
              <h2>ocrContext</h2>
              <dl className="kv-grid">
                <dt>engine</dt>
                <dd>{latestOcrContext?.engine ?? "none"}</dd>
                <dt>target</dt>
                <dd>{latestOcrContext?.processName ?? "none"}</dd>
                <dt>mode</dt>
                <dd>{latestOcrContext?.termMode ?? state.settings?.ocrTermMode ?? "balanced"}</dd>
                <dt>lines</dt>
                <dd>{latestOcrContext?.lineCount ?? 0}</dd>
                <dt>rawChars</dt>
                <dd>{latestOcrContext?.rawText.length ?? 0}</dd>
                <dt>terms</dt>
                <dd>{latestOcrContext?.terms.length ?? 0}</dd>
                <dt>rejected</dt>
                <dd>{latestOcrContext?.rejectedTerms.length ?? 0}</dd>
              </dl>
              <label className="dev-field">
                <span>ocrTermMode</span>
                <select
                  value={state.settings?.ocrTermMode ?? "balanced"}
                  onChange={(event) =>
                    void updateSettings({ ocrTermMode: event.target.value as OcrTermMode })
                  }
                >
                  <option value="strict">strict</option>
                  <option value="balanced">balanced</option>
                  <option value="broad">broad</option>
                </select>
              </label>
              <h2>ocrRawText</h2>
              <div className="button-row">
                <button disabled={!latestOcrContext?.rawText} onClick={() => void copyOcrRawText()} type="button">
                  CopyRaw
                </button>
                <button disabled={!latestOcrContext?.terms.length} onClick={() => void copyOcrTerms()} type="button">
                  CopyTerms
                </button>
              </div>
              <pre>{latestOcrContext?.rawText || "empty"}</pre>
              <h2>ocrTerms</h2>
              {latestOcrContext?.terms.length ? (
                <div className="ocr-term-list">
                  {latestOcrContext.terms.map((term) => (
                    <button
                      key={term}
                      onClick={() => void saveOcrTerm(term)}
                      type="button"
                      title="Save OCR term to dictionary"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              ) : (
                <pre>empty</pre>
              )}
              <h2>ocrRejected</h2>
              <pre>{latestOcrContext?.rejectedTerms.join(", ") || "empty"}</pre>
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
                  latestOcrContext ? `ocrTerms=${latestOcrContext.terms.length}` : null,
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
                    <th>gpu fit</th>
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
                      <td>{gpuFitLabel(state.hardware, model.id)}</td>
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
                          <button
                            className={confirmingDeleteModelId === model.id ? "danger-button" : ""}
                            disabled={model.status !== "downloaded" || Boolean(busyMessage)}
                            onClick={() => void deleteModel(model.id)}
                            type="button"
                          >
                            {confirmingDeleteModelId === model.id ? "Confirm" : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="panel-block">
              <h2>gpu</h2>
              <dl className="kv-grid">
                <dt>mode</dt>
                <dd>{state.settings?.whisperRuntimeBackend ?? "auto"}</dd>
                <dt>backend</dt>
                <dd>{state.hardware?.recommendedBackend ?? "unknown"}</dd>
                <dt>usable</dt>
                <dd>{state.hardware?.canUseGpuRuntime ? "yes" : "no"}</dd>
                <dt>bestGpu</dt>
                <dd>{state.hardware?.bestGpu?.name ?? "none"}</dd>
                <dt>vram</dt>
                <dd>{formatVram(state.hardware?.bestGpu?.dedicatedVramMb)}</dd>
              </dl>
              <div className="button-row">
                <button onClick={() => void refreshHardware()} type="button">
                  Detect
                </button>
                <button
                  disabled={
                    Boolean(busyMessage) ||
                    state.hardware?.recommendedBackend !== "cuda" ||
                    (state.runtime?.backend === "cuda" && state.runtime.status === "installed")
                  }
                  onClick={() => void setupFirstRunCuda()}
                  type="button"
                >
                  SetupCuda
                </button>
              </div>
              {state.settings ? (
                <label className="dev-field">
                  <span>whisperRuntimeBackend</span>
                  <select
                    value={state.settings.whisperRuntimeBackend}
                    onChange={(event) =>
                      void updateSettings({
                        whisperRuntimeBackend: event.target.value as WhisperRuntimePreference
                      })
                    }
                  >
                    <option value="auto">auto</option>
                    <option value="cpu">cpu</option>
                    <option value="cuda">cuda</option>
                    <option value="vulkan">vulkan</option>
                  </select>
                </label>
              ) : null}
              <table>
                <thead>
                  <tr>
                    <th>gpu</th>
                    <th>vendor</th>
                    <th>vram</th>
                    <th>cuda</th>
                    <th>vulkan</th>
                    <th>source</th>
                  </tr>
                </thead>
                <tbody>
                  {(state.hardware?.gpus ?? []).map((gpu) => (
                    <tr key={`${gpu.source}-${gpu.name}`}>
                      <td>{gpu.name}</td>
                      <td>{gpu.vendor}</td>
                      <td>{formatVram(gpu.dedicatedVramMb)}</td>
                      <td>{gpu.supportsCuda ? "yes" : "no"}</td>
                      <td>{gpu.supportsVulkan === null ? "unknown" : gpu.supportsVulkan ? "yes" : "no"}</td>
                      <td>{gpu.source}</td>
                    </tr>
                  ))}
                  {state.hardware?.gpus.length ? null : (
                    <tr>
                      <td colSpan={6}>No GPU detected yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <pre>{state.hardware?.notes.join("\n") ?? "Detect GPU capability to estimate Whisper acceleration."}</pre>
            </section>

            <section className="panel-block">
              <h2>runtime</h2>
              <table>
                <thead>
                  <tr>
                    <th>name</th>
                    <th>version</th>
                    <th>backend</th>
                    <th>status</th>
                    <th>path</th>
                    <th>action</th>
                  </tr>
                </thead>
                <tbody>
                  {state.runtimes.map((runtime) => (
                    <tr key={runtime.id}>
                      <td>{runtime.name}</td>
                      <td>{runtime.version}</td>
                      <td>{runtime.backend}</td>
                      <td>
                        {state.runtime?.id === runtime.id ? `active:${runtime.status}` : runtime.status}
                      </td>
                      <td><code>{runtime.executablePath ?? runtime.notes}</code></td>
                      <td>
                        <button
                          disabled={
                            !runtime.managed ||
                            runtime.status === "installed" ||
                            Boolean(busyMessage)
                          }
                          onClick={() => void installSpecificRuntime(runtime.id)}
                          type="button"
                        >
                          Install
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="button-row">
                <button
                  disabled={state.runtime?.status === "installed" || Boolean(busyMessage)}
                  onClick={() => void installRuntime()}
                  type="button"
                >
                  InstallAuto
                </button>
              </div>
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
                <button disabled={!insertionTarget || Boolean(busyMessage)} onClick={() => void runInsertionTest("remoteClipboard")} type="button">
                  TestRemoteClipboard
                </button>
                <button disabled={!insertionTarget || Boolean(busyMessage)} onClick={() => void runInsertionTest("keyboard")} type="button">
                  TestKeyboard
                </button>
                <button disabled={!insertionTarget || Boolean(busyMessage)} onClick={() => void runInsertionTest("chunked")} type="button">
                  TestChunked
                </button>
                <button disabled={!insertionTarget || Boolean(busyMessage)} onClick={() => void runInsertionTest("windowsMessaging")} type="button">
                  TestMessaging
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
                  <th>language</th>
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
                          <option value="remoteClipboard">remoteClipboard</option>
                          <option value="keyboard">keyboard</option>
                          <option value="chunked">chunked</option>
                          <option value="windowsMessaging">windowsMessaging</option>
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
                      <td>
                        <select
                          value={profile.whisperLanguage}
                          onChange={(event) =>
                            void updateAppProfile(profile, {
                              whisperLanguage: event.target.value as ProfileWhisperLanguage
                            })
                          }
                        >
                          {profileWhisperLanguageOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.value}
                            </option>
                          ))}
                        </select>
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
        ) : null}

        {activeTab === "dictionary" ? (
          <div className="split-layout">
            <section className="panel-block">
              <h2>{editingDictionaryEntryId ? "editEntry" : "entry"}</h2>
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
                <button disabled={!dictionaryPreferred.trim()} onClick={() => void saveDictionaryEntry()} type="button">
                  {editingDictionaryEntryId ? "Update" : "Save"}
                </button>
                {editingDictionaryEntryId ? (
                  <button onClick={clearDictionaryForm} type="button">
                    New
                  </button>
                ) : null}
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
                      <tr
                        className={editingDictionaryEntryId === entry.id ? "selected-row" : undefined}
                        key={entry.id}
                        onClick={() => selectDictionaryEntry(entry)}
                      >
                        <td>{entry.preferred}</td>
                        <td>{entry.source}</td>
                        <td>{entry.category}</td>
                        <td><code>{entry.appProcessName ?? "all"}</code></td>
                        <td>{String(entry.enabled)}</td>
                        <td>
                          <div className="table-actions">
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                void toggleDictionaryEntry(entry);
                              }}
                              type="button"
                            >
                              {entry.enabled ? "Disable" : "Enable"}
                            </button>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                void removeDictionaryEntry(entry);
                              }}
                              type="button"
                            >
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

        {activeTab === "ocr" ? (
          <div className="stack">
            <section className="panel-block">
              <h2>capture</h2>
              <div className="form-grid compact">
                <label className="dev-field">
                  <span>mode</span>
                  <select
                    value={screenshotMode}
                    onChange={(event) =>
                      setScreenshotMode(event.target.value as ScreenshotCaptureMode)
                    }
                  >
                    <option value="activeWindow">activeWindow</option>
                    <option value="screen">screen</option>
                  </select>
                </label>
              </div>
              <div className="button-row">
                <button disabled={Boolean(busyMessage)} onClick={() => void captureScreenshot()} type="button">
                  Capture
                </button>
                <button
                  disabled={!latestScreenshot || Boolean(busyMessage)}
                  onClick={() => void recognizeLatestScreenshot()}
                  type="button"
                >
                  RunWindowsOCR
                </button>
              </div>
              <dl className="kv-grid wide">
                <dt>engine</dt>
                <dd>{latestOcrResult?.engine ?? "Windows Media OCR"}</dd>
                <dt>mode</dt>
                <dd>{latestScreenshot?.mode ?? screenshotMode}</dd>
                <dt>capturedAt</dt>
                <dd>{latestScreenshot?.capturedAt ?? "none"}</dd>
                <dt>path</dt>
                <dd>{latestScreenshot?.path ?? "none"}</dd>
                <dt>bytes</dt>
                <dd>{latestScreenshot?.bytes.byteLength ?? 0}</dd>
                <dt>lines</dt>
                <dd>{latestOcrResult?.lines.length ?? 0}</dd>
                <dt>durationMs</dt>
                <dd>{latestOcrResult?.durationMs ?? 0}</dd>
              </dl>
            </section>

            <section className="panel-block">
              <h2>preview</h2>
              {latestScreenshot ? (
                <img
                  alt="Latest OCR screenshot capture"
                  className="screenshot-preview"
                  src={pngBytesToDataUrl(latestScreenshot.bytes)}
                />
              ) : (
                <pre>empty</pre>
              )}
            </section>

            <section className="panel-block transcript-block">
              <h2>ocrText</h2>
              <pre>{latestOcrResult?.text || "empty"}</pre>
            </section>

            <section className="panel-block">
              <h2>ocrLines</h2>
              <table>
                <thead>
                  <tr>
                    <th>text</th>
                    <th>confidence</th>
                    <th>box</th>
                  </tr>
                </thead>
                <tbody>
                  {latestOcrResult?.lines.length ? (
                    latestOcrResult.lines.map((line, index) => (
                      <tr key={`${line.text}-${index}`}>
                        <td>{line.text}</td>
                        <td>{line.confidence?.toFixed(3) ?? "n/a"}</td>
                        <td><code>{line.box?.join(",") ?? "n/a"}</code></td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3}>empty</td>
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
              <label className="dev-field">
                <span>whisperRuntimeBackend</span>
                <select
                  value={state.settings.whisperRuntimeBackend}
                  onChange={(event) =>
                    void updateSettings({
                      whisperRuntimeBackend: event.target.value as WhisperRuntimePreference
                    })
                  }
                >
                  <option value="auto">auto</option>
                  <option value="cpu">cpu</option>
                  <option value="cuda">cuda</option>
                  <option value="vulkan">vulkan</option>
                </select>
              </label>
              <label className="dev-field">
                <span>whisperLanguage</span>
                <select
                  value={state.settings.whisperLanguage}
                  onChange={(event) =>
                    void updateSettings({ whisperLanguage: event.target.value as WhisperLanguage })
                  }
                >
                  {whisperLanguageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.value}
                    </option>
                  ))}
                </select>
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
                  <option value="remoteClipboard">remoteClipboard</option>
                  <option value="keyboard">keyboard</option>
                  <option value="chunked">chunked</option>
                  <option value="windowsMessaging">windowsMessaging</option>
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
                <span>remoteClipboardPasteDelayMs</span>
                <input
                  min={0}
                  max={5000}
                  step={50}
                  type="number"
                  value={state.settings.remoteClipboardPasteDelayMs}
                  onChange={(event) =>
                    void updateSettings({
                      remoteClipboardPasteDelayMs: Number(event.target.value)
                    })
                  }
                />
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
                <button
                  onClick={(event) => captureHotkey(event, "recordingStartHotkey")}
                  onContextMenu={(event) => clearHotkey(event, "recordingStartHotkey")}
                  type="button"
                >
                  {capturingHotkey === "recordingStartHotkey"
                    ? "capture..."
                    : state.settings.recordingStartHotkey || "unset"}
                </button>
              </label>
              <label className="dev-field">
                <span>recordingStopHotkey</span>
                <button
                  onClick={(event) => captureHotkey(event, "recordingStopHotkey")}
                  onContextMenu={(event) => clearHotkey(event, "recordingStopHotkey")}
                  type="button"
                >
                  {capturingHotkey === "recordingStopHotkey"
                    ? "capture..."
                    : state.settings.recordingStopHotkey || "same as start"}
                </button>
              </label>
              <label className="dev-field">
                <span>dictationToggleHotkey</span>
                <button
                  onClick={(event) => captureHotkey(event, "dictationToggleHotkey")}
                  onContextMenu={(event) => clearHotkey(event, "dictationToggleHotkey")}
                  type="button"
                >
                  {capturingHotkey === "dictationToggleHotkey"
                    ? "capture..."
                    : state.settings.dictationToggleHotkey || "unset"}
                </button>
              </label>
              <label className="dev-field">
                <span>dictationHoldHotkey</span>
                <button
                  onClick={(event) => captureHotkey(event, "dictationHoldHotkey")}
                  onContextMenu={(event) => clearHotkey(event, "dictationHoldHotkey")}
                  type="button"
                >
                  {capturingHotkey === "dictationHoldHotkey"
                    ? "capture..."
                    : state.settings.dictationHoldHotkey || "unset"}
                </button>
              </label>
              <label className="dev-field">
                <span>showWindowHotkey</span>
                <button
                  onClick={(event) => captureHotkey(event, "showWindowHotkey")}
                  onContextMenu={(event) => clearHotkey(event, "showWindowHotkey")}
                  type="button"
                >
                  {capturingHotkey === "showWindowHotkey"
                    ? "capture..."
                    : state.settings.showWindowHotkey || "unset"}
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
                  checked={state.settings.startMinimized}
                  type="checkbox"
                  onChange={(event) => void updateSettings({ startMinimized: event.target.checked })}
                />
                startMinimized
              </label>
              <label className="checkbox-field">
                <input
                  checked={state.settings.developerModeEnabled}
                  type="checkbox"
                  onChange={(event) =>
                    void updateSettings({ developerModeEnabled: event.target.checked })
                  }
                />
                developerModeEnabled
              </label>
              <label className="checkbox-field">
                <input
                  checked={state.settings.suspendDictationHotkeysInFullscreenApps}
                  type="checkbox"
                  onChange={(event) =>
                    void updateSettings({
                      suspendDictationHotkeysInFullscreenApps: event.target.checked
                    })
                  }
                />
                suspendDictationHotkeysInFullscreenApps
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

function appHotkeyEntries(settings: AppSettings | null): Array<{
  id: HotkeyCaptureTarget;
  label: string;
  value: string;
}> {
  if (!settings) {
    return [];
  }

  return [
    {
      id: "dictationToggleHotkey",
      label: "Dictation",
      value: settings.dictationToggleHotkey
    },
    {
      id: "dictationHoldHotkey",
      label: "Hold to dictate",
      value: settings.dictationHoldHotkey
    },
    {
      id: "showWindowHotkey",
      label: "Show VoxType",
      value: settings.showWindowHotkey
    },
    {
      id: "recordingStartHotkey",
      label: "Recording start hotkey",
      value: settings.recordingStartHotkey
    },
    {
      id: "recordingStopHotkey",
      label: "Recording stop hotkey",
      value: settings.recordingStopHotkey
    }
  ].filter((entry) => entry.value.trim());
}

function normalizeHotkey(value: string): string {
  const parts = value
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const key = parts.at(-1) ?? "";
  const modifiers = parts
    .slice(0, -1)
    .map((part) => (part === "ctrl" || part === "control" ? "commandorcontrol" : part))
    .sort();

  return [...modifiers, key].join("+");
}

function WindowTitleBar({ title }: { title: string }): JSX.Element {
  return (
    <div className="window-titlebar">
      <div className="window-titlebar-brand">
        <img alt="" className="window-titlebar-mark" src={voxtypeLogoUrl} />
        <span>{title}</span>
      </div>
      <div className="window-controls">
        <button
          aria-label="Hide window"
          onClick={() => void window.voxtype.window.minimize()}
          title="Hide window"
          type="button"
        >
          <Minus aria-hidden="true" className="release-icon-svg" />
        </button>
        <button
          aria-label="Close"
          className="window-close-button"
          onClick={() => void window.voxtype.window.close()}
          title="Close"
          type="button"
        >
          <X aria-hidden="true" className="release-icon-svg" />
        </button>
      </div>
    </div>
  );
}

function ReleaseIcon({
  name,
  decorative = false
}: {
  name: ReleaseIconName;
  decorative?: boolean;
}): JSX.Element {
  const Icon = releaseIcons[name];

  return (
    <Icon
      aria-hidden={decorative ? "true" : undefined}
      className="release-icon-svg"
      focusable="false"
      role={decorative ? undefined : "img"}
      strokeWidth={1.8}
    />
  );
}

function ReleaseSelect<T extends string>({
  ariaLabel,
  onChange,
  options,
  value
}: {
  ariaLabel: string;
  onChange: (value: T) => void;
  options: Array<SelectOption<T>>;
  value: T;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="release-select" onBlur={() => setOpen(false)}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={open ? "release-select-trigger open" : "release-select-trigger"}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{selectedOption?.label ?? value}</span>
        <ChevronDown aria-hidden="true" className="release-icon-svg" />
      </button>
      {open ? (
        <div className="release-select-menu" role="listbox">
          {options.map((option) => {
            const selected = option.value === value;

            return (
              <button
                aria-selected={selected}
                className={selected ? "selected" : ""}
                key={option.value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                <span>{option.label}</span>
                {option.meta ? <small>{option.meta}</small> : null}
                {selected ? <Check aria-hidden="true" className="release-icon-svg" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ReleaseChip({
  children,
  tone = "neutral"
}: {
  children: ReactNode;
  tone?: "accent" | "neutral" | "success" | "warning";
}): JSX.Element {
  return <span className={`release-chip release-chip-${tone}`}>{children}</span>;
}

function ReleaseStatusBadge({
  children,
  tone
}: {
  children: ReactNode;
  tone: "disabled" | "error" | "processing" | "ready";
}): JSX.Element {
  return (
    <span className={`release-status-badge release-status-badge-${tone}`}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "none";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatRelativeTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay) {
    return `Today, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }

  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatBytes(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "none";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function RecordingOverlay({ state }: { state: RecordingOverlayState }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorGainRef = useRef<GainNode | null>(null);
  const meterHistoryRef = useRef<number[]>([]);
  const meterSampleAtRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const levelRef = useRef(0);
  const clampedLevel = Math.min(Math.max(state.level, 0), 1);

  useEffect(() => {
    if (state.mode !== "recording") {
      meterHistoryRef.current = [];
      meterSampleAtRef.current = 0;
      return;
    }

    const previous = levelRef.current;
    levelRef.current = previous + (clampedLevel - previous) * 0.34;

    if (oscillatorGainRef.current) {
      oscillatorGainRef.current.gain.setTargetAtTime(
        levelRef.current,
        audioContextRef.current?.currentTime ?? 0,
        0.035
      );
    }
  }, [clampedLevel, state.mode]);

  useEffect(() => {
    if (state.mode !== "recording") {
      return undefined;
    }

    const AudioContextCtor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      return undefined;
    }

    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    const oscillator = audioContext.createOscillator();
    const oscillatorGain = audioContext.createGain();
    const muteGain = audioContext.createGain();

    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.78;
    oscillator.frequency.value = 110;
    oscillatorGain.gain.value = 0;
    muteGain.gain.value = 0;

    oscillator.connect(oscillatorGain);
    oscillatorGain.connect(analyser);
    analyser.connect(muteGain);
    muteGain.connect(audioContext.destination);
    oscillator.start();

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    oscillatorGainRef.current = oscillatorGain;

    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      oscillator.stop();
      oscillator.disconnect();
      oscillatorGain.disconnect();
      analyser.disconnect();
      muteGain.disconnect();
      void audioContext.close();
      analyserRef.current = null;
      oscillatorGainRef.current = null;
      audioContextRef.current = null;
    };
  }, [state.mode]);

  useEffect(() => {
    if (state.mode !== "recording") {
      return undefined;
    }

    const canvas = canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return undefined;
    }

    const data = new Uint8Array(512);

    function draw(timestamp = window.performance.now()): void {
      const rect = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * scale));
      const height = Math.max(1, Math.floor(rect.height * scale));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const analyser = analyserRef.current;
      let energy = levelRef.current;

      if (analyser) {
        analyser.getByteTimeDomainData(data);
        let sum = 0;

        for (const value of data) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }

        energy = Math.max(energy, Math.sqrt(sum / data.length) * 1.7);
      }

      const normalized = Math.min(Math.max(energy * 1.75, 0), 1);
      const history = meterHistoryRef.current;
      const barWidth = Math.max(2, Math.round(3 * scale));
      const gap = Math.max(2, Math.round(3 * scale));
      const maxBars = Math.max(1, Math.floor(width / (barWidth + gap)));

      if (timestamp - meterSampleAtRef.current >= 110) {
        history.push(normalized);
        meterHistoryRef.current = history.slice(-maxBars);
        meterSampleAtRef.current = timestamp;
      }

      paintMeter(context, meterHistoryRef.current, width, height, barWidth, gap, scale);
      animationFrameRef.current = window.requestAnimationFrame(draw);
    }

    draw();

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [state.mode]);

  return (
    <main className="recording-overlay">
      {state.mode === "recording" ? (
        <canvas
          ref={canvasRef}
          aria-label="Input gain timeline"
          className="overlay-meter-canvas"
        />
      ) : (
        <div className="overlay-transcribing">Transcribing</div>
      )}
    </main>
  );
}

function paintMeter(
  context: CanvasRenderingContext2D,
  levels: number[],
  width: number,
  height: number,
  barWidth: number,
  gap: number,
  scale: number
): void {
  const baselineHeight = Math.max(2, Math.round(2 * scale));
  const paddingX = Math.round(2 * scale);
  const paddingTop = Math.round(1 * scale);
  const paddingBottom = Math.round(2 * scale);
  const meterHeight = height - paddingTop - paddingBottom;
  const baselineY = height - paddingBottom;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(12, 15, 18, 0.82)";
  context.fillRect(0, 0, width, height);

  const gridColor = "rgba(255, 255, 255, 0.08)";
  context.strokeStyle = gridColor;
  context.lineWidth = Math.max(1, scale);

  for (const threshold of [0.36, 0.7]) {
    const y = baselineY - meterHeight * threshold;
    context.beginPath();
    context.moveTo(paddingX, y);
    context.lineTo(width - paddingX, y);
    context.stroke();
  }

  const totalStep = barWidth + gap;
  const startX = width - paddingX - levels.length * totalStep;

  levels.forEach((level, index) => {
    const x = startX + index * totalStep;
    const quiet = level < 0.018;
    const shaped = Math.pow(level, 0.58);
    const dynamicHeight = quiet ? baselineHeight : Math.max(baselineHeight, meterHeight * shaped);
    const y = baselineY - dynamicHeight;

    context.fillStyle = meterColor(level);
    roundRect(context, x, y, barWidth, dynamicHeight, Math.max(2, barWidth / 2));
    context.fill();
  });
}

function meterColor(level: number): string {
  if (level > 0.78) {
    return "#ff5c5c";
  }

  if (level > 0.46) {
    return "#ffc857";
  }

  return "#32e38f";
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const clampedRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + clampedRadius, y);
  context.lineTo(x + width - clampedRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + clampedRadius);
  context.lineTo(x + width, y + height - clampedRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - clampedRadius, y + height);
  context.lineTo(x + clampedRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - clampedRadius);
  context.lineTo(x, y + clampedRadius);
  context.quadraticCurveTo(x, y, x + clampedRadius, y);
  context.closePath();
}

function joinErrors(primary: string, secondary: string | null): string {
  return secondary ? `${primary} ${secondary}` : primary;
}

function pngBytesToDataUrl(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `data:image/png;base64,${window.btoa(binary)}`;
}

function insertionModeLabel(mode: InsertionMode): string {
  if (mode === "clipboard") {
    return "clipboard paste";
  }

  if (mode === "remoteClipboard") {
    return "remote clipboard paste";
  }

  if (mode === "keyboard") {
    return "Unicode typing";
  }

  if (mode === "windowsMessaging") {
    return "Windows Messaging";
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

function profileWhisperLanguageLabel(language: ProfileWhisperLanguage): string {
  if (language === "inherit") {
    return "inherit language";
  }

  if (language === "auto") {
    return "auto language";
  }

  return language.toUpperCase();
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

async function playRecordingCue(kind: "start" | "stop"): Promise<void> {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextConstructor) {
    return;
  }

  const context = new AudioContextConstructor();
  const frequencies = kind === "start" ? [660, 880] : [880, 660];
  const durationSeconds = 0.075;
  const gapSeconds = 0.025;
  const startedAt = context.currentTime + 0.01;

  for (const [index, frequency] of frequencies.entries()) {
    const start = startedAt + index * (durationSeconds + gapSeconds);
    const end = start + durationSeconds;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end);
  }

  await wait(Math.ceil((frequencies.length * durationSeconds + gapSeconds) * 1000) + 40);
  await context.close();
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }

  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function formatVram(vramMb: number | null | undefined): string {
  if (typeof vramMb !== "number") {
    return "unknown";
  }

  if (vramMb >= 1024) {
    return `${(vramMb / 1024).toFixed(1)} GB`;
  }

  return `${vramMb} MB`;
}

function gpuFitLabel(report: HardwareAccelerationReport | null, modelId: string): string {
  const fit = report?.modelFits.find((item) => item.modelId === modelId);

  if (!fit) {
    return "detect";
  }

  if (fit.status === "fits") {
    return `fits (${formatVram(fit.requiredVramMb)})`;
  }

  if (fit.status === "low-vram") {
    return `low (${formatVram(fit.requiredVramMb)})`;
  }

  return fit.status;
}

function buildWhisperPromptPreview(
  dictionary: DictionaryEntry[],
  processName: string | null,
  ocrTerms: string[]
): string {
  const normalizedProcess = processName?.trim().toLowerCase() || null;
  const dictionaryTerms = dictionary
    .filter(
      (entry) =>
        entry.enabled &&
        (!entry.appProcessName || !normalizedProcess || entry.appProcessName === normalizedProcess)
    )
    .map((entry) => entry.preferred);
  const terms = uniqueTerms([...dictionaryTerms, ...ocrTerms]).slice(0, 160);

  if (terms.length === 0) {
    return "";
  }

  return `Relevant terms: ${terms.join(", ")}. Use these spellings when they are spoken.`;
}

function combineWhisperPromptPreview(generatedPrompt: string, promptOverride: string): string {
  const generated = generatedPrompt.trim();
  const custom = promptOverride.trim();

  if (!generated) {
    return custom;
  }

  if (!custom) {
    return generated;
  }

  if (custom.includes(generated)) {
    return custom;
  }

  return `${generated} ${custom}`;
}

function uniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const term of terms) {
    if (typeof term !== "string") {
      continue;
    }

    const normalized = term.trim();
    const key = normalized.toLowerCase();

    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(normalized);
  }

  return unique;
}
