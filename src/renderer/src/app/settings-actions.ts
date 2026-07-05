import { type MouseEvent } from "react";
import { getCloudSessionLimitState } from "../../../shared/cloud-session-limits";
import { dictationModes, isCloudDictationMode, type DictationModeId } from "../../../shared/asr";
import { resolveCloudPromptPackOcrPolicy } from "../../../shared/cloud-prompt-pack-settings";
import { type AppProfile, type AppSettings } from "../../../shared/settings";
import {
  formatError,
  formatElapsedCloudSession,
  appHotkeyEntries,
  type HotkeyCaptureTarget,
  normalizeHotkey
} from "./app-helpers";
import { type AppState } from "./app-state";
import { type BaseActionContext, type SettingsActions } from "./app-types";

const manualUpdateCheckCooldownSeconds = 30;

export function useSettingsActions(ctx: BaseActionContext): SettingsActions {
  const { activeModeIsCloud, cloudSessionLimitTimerRef, cloudSessionWarnedRef, confirmingDeleteModelId, hotkeyOcrContextRef, hotkeyTargetRef, latestOcrContext, manualUpdateCooldownSeconds, modelDeleteTimerRef, openAiApiKeyDraft, recorderRef, recording, recordingActionsRef, state, updateStatus, setBusyMessage, setCapturingHotkey, setConfirmingDeleteModelId, setError, setInsertionTestResult, setIsDeveloperBuild, setManualUpdateCooldownSeconds, setOpenAiApiKeyDraft, setRecording, setState, setUpdateStatus, setVersion } = ctx;

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
      inputDevices,
      hotkeys,
      openaiCredentials,
      sherpaModels,
      sherpaRuntimes
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
      window.voxtype.windowsHelper.inputDevices().catch(() => []),
      window.voxtype.hotkeys.status(),
      window.voxtype.openaiCredentials.getStatus(),
      window.voxtype.sherpaModels.list(),
      window.voxtype.sherpaRuntime.list()
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
      inputDevices,
      activeWindow: null,
      hotkeys,
      openaiCredentials,
      sherpaModels,
      sherpaRuntimes
    });
  }

  function exactLocalModelSettingsPatch(modelId: string): Partial<AppSettings> {
    return {
      activeModelId: modelId,
      localCustomModelId: modelId,
      dictationModeId: "local.custom"
    };
  }

  function dictationModeSettingsPatch(modeId: DictationModeId): Partial<AppSettings> {
    const mode = dictationModes.find((item) => item.id === modeId);

    if (mode?.providerId !== "local-whisper") {
      return { dictationModeId: modeId };
    }

    if (mode.id === "local.custom") {
      return { dictationModeId: modeId };
    }

    return { dictationModeId: modeId, activeModelId: mode.modelId };
  }

  async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
    setState((current: AppState) => ({
      ...current,
      settings: current.settings ? { ...current.settings, ...patch } : current.settings
    }));
    setState((current: AppState) => current);
    const settings = await window.voxtype.settings.update(patch);

    if (patch.offlineMode === true && recording && activeModeIsCloud) {
      await terminateActiveCloudDictationForOfflineMode();
    }

    const [models, hotkeys, sherpaModels, sherpaRuntimes] = await Promise.all([
      window.voxtype.models.list(),
      window.voxtype.hotkeys.status(),
      window.voxtype.sherpaModels.list(),
      window.voxtype.sherpaRuntime.list()
    ]);
    setState((current: AppState) => ({
      ...current,
      settings,
      models,
      hotkeys,
      sherpaModels,
      sherpaRuntimes
    }));
  }

  async function saveOpenAiApiKey(): Promise<void> {
    if (!openAiApiKeyDraft.trim()) {
      setError("Enter an OpenAI API key before saving.");
      return;
    }

    const openaiCredentials = await window.voxtype.openaiCredentials.setApiKey(openAiApiKeyDraft);
    setOpenAiApiKeyDraft("");
    setState((current: AppState) => ({ ...current, openaiCredentials }));
  }

  async function clearOpenAiApiKey(): Promise<void> {
    const openaiCredentials = await window.voxtype.openaiCredentials.clearApiKey();
    setState((current: AppState) => ({ ...current, openaiCredentials }));
  }

  async function previewCloudPromptPack(): Promise<void> {
    const activeProfile = state.settings
      ? state.settings.appProfiles.find((profile: AppProfile) => profile.processName === state.activeWindow?.processName) ?? null
      : null;
    const ocrPolicy = state.settings
      ? resolveCloudPromptPackOcrPolicy(state.settings, activeProfile)
      : { enabled: false, source: "global" as const };
    const promptPack = await window.voxtype.transcription.previewPromptPack({
      processName: state.activeWindow?.processName,
      ocrContext: ocrPolicy.enabled ? latestOcrContext : null
    });
    setInsertionTestResult(
      promptPack
        ? `Cloud Prompt Pack preview (${String(promptPack.terms.length)}/${String(promptPack.termLimit)} terms, ${String(promptPack.text.length)}/${String(promptPack.characterLimit)} chars, ${promptPack.source}${promptPack.truncated ? ", truncated" : ""}, OCR ${ocrPolicy.enabled ? "allowed" : "blocked"} by ${ocrPolicy.source}). Screenshots, transcript history, full Dictionary, and insertion target contents are not included: ${promptPack.text}`
        : `Cloud Prompt Pack preview is empty for the current app. OCR ${ocrPolicy.enabled ? "allowed" : "blocked"} by ${ocrPolicy.source}. Screenshots, transcript history, full Dictionary, and insertion target contents are not included.`
    );
  }

  async function testOpenAiConnection(): Promise<void> {
    setBusyMessage("Testing OpenAI connection...");

    try {
      const result = await window.voxtype.openaiCredentials.testConnection();
      setInsertionTestResult(result.message);
      setError(result.ok ? null : result.message);
    } catch (testError) {
      setError(formatError(testError));
    } finally {
      setBusyMessage(null);
    }
  }

  function clearCloudSessionLimitTimer(): void {
    if (cloudSessionLimitTimerRef.current !== null) {
      window.clearInterval(cloudSessionLimitTimerRef.current);
      cloudSessionLimitTimerRef.current = null;
    }

    cloudSessionWarnedRef.current = false;
  }

  function startCloudSessionLimitTimer(settings: AppSettings, modeId: DictationModeId): void {
    clearCloudSessionLimitTimer();

    if (!isCloudDictationMode(modeId)) {
      return;
    }

    const startedAtMs = Date.now();
    cloudSessionLimitTimerRef.current = window.setInterval(() => {
      const limit = getCloudSessionLimitState({
        settings,
        modeId,
        startedAtMs,
        nowMs: Date.now()
      });

      void window.voxtype.recordingOverlay.showRecording({
        cloudProviderLabel: "Cloud Dictation",
        elapsedMs: limit.elapsedMs,
        message: formatElapsedCloudSession(limit.elapsedMs)
      });

      if (limit.shouldStop) {
        clearCloudSessionLimitTimer();
        setError(limit.warningMessage ?? "Cloud Dictation reached the maximum session duration.");
        void recordingActionsRef.current.stopAndTranscribe?.({
          pasteTarget: hotkeyTargetRef.current,
          ocrContext: hotkeyOcrContextRef.current
        });
        return;
      }

      if (limit.shouldWarn && !cloudSessionWarnedRef.current) {
        cloudSessionWarnedRef.current = true;
        setBusyMessage(limit.warningMessage);
      }
    }, 1000);
  }

  async function terminateActiveCloudDictationForOfflineMode(): Promise<void> {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    clearCloudSessionLimitTimer();
    setRecording(false);
    await window.voxtype.recordingOverlay.hide();
    await window.voxtype.dictation.setHotkeyRecording(false);

    if (recorder) {
      await recorder.stop().catch(() => undefined);
    }

    await window.voxtype.transcription.cancelRealtime("Realtime Cloud Dictation stopped because Offline Mode was enabled.").catch(() => undefined);
    await recordingActionsRef.current.stopRecordingCoordination?.();
    await recordingActionsRef.current.unmuteSystemAudio?.();
    setError("Cloud Dictation stopped because Offline Mode was enabled.");
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
    setCapturingHotkey((current: HotkeyCaptureTarget | null) =>
      current === target ? null : current
    );
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
      const sharedDictationKeys =
        (target === "dictationToggleHotkey" && entry.id === "dictationHoldHotkey") ||
        (target === "dictationHoldHotkey" && entry.id === "dictationToggleHotkey");

      if (sharedDictationKeys) {
        continue;
      }

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
        current === null
          ? null
          : { ...current, state: "error", error: formatError(updateError), available: false }
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
      setState((current: AppState) => ({ ...current, runtime, runtimes }));
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
      setState((current: AppState) => ({ ...current, models, settings }));
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
        setConfirmingDeleteModelId((current: string | null) => (current === modelId ? null : current));
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
      setState((current: AppState) => ({ ...current, models, settings }));
      setConfirmingDeleteModelId(null);
    } catch (deleteError) {
      setError(formatError(deleteError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function downloadParakeetModel(modelId: string): Promise<void> {
    setError(null);
    setBusyMessage("Downloading Parakeet model...");

    try {
      const sherpaModels = await window.voxtype.sherpaModels.download(modelId);
      setState((current: AppState) => ({ ...current, sherpaModels }));
    } catch (downloadError) {
      setError(formatError(downloadError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function deleteParakeetModel(modelId: string): Promise<void> {
    if (confirmingDeleteModelId !== modelId) {
      setConfirmingDeleteModelId(modelId);

      if (modelDeleteTimerRef.current !== null) {
        window.clearTimeout(modelDeleteTimerRef.current);
      }

      modelDeleteTimerRef.current = window.setTimeout(() => {
        setConfirmingDeleteModelId((current: string | null) => (current === modelId ? null : current));
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
      const sherpaModels = await window.voxtype.sherpaModels.delete(modelId);
      setState((current: AppState) => ({ ...current, sherpaModels }));
      setConfirmingDeleteModelId(null);
    } catch (deleteError) {
      setError(formatError(deleteError));
    } finally {
      setBusyMessage(null);
    }
  }


  return {
refresh, exactLocalModelSettingsPatch, dictationModeSettingsPatch, updateSettings, saveOpenAiApiKey, clearOpenAiApiKey, previewCloudPromptPack, testOpenAiConnection, clearCloudSessionLimitTimer, startCloudSessionLimitTimer, terminateActiveCloudDictationForOfflineMode, captureHotkey, clearHotkey, findDuplicateHotkey, checkForUpdates, installUpdate, handleUpdateButtonClick, installRuntime, downloadModel, deleteModel, downloadParakeetModel, deleteParakeetModel
 };
}




