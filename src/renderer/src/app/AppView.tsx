/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { eventToAccelerator } from "../hotkey-capture";
import { type PcmRecorder, type PcmRecordingResult } from "../audio-recorder";
import { type OcrPromptContext } from "../../../shared/ocr-context";
import { type OcrResult } from "../../../shared/ocr";
import { type UpdateStatus } from "../../../shared/updates";
import {
  type ActiveWindowInfo,
  type RecordingOverlayState,
  type ScreenshotCaptureMode,
  type ScreenshotCaptureResult
} from "../../../shared/windows-helper";
import { RecordingOverlay, WindowTitleBar } from "./app-helpers";
import { ReleaseView } from "./ReleaseView";
import { DebugView } from "./DebugView";
import { type HotkeyCaptureTarget } from "./app-helpers";
import { deriveAppState } from "./app-derived-state";
import { defaultOverlayState, type AppState } from "./app-state";
import { type DebugTab, type ReleaseModelFilter, type ReleaseTab } from "./app-options";
import { useSettingsActions } from "./settings-actions";
import { useRecordingActions } from "./recording-actions";
import { useProfileDictionaryActions } from "./profile-dictionary-actions";
import { type AppViewProps, type ReadyAppViewProps, type RecordingActions } from "./app-types";

const updateCheckingWatchdogMs = 20000;

