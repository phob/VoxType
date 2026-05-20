import { useEffect, useRef, useState, type ReactElement } from "react";
/* eslint-disable react-hooks/exhaustive-deps */
import { type PcmRecorder, type PcmRecordingResult } from "./audio-recorder";
import { eventToAccelerator } from "./hotkey-capture";
import { type OcrPromptContext } from "../../shared/ocr-context";
import { type OcrResult } from "../../shared/ocr";
import { type UpdateStatus } from "../../shared/updates";
import {
  type ActiveWindowInfo,
  type RecordingOverlayState,
  type ScreenshotCaptureMode,
  type ScreenshotCaptureResult
} from "../../shared/windows-helper";
import { AppView } from "./app/AppView";
import { type HotkeyCaptureTarget } from "./app/app-helpers";
import { deriveAppState } from "./app/app-derived-state";
import { defaultOverlayState, type AppState } from "./app/app-state";
import { type DevTab, type ReleaseModelFilter, type ReleaseTab } from "./app/app-options";
import { useSettingsActions } from "./app/settings-actions";
import { useRecordingActions } from "./app/recording-actions";
import { useProfileDictionaryActions } from "./app/profile-dictionary-actions";
import { type RecordingActions } from "./app/app-types";

const updateCheckingWatchdogMs = 20000;

