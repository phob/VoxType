import {
  type Dispatch,
  type MouseEvent,
  type RefObject,
  type SetStateAction
} from "react";
import { type PcmRecorder, type PcmRecordingResult } from "../audio-recorder";
import { type DictationMode, type DictationModeId } from "../../../shared/asr";
import { type DictionaryEntry } from "../../../shared/dictionary";
import { type LocalModel } from "../../../shared/models";
import { type OcrPromptContext } from "../../../shared/ocr-context";
import { type OcrResult } from "../../../shared/ocr";
import { type ProviderLanguageHint } from "../../../shared/provider-language";
import { type AppProfile, type AppSettings, type InsertionMode } from "../../../shared/settings";
import { type TranscriptEntry } from "../../../shared/transcripts";
import { type UpdateStatus } from "../../../shared/updates";
import {
  type ActiveWindowInfo,
  type DictationHotkeyPayload,
  type RecordingOverlayState,
  type ScreenshotCaptureMode,
  type ScreenshotCaptureResult
} from "../../../shared/windows-helper";
import { type HotkeyCaptureTarget } from "./app-helpers";
import { type DevTab, type ReleaseModelFilter, type ReleaseTab } from "./app-options";
import { type AppState } from "./app-state";

export interface SetupStep {
  id: string;
  label: string;
  detail: string;
  ready: boolean;
  tab: ReleaseTab;
}

export interface AppDerivedState {
  activeDictationMode: DictationMode;
  activeModeIsCloud: boolean;
  activeModel: LocalModel | undefined;
  activeProviderLabel: string;
  activeProviderLanguageHint: ProviderLanguageHint | null;
  activeRuntimeLabel: string;
  appStatus: string;
  cloudAudioHistoryDetail: string;
  cloudModeGateLabel: string;
  cloudModeSelectionReady: boolean;
  cloudSetupDetail: string;
  cloudSetupReady: boolean;
  currentProfileProcessName: string | null;
  currentTarget: ActiveWindowInfo | null;
  developerCloudModePreviewEnabled: boolean;
  effectiveWhisperPrompt: string;
  generatedWhisperPrompt: string;
  hotkeyReady: boolean;
  latestTranscript: TranscriptEntry | undefined;
  modelReady: boolean;
  normalizedCloudSessionMaxMinutes: number | "";
  openAiModesReadyForRelease: boolean;
  readinessDetail: string;
  readinessTitle: string;
  readyToDictate: boolean;
  realtimeModeSelectionReady: boolean;
  realtimeStreamingReady: boolean;
  releaseModels: LocalModel[];
  runtimeReady: boolean;
  savedDictionaryTerms: Set<string>;
  selectedProfile: AppProfile | null;
  setupSteps: SetupStep[];
  updateButtonDisabled: boolean;
  updateButtonLabel: string;
}

export type AppProfilePatch = Partial<
  Pick<
    AppProfile,
    | "insertionMode"
    | "writingStyle"
    | "recordingCoordinationMode"
    | "recordingStartHotkey"
    | "recordingStopHotkey"
    | "postTranscriptionHotkey"
    | "whisperLanguage"
    | "dictationModeId"
    | "forbidCloudDictation"
    | "cloudPromptPackOcrEnabled"
    | "neverSuspendDictationInFullscreen"
  >
>;

export interface SettingsActions {
  refresh: () => Promise<void>;
  exactLocalModelSettingsPatch: (modelId: string) => Partial<AppSettings>;
  dictationModeSettingsPatch: (modeId: DictationModeId) => Partial<AppSettings>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  saveOpenAiApiKey: () => Promise<void>;
  clearOpenAiApiKey: () => Promise<void>;
  previewCloudPromptPack: () => Promise<void>;
  testOpenAiConnection: () => Promise<void>;
  clearCloudSessionLimitTimer: () => void;
  startCloudSessionLimitTimer: (settings: AppSettings, modeId: DictationModeId) => void;
  terminateActiveCloudDictationForOfflineMode: () => Promise<void>;
  captureHotkey: (event: MouseEvent, target: HotkeyCaptureTarget) => void;
  clearHotkey: (event: MouseEvent, target: HotkeyCaptureTarget) => void;
  findDuplicateHotkey: (
    accelerator: string,
    target: HotkeyCaptureTarget | `profile:${string}`
  ) => string | null;
  checkForUpdates: (options?: { manual?: boolean }) => Promise<void>;
  installUpdate: () => Promise<void>;
  handleUpdateButtonClick: () => Promise<void>;
  installRuntime: () => Promise<void>;
  downloadModel: (modelId: string) => Promise<void>;
  deleteModel: (modelId: string) => Promise<void>;
}

