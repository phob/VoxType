import { type DictionaryEntry } from "../../../shared/dictionary";
import { type HardwareAccelerationReport } from "../../../shared/hardware";
import { type HotkeyStatus } from "../../../shared/hotkeys";
import { type LocalModel } from "../../../shared/models";
import { type OpenAiCredentialStatus } from "../../../shared/openai-credentials";
import { type WhisperRuntime } from "../../../shared/runtimes";
import { type SherpaModel } from "../../../shared/sherpa-models";
import { type SherpaRuntime } from "../../../shared/sherpa-runtimes";
import { type AppSettings } from "../../../shared/settings";
import { type TranscriptEntry } from "../../../shared/transcripts";
import {
  type ActiveWindowInfo,
  type NativeInputDevice,
  type RecordingOverlayState,
  type WindowsHelperStatus
} from "../../../shared/windows-helper";

export interface AppState {
  models: LocalModel[];
  runtime: WhisperRuntime | null;
  runtimes: WhisperRuntime[];
  settings: AppSettings | null;
  history: TranscriptEntry[];
  dictionary: DictionaryEntry[];
  hardware: HardwareAccelerationReport | null;
  windowsHelper: WindowsHelperStatus | null;
  inputDevices: NativeInputDevice[];
  activeWindow: ActiveWindowInfo | null;
  hotkeys: HotkeyStatus | null;
  openaiCredentials: OpenAiCredentialStatus | null;
  sherpaModels: SherpaModel[];
  sherpaRuntimes: SherpaRuntime[];
}

export const defaultOverlayState: RecordingOverlayState = {
  visible: false,
  mode: "recording",
  level: 0,
  message: "Recording"
};