export function App(): ReactElement {
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
    inputDevices: [],
    activeWindow: null,
    hotkeys: null,
    openaiCredentials: null
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
  const [activeTab, setActiveTab] = useState<DevTab>("dictation");
  const [confirmingDeleteModelId, setConfirmingDeleteModelId] = useState<string | null>(null);
  const [confirmingDeleteProfileProcessName, setConfirmingDeleteProfileProcessName] = useState<
    string | null
  >(null);
  const [capturingProfileHotkey, setCapturingProfileHotkey] = useState<string | null>(null);
  const [releaseTooltip, setReleaseTooltip] = useState<{ text: string; x: number; y: number } | null>(
    null
  );
  const [selectedProfileProcessName, setSelectedProfileProcessName] = useState<string | null>(
    null
  );
  const [overlayState, setOverlayState] = useState<RecordingOverlayState>(defaultOverlayState);

  const {
    activeDictationMode,
    activeModeIsCloud,
    activeModel,
    activeProviderLabel,
    activeProviderLanguageHint,
    activeRuntimeLabel,
    appStatus,
    cloudAudioHistoryDetail,
    cloudModeGateLabel,
    cloudModeSelectionReady,
    cloudSetupDetail,
    cloudSetupReady,
    currentProfileProcessName,
    currentTarget,
    developerCloudModePreviewEnabled,
    effectiveWhisperPrompt,
    generatedWhisperPrompt,
    hotkeyReady,
    latestTranscript,
    modelReady,
    normalizedCloudSessionMaxMinutes,
    openAiModesReadyForRelease,
    readinessDetail,
    readinessTitle,
    readyToDictate,
    realtimeModeSelectionReady,
    realtimeStreamingReady,
    releaseModels,
    runtimeReady,
    savedDictionaryTerms,
    selectedProfile,
    setupSteps,
    updateButtonDisabled,
    updateButtonLabel
  } = deriveAppState({
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
    activeDictationMode, activeModeIsCloud, audioElementRef, audioObjectUrlRef, cloudSessionLimitTimerRef, cloudSessionWarnedRef, confirmingDeleteModelId, currentTarget, dictionaryAppProcess, dictionaryCategory, dictionaryMatches, dictionaryPreferred, editingDictionaryEntryId, effectiveWhisperPrompt, fixLastText, generatedWhisperPrompt, hotkeyOcrContextRef, hotkeySessionIdRef, hotkeyTargetRef, insertionTarget, insertionTestText, isDeveloperBuild, latestOcrContext, latestOcrResult, latestScreenshot, latestTranscript, manualUpdateCooldownSeconds, modelDeleteTimerRef, normalizedCloudSessionMaxMinutes, openAiApiKeyDraft, profileDeleteTimerRef, recorderRef, recording, recordingActionsRef, recordingStopHotkeyRef, releaseModelFilter, screenshotMode, selectedProfileProcessName, state, systemAudioMutedByVoxTypeRef, updateStatus,
    setBusyMessage, setCapturingHotkey, setCapturingProfileHotkey, setConfirmingDeleteModelId, setConfirmingDeleteProfileProcessName, setDictionaryAppProcess, setDictionaryCategory, setDictionaryMatches, setDictionaryModalOpen, setDictionaryPreferred, setEditingDictionaryEntryId, setError, setFixLastText, setInsertionTarget, setInsertionTestResult, setIsDeveloperBuild, setLastRecordingResult, setLatestOcrContext, setLatestOcrResult, setLatestScreenshot, setManualUpdateCooldownSeconds, setOpenAiApiKeyDraft, setOverlayState, setPlayingTranscriptId, setRecording, setReleaseModelFilter, setReleaseTab, setRetranscribingTranscriptId, setSelectedProfileProcessName, setState, setUpdateStatus, setVersion
  };
  const settingsActions = useSettingsActions(baseActionContext);
  const recordingActions = useRecordingActions({ ...baseActionContext, ...settingsActions });
  const profileDictionaryActions = useProfileDictionaryActions({
    ...baseActionContext,
    ...settingsActions,
    ...recordingActions
  });
  const actions = { ...settingsActions, ...recordingActions, ...profileDictionaryActions };
  const {
    refresh, exactLocalModelSettingsPatch, dictationModeSettingsPatch, updateSettings, saveOpenAiApiKey, clearOpenAiApiKey, previewCloudPromptPack, testOpenAiConnection, clearCloudSessionLimitTimer, startCloudSessionLimitTimer, terminateActiveCloudDictationForOfflineMode, captureHotkey, clearHotkey, findDuplicateHotkey, checkForUpdates, installUpdate, handleUpdateButtonClick, installRuntime, downloadModel, deleteModel, startRecording, installSpecificRuntime, setupFirstRunCuda, refreshHardware, handleHotkeyStart, handleHotkeyStop, stopAndTranscribe, startRecordingCoordination, stopRecordingCoordination, unmuteSystemAudio, copyLatestTranscript, pasteLatestTranscript, insertTranscript, copyTranscript, cleanupHistory, transcribeSavedTranscript, transcribeLatestTranscript, refreshActiveWindow, addCurrentAppProfile, captureScreenshot, recognizeLatestScreenshot, captureInsertionTarget, applyDetectedAppAsInsertionTarget, runInsertionTest, updateAppProfile, removeAppProfile, closeProfileModal, updateProfileHotkey, sendProfilePostTranscriptionHotkey, clearDictionaryForm, selectDictionaryEntry, openNewDictionaryModal, openEditDictionaryModal, closeDictionaryModal, saveDictionaryEntryFromModal, saveDictionaryEntry, toggleDictionaryEntry, removeDictionaryEntry, learnFixLastDictation, saveOcrTerm, copyOcrRawText, copyOcrTerms, playTranscriptAudio, stopTranscriptAudio
  } = actions;
  useEffect(() => {
    recordingActionsRef.current = recordingActions;
  }, [recordingActions]);
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

      clearCloudSessionLimitTimer();

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

  const visibleReleaseTab = releaseTab === "cloud" && state.settings?.offlineMode ? "settings" : releaseTab;

  return <AppView activeDictationMode={activeDictationMode} activeModeIsCloud={activeModeIsCloud} activeModel={activeModel} activeProviderLabel={activeProviderLabel} activeProviderLanguageHint={activeProviderLanguageHint} activeRuntimeLabel={activeRuntimeLabel} activeTab={activeTab} addCurrentAppProfile={addCurrentAppProfile} appStatus={appStatus} applyDetectedAppAsInsertionTarget={applyDetectedAppAsInsertionTarget} audioElementRef={audioElementRef} audioObjectUrlRef={audioObjectUrlRef} busyMessage={busyMessage} captureHotkey={captureHotkey} captureInsertionTarget={captureInsertionTarget} captureScreenshot={captureScreenshot} capturingHotkey={capturingHotkey} capturingProfileHotkey={capturingProfileHotkey} checkForUpdates={checkForUpdates} cleanupHistory={cleanupHistory} clearCloudSessionLimitTimer={clearCloudSessionLimitTimer} clearDictionaryForm={clearDictionaryForm} clearHotkey={clearHotkey} clearOpenAiApiKey={clearOpenAiApiKey} closeDictionaryModal={closeDictionaryModal} closeProfileModal={closeProfileModal} cloudAudioHistoryDetail={cloudAudioHistoryDetail} cloudModeGateLabel={cloudModeGateLabel} cloudModeSelectionReady={cloudModeSelectionReady} cloudSessionLimitTimerRef={cloudSessionLimitTimerRef} cloudSessionWarnedRef={cloudSessionWarnedRef} cloudSetupDetail={cloudSetupDetail} cloudSetupReady={cloudSetupReady} confirmingDeleteModelId={confirmingDeleteModelId} confirmingDeleteProfileProcessName={confirmingDeleteProfileProcessName} copyLatestTranscript={copyLatestTranscript} copyOcrRawText={copyOcrRawText} copyOcrTerms={copyOcrTerms} copyTranscript={copyTranscript} currentProfileProcessName={currentProfileProcessName} currentTarget={currentTarget} deleteModel={deleteModel} developerCloudModePreviewEnabled={developerCloudModePreviewEnabled} dictationModeSettingsPatch={dictationModeSettingsPatch} dictionaryAppProcess={dictionaryAppProcess} dictionaryCategory={dictionaryCategory} dictionaryMatches={dictionaryMatches} dictionaryModalOpen={dictionaryModalOpen} dictionaryPreferred={dictionaryPreferred} downloadModel={downloadModel} editingDictionaryEntryId={editingDictionaryEntryId} effectiveWhisperPrompt={effectiveWhisperPrompt} error={error} exactLocalModelSettingsPatch={exactLocalModelSettingsPatch} findDuplicateHotkey={findDuplicateHotkey} fixLastText={fixLastText} generatedWhisperPrompt={generatedWhisperPrompt} handleHotkeyStart={handleHotkeyStart} handleHotkeyStop={handleHotkeyStop} handleUpdateButtonClick={handleUpdateButtonClick} hotkeyOcrContextRef={hotkeyOcrContextRef} hotkeyReady={hotkeyReady} hotkeySessionIdRef={hotkeySessionIdRef} hotkeyTargetRef={hotkeyTargetRef} insertionTarget={insertionTarget} insertionTestResult={insertionTestResult} insertionTestText={insertionTestText} insertTranscript={insertTranscript} installRuntime={installRuntime} installSpecificRuntime={installSpecificRuntime} installUpdate={installUpdate} isDeveloperBuild={isDeveloperBuild} isOverlay={isOverlay} lastRecordingResult={lastRecordingResult} latestOcrContext={latestOcrContext} latestOcrResult={latestOcrResult} latestScreenshot={latestScreenshot} latestTranscript={latestTranscript} learnFixLastDictation={learnFixLastDictation} manualUpdateCooldownSeconds={manualUpdateCooldownSeconds} modelDeleteTimerRef={modelDeleteTimerRef} modelReady={modelReady} normalizedCloudSessionMaxMinutes={normalizedCloudSessionMaxMinutes} openAiApiKeyDraft={openAiApiKeyDraft} openAiModesReadyForRelease={openAiModesReadyForRelease} openEditDictionaryModal={openEditDictionaryModal} openNewDictionaryModal={openNewDictionaryModal} overlayState={overlayState} pasteLatestTranscript={pasteLatestTranscript} playingTranscriptId={playingTranscriptId} playTranscriptAudio={playTranscriptAudio} previewCloudPromptPack={previewCloudPromptPack} profileDeleteTimerRef={profileDeleteTimerRef} readinessDetail={readinessDetail} readinessTitle={readinessTitle} readyToDictate={readyToDictate} realtimeModeSelectionReady={realtimeModeSelectionReady} realtimeStreamingReady={realtimeStreamingReady} recognizeLatestScreenshot={recognizeLatestScreenshot} recorderRef={recorderRef} recording={recording} recordingActionsRef={recordingActionsRef} recordingStopHotkeyRef={recordingStopHotkeyRef} refresh={refresh} refreshActiveWindow={refreshActiveWindow} refreshHardware={refreshHardware} releaseModelFilter={releaseModelFilter} releaseModels={releaseModels} releaseTab={visibleReleaseTab} releaseTooltip={releaseTooltip} removeAppProfile={removeAppProfile} removeDictionaryEntry={removeDictionaryEntry} retranscribingTranscriptId={retranscribingTranscriptId} runInsertionTest={runInsertionTest} runtimeReady={runtimeReady} savedDictionaryTerms={savedDictionaryTerms} saveDictionaryEntry={saveDictionaryEntry} saveDictionaryEntryFromModal={saveDictionaryEntryFromModal} saveOcrTerm={saveOcrTerm} saveOpenAiApiKey={saveOpenAiApiKey} screenshotMode={screenshotMode} selectDictionaryEntry={selectDictionaryEntry} selectedProfile={selectedProfile} selectedProfileProcessName={selectedProfileProcessName} sendProfilePostTranscriptionHotkey={sendProfilePostTranscriptionHotkey} setActiveTab={setActiveTab} setBusyMessage={setBusyMessage} setCapturingHotkey={setCapturingHotkey} setCapturingProfileHotkey={setCapturingProfileHotkey} setConfirmingDeleteModelId={setConfirmingDeleteModelId} setConfirmingDeleteProfileProcessName={setConfirmingDeleteProfileProcessName} setDictionaryAppProcess={setDictionaryAppProcess} setDictionaryCategory={setDictionaryCategory} setDictionaryMatches={setDictionaryMatches} setDictionaryModalOpen={setDictionaryModalOpen} setDictionaryPreferred={setDictionaryPreferred} setEditingDictionaryEntryId={setEditingDictionaryEntryId} setError={setError} setFixLastText={setFixLastText} setInsertionTarget={setInsertionTarget} setInsertionTestResult={setInsertionTestResult} setInsertionTestText={setInsertionTestText} setIsDeveloperBuild={setIsDeveloperBuild} setLastRecordingResult={setLastRecordingResult} setLatestOcrContext={setLatestOcrContext} setLatestOcrResult={setLatestOcrResult} setLatestScreenshot={setLatestScreenshot} setManualUpdateCooldownSeconds={setManualUpdateCooldownSeconds} setOpenAiApiKeyDraft={setOpenAiApiKeyDraft} setOverlayState={setOverlayState} setPlayingTranscriptId={setPlayingTranscriptId} setRecording={setRecording} setReleaseModelFilter={setReleaseModelFilter} setReleaseTab={setReleaseTab} setReleaseTooltip={setReleaseTooltip} setRetranscribingTranscriptId={setRetranscribingTranscriptId} setScreenshotMode={setScreenshotMode} setSelectedProfileProcessName={setSelectedProfileProcessName} setState={setState} setUpdateStatus={setUpdateStatus} setupFirstRunCuda={setupFirstRunCuda} setupSteps={setupSteps} setVersion={setVersion} startCloudSessionLimitTimer={startCloudSessionLimitTimer} startRecording={startRecording} startRecordingCoordination={startRecordingCoordination} state={state} stopAndTranscribe={stopAndTranscribe} stopRecordingCoordination={stopRecordingCoordination} stopTranscriptAudio={stopTranscriptAudio} systemAudioMutedByVoxTypeRef={systemAudioMutedByVoxTypeRef} terminateActiveCloudDictationForOfflineMode={terminateActiveCloudDictationForOfflineMode} testOpenAiConnection={testOpenAiConnection} toggleDictionaryEntry={toggleDictionaryEntry} transcribeLatestTranscript={transcribeLatestTranscript} transcribeSavedTranscript={transcribeSavedTranscript} unmuteSystemAudio={unmuteSystemAudio} updateAppProfile={updateAppProfile} updateButtonDisabled={updateButtonDisabled} updateButtonLabel={updateButtonLabel} updateProfileHotkey={updateProfileHotkey} updateSettings={updateSettings} updateStatus={updateStatus} version={version} />;
}