export interface RecordingActions {
  startRecording: () => Promise<void>;
  installSpecificRuntime: (runtimeId: string) => Promise<void>;
  setupFirstRunCuda: () => Promise<void>;
  refreshHardware: () => Promise<void>;
  handleHotkeyStart: (payload: DictationHotkeyPayload) => Promise<void>;
  handleHotkeyStop: (payload: DictationHotkeyPayload) => Promise<void>;
  stopAndTranscribe: (options?: {
    pasteTarget?: ActiveWindowInfo | null;
    ocrContext?: OcrPromptContext | null;
  }) => Promise<void>;
  startRecordingCoordination: (settings: AppSettings | null) => Promise<void>;
  stopRecordingCoordination: () => Promise<string | null>;
  unmuteSystemAudio: () => Promise<string | null>;
  copyLatestTranscript: () => Promise<void>;
  pasteLatestTranscript: () => Promise<void>;
  insertTranscript: (entry: TranscriptEntry) => Promise<void>;
  copyTranscript: (entry: TranscriptEntry) => Promise<void>;
  cleanupHistory: () => Promise<void>;
  transcribeSavedTranscript: (entry: TranscriptEntry) => Promise<void>;
  transcribeLatestTranscript: () => Promise<void>;
}

export interface ProfileDictionaryActions {
  refreshActiveWindow: () => Promise<void>;
  addCurrentAppProfile: () => Promise<void>;
  captureScreenshot: () => Promise<void>;
  recognizeLatestScreenshot: () => Promise<void>;
  captureInsertionTarget: () => Promise<void>;
  applyDetectedAppAsInsertionTarget: () => Promise<void>;
  runInsertionTest: (mode: InsertionMode) => Promise<void>;
  updateAppProfile: (profile: AppProfile, patch: AppProfilePatch) => Promise<void>;
  removeAppProfile: (profile: AppProfile) => Promise<void>;
  closeProfileModal: () => void;
  updateProfileHotkey: (processName: string, accelerator: string) => Promise<void>;
  sendProfilePostTranscriptionHotkey: (processName: string | null | undefined) => Promise<void>;
  clearDictionaryForm: () => void;
  selectDictionaryEntry: (entry: DictionaryEntry) => void;
  openNewDictionaryModal: () => void;
  openEditDictionaryModal: (entry: DictionaryEntry) => void;
  closeDictionaryModal: () => void;
  saveDictionaryEntryFromModal: () => Promise<void>;
  saveDictionaryEntry: () => Promise<boolean>;
  toggleDictionaryEntry: (entry: DictionaryEntry) => Promise<void>;
  removeDictionaryEntry: (entry: DictionaryEntry) => Promise<void>;
  learnFixLastDictation: () => Promise<void>;
  saveOcrTerm: (term: string) => Promise<void>;
  copyOcrRawText: () => Promise<void>;
  copyOcrTerms: () => Promise<void>;
  playTranscriptAudio: (entry: TranscriptEntry) => Promise<void>;
  stopTranscriptAudio: () => void;
}

