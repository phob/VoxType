import { getDictationMode } from "../../../shared/asr";
import { type OcrPromptContext } from "../../../shared/ocr-context";
import {
  areAllOpenAiModesReadyForRelease,
  currentOpenAiModeImplementationReadiness
} from "../../../shared/openai-readiness";
import { getProviderLanguageHint } from "../../../shared/provider-language";
import { type UpdateStatus } from "../../../shared/updates";
import { type ActiveWindowInfo } from "../../../shared/windows-helper";
import {
  buildWhisperPromptPreview,
  combineWhisperPromptPreview,
  normalizeProfileProcessName
} from "./app-helpers";
import { type ReleaseModelFilter, type ReleaseTab } from "./app-options";
import { type AppState } from "./app-state";
import { type AppDerivedState } from "./app-types";

interface AppDerivedStateInput {
  busyMessage: string | null;
  error: string | null;
  insertionTarget: ActiveWindowInfo | null;
  isDeveloperBuild: boolean;
  latestOcrContext: OcrPromptContext | null;
  manualUpdateCooldownSeconds: number;
  recording: boolean;
  releaseModelFilter: ReleaseModelFilter;
  selectedProfileProcessName: string | null;
  state: AppState;
  updateStatus: UpdateStatus | null;
}

export function deriveAppState({
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
}: AppDerivedStateInput): AppDerivedState {
  const activeModel = state.models.find((model) => model.id === state.settings?.activeModelId);
  const selectedProfile =
    state.settings?.appProfiles.find(
      (profile) => profile.processName === selectedProfileProcessName
    ) ?? null;
  const latestTranscript = state.history[0];
  const currentTarget = insertionTarget ?? state.activeWindow;
  const currentProfileProcessName = normalizeProfileProcessName(state.activeWindow?.processName);
  const generatedWhisperPrompt = buildWhisperPromptPreview(
    state.dictionary,
    currentTarget?.processName ?? null,
    latestOcrContext?.terms ?? []
  );
  const effectiveWhisperPrompt = combineWhisperPromptPreview(
    generatedWhisperPrompt,
    state.settings?.whisperPromptOverride ?? ""
  );
  const activeDictationMode = getDictationMode(state.settings?.dictationModeId ?? "local.balanced");
  const activeModeIsParakeet = activeDictationMode.providerId === "local-parakeet";
  const activeParakeetModel = activeModeIsParakeet
    ? state.sherpaModels.find((model) => model.id === activeDictationMode.modelId)
    : undefined;
  const parakeetRuntimeInstalled = state.sherpaRuntimes.some(
    (runtime) =>
      runtime.backend === (state.settings?.sherpaRuntimeBackend ?? "cpu") &&
      runtime.status === "installed"
  );
  const activeProviderLabel = activeDictationMode.providerId === "openai" ? "Cloud Dictation" : "Local dictation";
  const activeModelLabel =
    activeDictationMode.providerId === "openai"
      ? activeDictationMode.secondaryText
      : activeModeIsParakeet
        ? (activeParakeetModel?.name ?? activeDictationMode.secondaryText)
        : (activeModel?.name ?? state.settings?.activeModelId ?? "—");
  const appStatus = error ? "Error" : recording ? "Recording" : busyMessage ?? "Ready";
  const normalizedCloudSessionMaxMinutes =
    state.settings?.cloudSessionMaxMs === null
      ? ""
      : Math.max(
          Math.round((state.settings?.cloudSessionMaxMs ?? 10 * 60000) / 60000),
          Math.round((state.settings?.cloudSessionWarnMs ?? 5 * 60000) / 60000)
        );
  const activeRuntimeLabel = activeModeIsParakeet
    ? `${(state.settings?.sherpaRuntimeBackend ?? "cpu").toUpperCase()} · ${parakeetRuntimeInstalled ? "installed" : "not installed"}`
    : state.runtime
      ? `${state.runtime.backend.toUpperCase()} · ${state.runtime.status}`
      : "Runtime not ready";
  const openAiModesReadyForRelease = areAllOpenAiModesReadyForRelease(
    currentOpenAiModeImplementationReadiness
  );
  const realtimeStreamingReady = currentOpenAiModeImplementationReadiness.realtimeReady;
  const developerCloudModePreviewEnabled = isDeveloperBuild;
  const cloudModeSelectionReady = openAiModesReadyForRelease || developerCloudModePreviewEnabled;
  const realtimeModeSelectionReady = realtimeStreamingReady || developerCloudModePreviewEnabled;
  const cloudModeGateLabel = developerCloudModePreviewEnabled
    ? "Developer build cloud preview"
    : openAiModesReadyForRelease
      ? "Cloud Dictation ready"
      : "Cloud Dictation release-gated";
  const activeModeIsCloud = activeDictationMode.providerId === "openai";
  const activeProviderLanguageHint = state.settings
    ? getProviderLanguageHint(activeDictationMode.providerId, state.settings.whisperLanguage)
    : null;
  const cloudSetupReady =
    !activeModeIsCloud ||
    (Boolean(state.openaiCredentials?.hasApiKey) && Boolean(state.settings?.cloudDictationConsentAccepted));
  const cloudSetupDetail = !activeModeIsCloud
    ? "Not needed for local dictation."
    : !state.settings?.cloudDictationConsentAccepted
      ? "Accept Cloud Dictation consent before recording."
      : !state.openaiCredentials?.hasApiKey
        ? "Add an OpenAI API key before recording."
        : state.openaiCredentials.source === "environment"
          ? "Consent accepted and OPENAI_API_KEY is available from the environment."
          : "Consent accepted and API key stored.";
  const cloudAudioHistoryDetail = !activeModeIsCloud
    ? "Local audio history follows local dictation history behavior."
    : state.settings?.cloudFileAudioHistoryEnabled
      ? "Non-realtime cloud processed WAV audio will be saved in history; realtime cloud audio is never saved."
      : "Cloud processed WAV audio history is off; realtime cloud audio is never saved.";
  // The sherpa runtime downloads on demand at first transcription, so it counts
  // as ready when already installed or when online download is permitted.
  const parakeetRuntimeReady = parakeetRuntimeInstalled || !state.settings?.offlineMode;
  const modelReady = activeModeIsCloud
    ? true
    : activeModeIsParakeet
      ? activeParakeetModel?.status === "downloaded"
      : activeModel?.status === "downloaded";
  const runtimeReady = activeModeIsCloud
    ? true
    : activeModeIsParakeet
      ? parakeetRuntimeReady
      : state.runtime?.status === "installed";
  const hotkeyReady = Boolean(state.settings?.dictationToggleHotkey.trim());
  const readyToDictate = modelReady && runtimeReady && cloudSetupReady && hotkeyReady && !error;
  const readinessTitle = error
    ? "Attention needed"
    : readyToDictate
      ? "Ready to dictate"
      : "Finish setup";
  const readinessDetail = error
    ? "Fix the current issue before starting another dictation."
    : readyToDictate
      ? "Focus any Windows app, press your dictation hotkey, and speak."
      : "Complete the remaining setup steps, then use VoxType from the app where you want text.";
  const setupSteps = [
    {
      id: "model",
      label: "Choose a model",
      detail: activeModeIsCloud
        ? "Cloud mode uses OpenAI instead of a local model."
        : activeModeIsParakeet
          ? modelReady
            ? (activeParakeetModel?.name ?? "Model ready")
            : "Download the Parakeet model."
          : modelReady
            ? (activeModel?.name ?? "Model ready")
            : "Download a local Whisper model.",
      ready: modelReady,
      tab: "models" as ReleaseTab
    },
    {
      id: "hotkey",
      label: "Set dictation hotkey",
      detail: hotkeyReady
        ? (state.settings?.dictationToggleHotkey ?? "Hotkey ready")
        : "Pick the shortcut you will use outside VoxType.",
      ready: hotkeyReady,
      tab: "hotkeys" as ReleaseTab
    },
    {
      id: "runtime",
      label: "Speech engine",
      detail: activeModeIsCloud
        ? "Cloud mode does not require a local whisper.cpp runtime."
        : activeModeIsParakeet
          ? parakeetRuntimeInstalled
            ? activeRuntimeLabel
            : state.settings?.offlineMode
              ? "Turn off Offline Mode to download the Parakeet runtime."
              : "The Parakeet runtime downloads automatically on first use."
          : runtimeReady
            ? activeRuntimeLabel
            : "Install or select a local runtime.",
      ready: runtimeReady,
      tab: "models" as ReleaseTab
    },
    {
      id: "cloud-setup",
      label: "Cloud setup",
      detail: cloudSetupDetail,
      ready: cloudSetupReady,
      tab: state.settings?.offlineMode ? "settings" as ReleaseTab : "cloud" as ReleaseTab
    },
    {
      id: "cloud-audio-history",
      label: "Cloud audio history",
      detail: cloudAudioHistoryDetail,
      ready: true,
      tab: state.settings?.offlineMode ? "settings" as ReleaseTab : "cloud" as ReleaseTab
    }
  ];
  const releaseModels = state.models.filter((model) => {
    if (releaseModelFilter === "installed") {
      return model.status === "downloaded";
    }

    if (releaseModelFilter === "available") {
      return model.status !== "downloaded";
    }

    return true;
  });
  const releaseSherpaModels = state.sherpaModels.filter((model) => {
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
        : updateStatus?.state === "error"
          ? "Retry"
        : updateStatus?.available
          ? "Update"
          : manualUpdateCooldownSeconds > 0
            ? `${String(manualUpdateCooldownSeconds)}s`
            : "Stable";
  const updateButtonDisabled =
    updateStatus?.state === "checking" ||
    updateStatus?.state === "downloading" ||
    updateStatus?.state === "installing" ||
    (!updateStatus?.available && manualUpdateCooldownSeconds > 0);

  return {
    activeDictationMode,
    activeModeIsCloud,
    activeModel,
    activeModelLabel,
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
    releaseSherpaModels,
    runtimeReady,
    savedDictionaryTerms,
    selectedProfile,
    setupSteps,
    updateButtonDisabled,
    updateButtonLabel
  };
}