export function ConnectedAppView(): ReactElement {
  const isOverlay = new URLSearchParams(window.location.search).get("overlay") === "1";
  const recorderRef = useRef<PcmRecorder | null>(null);
  const recordingActionsRef = useRef<Partial<RecordingActions>>({});
  const hotkeyTargetRef = useRef<ActiveWindowInfo | null>(null);
  const hotkeyOcrContextRef = useRef<OcrPromptContext | null>(null);
  const hotkeySessionIdRef = useRef<number | null>(null);
  const systemAudioMutedByVoxTypeRef = useRef(false);
  const recordingStopHotkeyRef = useRef<string | null>(null);
  const cloudSessionLimitTimerRef = useRef<number | null>(null);
  const cloudSessionWarnedRef = useRef(false);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const modelDeleteTimerRef = useRef<number | null>(null);
  const profileDeleteTimerRef = useRef<number | null>(null);
  const [version, setVersion] = useState("0.1.0");
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
    inputDevices: [],
    activeWindow: null,
    hotkeys: null,
    openaiCredentials: null,
    sherpaModels: [],
    sherpaRuntimes: []
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
  const [openAiApiKeyDraft, setOpenAiApiKeyDraft] = useState("");
  const [lastRecordingResult, setLastRecordingResult] = useState<PcmRecordingResult | null>(null);
  const [screenshotMode, setScreenshotMode] = useState<ScreenshotCaptureMode>("activeWindow");
  const [latestScreenshot, setLatestScreenshot] = useState<ScreenshotCaptureResult | null>(null);
  const [latestOcrResult, setLatestOcrResult] = useState<OcrResult | null>(null);
  const [latestOcrContext, setLatestOcrContext] = useState<OcrPromptContext | null>(null);
  const [playingTranscriptId, setPlayingTranscriptId] = useState<string | null>(null);
  const [retranscribingTranscriptId, setRetranscribingTranscriptId] = useState<string | null>(null);
  const [releaseTab, setReleaseTab] = useState<ReleaseTab>("general");
  const [releaseModelFilter, setReleaseModelFilter] = useState<ReleaseModelFilter>("all");
  const [activeTab, setActiveTab] = useState<DebugTab>("dictation");
  const [confirmingDeleteModelId, setConfirmingDeleteModelId] = useState<string | null>(null);
  const [confirmingDeleteProfileProcessName, setConfirmingDeleteProfileProcessName] = useState<
    string | null
  >(null);
  const [capturingProfileHotkey, setCapturingProfileHotkey] = useState<string | null>(null);
  const [releaseTooltip, setReleaseTooltip] = useState<{ text: string; x: number; y: number } | null>(
    null
  );
  const [selectedProfileProcessName, setSelectedProfileProcessName] = useState<string | null>(null);
  const [overlayState, setOverlayState] = useState<RecordingOverlayState>(defaultOverlayState);
  const derivedState = deriveAppState({
    busyMessage,
    error,
    insertionTarget,
    isDeveloperBuild,
    latestOcrContext,
    manualUpdateCooldownSeconds,
    recording,
    releaseModelFilter,
    selectedProfileProcessName,
    state,
    updateStatus
  });
  const baseActionContext = {
    ...derivedState,
    audioElementRef,
    audioObjectUrlRef,
    cloudSessionLimitTimerRef,
    cloudSessionWarnedRef,
    confirmingDeleteModelId,
    confirmingDeleteProfileProcessName,
    capturingProfileHotkey,
    dictionaryAppProcess,
    dictionaryCategory,
    dictionaryMatches,
    dictionaryPreferred,
    editingDictionaryEntryId,
    fixLastText,
    hotkeyOcrContextRef,
    hotkeySessionIdRef,
    hotkeyTargetRef,
    insertionTarget,
    insertionTestText,
    isDeveloperBuild,
    latestOcrContext,
    latestOcrResult,
    latestScreenshot,
    manualUpdateCooldownSeconds,
    modelDeleteTimerRef,
    openAiApiKeyDraft,
    playingTranscriptId,
    profileDeleteTimerRef,
    recorderRef,
    recording,
    recordingActionsRef,
    recordingStopHotkeyRef,
    releaseModelFilter,
    screenshotMode,
    selectedProfileProcessName,
    state,
    systemAudioMutedByVoxTypeRef,
    updateStatus,
    setActiveTab,
    setBusyMessage,
    setCapturingHotkey,
    setCapturingProfileHotkey,
    setConfirmingDeleteModelId,
    setConfirmingDeleteProfileProcessName,
    setDictionaryAppProcess,
    setDictionaryCategory,
    setDictionaryMatches,
    setDictionaryModalOpen,
    setDictionaryPreferred,
    setEditingDictionaryEntryId,
    setError,
    setFixLastText,
    setInsertionTarget,
    setInsertionTestResult,
    setIsDeveloperBuild,
    setLastRecordingResult,
    setLatestOcrContext,
    setLatestOcrResult,
    setLatestScreenshot,
    setManualUpdateCooldownSeconds,
    setOpenAiApiKeyDraft,
    setOverlayState,
    setPlayingTranscriptId,
    setRecording,
    setReleaseModelFilter,
    setReleaseTab,
    setRetranscribingTranscriptId,
    setScreenshotMode,
    setSelectedProfileProcessName,
    setState,
    setUpdateStatus,
    setVersion
  };
  const settingsActions = useSettingsActions(baseActionContext);
  const recordingActions = useRecordingActions({ ...baseActionContext, ...settingsActions });
  const profileDictionaryActions = useProfileDictionaryActions({
    ...baseActionContext,
    ...settingsActions,
    ...recordingActions
  });
  const actions = { ...settingsActions, ...recordingActions, ...profileDictionaryActions };

  useEffect(() => {
    recordingActionsRef.current = recordingActions;
  }, [recordingActions]);

  useEffect(() => {
    if (isOverlay) {
      void window.voxtype.recordingOverlay.getState().then(setOverlayState);
      return window.voxtype.recordingOverlay.onState(setOverlayState);
    }

    void settingsActions.refresh();

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

      settingsActions.clearCloudSessionLimitTimer();

      if (profileDeleteTimerRef.current !== null) {
        window.clearTimeout(profileDeleteTimerRef.current);
      }
    };
  }, [isOverlay]);

  useEffect(() => {
    if (isOverlay) {
      return;
    }

    const removeStart = window.voxtype.dictation.onHotkeyStart((payload) => {
      void recordingActions.handleHotkeyStart(payload);
    });
    const removeStop = window.voxtype.dictation.onHotkeyStop((payload) => {
      void recordingActions.handleHotkeyStop(payload);
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
        void recordingActions.handleHotkeyStart({
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
  }, [derivedState.activeModel?.status, state.settings?.insertionMode, recording, isOverlay]);

  useEffect(() => {
    if (isOverlay) {
      return;
    }

    const removeUpdateStatusListener = window.voxtype.updates.onStatus((status) => {
      setUpdateStatus(status);
    });
    void window.voxtype.updates.status().then(setUpdateStatus);

    return removeUpdateStatusListener;
  }, [isOverlay]);

  useEffect(() => {
    if (isOverlay || updateStatus?.state !== "checking") {
      return;
    }

    let elapsedMs = 0;
    const timer = window.setInterval(() => {
      elapsedMs += 1000;
      void window.voxtype.updates.status().then((status) => {
        setUpdateStatus(
          status.state === "checking" && elapsedMs >= updateCheckingWatchdogMs
            ? {
                ...status,
                available: false,
                state: "error",
                error: "Update check timed out."
              }
            : status
        );
      });
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isOverlay, updateStatus?.state]);

  useEffect(() => {
    if (isOverlay || (!capturingHotkey && !capturingProfileHotkey)) {
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
    if (isOverlay || (!capturingHotkey && !capturingProfileHotkey)) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setCapturingHotkey(null);
        if (capturingProfileHotkey) {
          void profileDictionaryActions.updateProfileHotkey(capturingProfileHotkey, "");
        }
        setCapturingProfileHotkey(null);
        return;
      }

      const accelerator = eventToAccelerator(event);

      if (!accelerator) {
        return;
      }

      if (capturingProfileHotkey) {
        const duplicate = settingsActions.findDuplicateHotkey(
          accelerator,
          `profile:${capturingProfileHotkey}`
        );

        if (duplicate) {
          setError(`${accelerator} is already assigned to ${duplicate}.`);
          return;
        }

        setError(null);
        void profileDictionaryActions.updateProfileHotkey(capturingProfileHotkey, accelerator);
        setCapturingProfileHotkey(null);
        return;
      }

      if (capturingHotkey) {
        const duplicate = settingsActions.findDuplicateHotkey(accelerator, capturingHotkey);

        if (duplicate) {
          setError(`${accelerator} is already assigned to ${duplicate}.`);
          return;
        }

        setError(null);
        void settingsActions.updateSettings({ [capturingHotkey]: accelerator });
        setCapturingHotkey(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [capturingHotkey, capturingProfileHotkey, state.settings]);

  const visibleReleaseTab =
    releaseTab === "cloud" && state.settings?.offlineMode ? "settings" : releaseTab;
  const appViewProps = {
    ...baseActionContext,
    ...actions,
    activeTab,
    busyMessage,
    capturingHotkey,
    dictionaryModalOpen,
    error,
    insertionTestResult,
    isOverlay,
    lastRecordingResult,
    overlayState,
    releaseTab: visibleReleaseTab,
    releaseTooltip,
    retranscribingTranscriptId,
    setInsertionTestText,
    setReleaseTooltip,
    version
  } satisfies AppViewProps;

  return <AppView {...appViewProps} />;
}

export function AppView(props: AppViewProps): ReactElement {
  const { isDeveloperBuild, isOverlay, overlayState, state } = props;
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

  const readyProps = props as ReadyAppViewProps;

  if (!state.settings.debugViewEnabled || !isDeveloperBuild) {
    return <ReleaseView {...readyProps} />;
  }

  return <DebugView {...readyProps} />;
}