export interface BaseActionContext extends AppDerivedState {
  audioElementRef: RefObject<HTMLAudioElement | null>;
  audioObjectUrlRef: RefObject<string | null>;
  cloudSessionLimitTimerRef: RefObject<number | null>;
  cloudSessionWarnedRef: RefObject<boolean>;
  confirmingDeleteModelId: string | null;
  confirmingDeleteProfileProcessName: string | null;
  capturingProfileHotkey: string | null;
  dictionaryAppProcess: string;
  dictionaryCategory: string;
  dictionaryMatches: string;
  dictionaryPreferred: string;
  editingDictionaryEntryId: string | null;
  fixLastText: string;
  hotkeyOcrContextRef: RefObject<OcrPromptContext | null>;
  hotkeySessionIdRef: RefObject<number | null>;
  hotkeyTargetRef: RefObject<ActiveWindowInfo | null>;
  insertionTarget: ActiveWindowInfo | null;
  insertionTestText: string;
  isDeveloperBuild: boolean;
  latestOcrContext: OcrPromptContext | null;
  latestOcrResult: OcrResult | null;
  latestScreenshot: ScreenshotCaptureResult | null;
  manualUpdateCooldownSeconds: number;
  modelDeleteTimerRef: RefObject<number | null>;
  openAiApiKeyDraft: string;
  playingTranscriptId: string | null;
  profileDeleteTimerRef: RefObject<number | null>;
  recorderRef: RefObject<PcmRecorder | null>;
  recordingActionsRef: RefObject<Partial<RecordingActions>>;
  recording: boolean;
  recordingStopHotkeyRef: RefObject<string | null>;
  releaseModelFilter: ReleaseModelFilter;
  screenshotMode: ScreenshotCaptureMode;
  selectedProfileProcessName: string | null;
  state: AppState;
  systemAudioMutedByVoxTypeRef: RefObject<boolean>;
  updateStatus: UpdateStatus | null;
  setActiveTab: Dispatch<SetStateAction<DevTab>>;
  setBusyMessage: Dispatch<SetStateAction<string | null>>;
  setCapturingHotkey: Dispatch<SetStateAction<HotkeyCaptureTarget | null>>;
  setCapturingProfileHotkey: Dispatch<SetStateAction<string | null>>;
  setConfirmingDeleteModelId: Dispatch<SetStateAction<string | null>>;
  setConfirmingDeleteProfileProcessName: Dispatch<SetStateAction<string | null>>;
  setDictionaryAppProcess: Dispatch<SetStateAction<string>>;
  setDictionaryCategory: Dispatch<SetStateAction<string>>;
  setDictionaryMatches: Dispatch<SetStateAction<string>>;
  setDictionaryModalOpen: Dispatch<SetStateAction<boolean>>;
  setDictionaryPreferred: Dispatch<SetStateAction<string>>;
  setEditingDictionaryEntryId: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setFixLastText: Dispatch<SetStateAction<string>>;
  setInsertionTarget: Dispatch<SetStateAction<ActiveWindowInfo | null>>;
  setInsertionTestResult: Dispatch<SetStateAction<string | null>>;
  setIsDeveloperBuild: Dispatch<SetStateAction<boolean>>;
  setLastRecordingResult: Dispatch<SetStateAction<PcmRecordingResult | null>>;
  setLatestOcrContext: Dispatch<SetStateAction<OcrPromptContext | null>>;
  setLatestOcrResult: Dispatch<SetStateAction<OcrResult | null>>;
  setLatestScreenshot: Dispatch<SetStateAction<ScreenshotCaptureResult | null>>;
  setManualUpdateCooldownSeconds: Dispatch<SetStateAction<number>>;
  setOpenAiApiKeyDraft: Dispatch<SetStateAction<string>>;
  setOverlayState: Dispatch<SetStateAction<RecordingOverlayState>>;
  setPlayingTranscriptId: Dispatch<SetStateAction<string | null>>;
  setRecording: Dispatch<SetStateAction<boolean>>;
  setReleaseModelFilter: Dispatch<SetStateAction<ReleaseModelFilter>>;
  setReleaseTab: Dispatch<SetStateAction<ReleaseTab>>;
  setRetranscribingTranscriptId: Dispatch<SetStateAction<string | null>>;
  setScreenshotMode: Dispatch<SetStateAction<ScreenshotCaptureMode>>;
  setSelectedProfileProcessName: Dispatch<SetStateAction<string | null>>;
  setState: Dispatch<SetStateAction<AppState>>;
  setUpdateStatus: Dispatch<SetStateAction<UpdateStatus | null>>;
  setVersion: Dispatch<SetStateAction<string>>;
}

export type RecordingActionContext = BaseActionContext &
  Pick<
    SettingsActions,
    "clearCloudSessionLimitTimer" | "startCloudSessionLimitTimer"
  >;

export type ProfileDictionaryActionContext = BaseActionContext &
  SettingsActions &
  RecordingActions;

export interface AppViewProps
  extends BaseActionContext,
    SettingsActions,
    RecordingActions,
    ProfileDictionaryActions {
  activeTab: DevTab;
  busyMessage: string | null;
  capturingHotkey: HotkeyCaptureTarget | null;
  dictionaryModalOpen: boolean;
  error: string | null;
  insertionTestResult: string | null;
  isOverlay: boolean;
  lastRecordingResult: PcmRecordingResult | null;
  overlayState: RecordingOverlayState;
  releaseTab: ReleaseTab;
  releaseTooltip: { text: string; x: number; y: number } | null;
  retranscribingTranscriptId: string | null;
  setInsertionTestText: Dispatch<SetStateAction<string>>;
  setReleaseTooltip: Dispatch<SetStateAction<{ text: string; x: number; y: number } | null>>;
  version: string;
}

export type ReadyAppViewProps = AppViewProps & {
  state: AppState & { settings: AppSettings };
};
