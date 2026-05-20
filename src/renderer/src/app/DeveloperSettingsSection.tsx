import { type ReactElement } from "react";
import { type InsertionMode, type RecorderCaptureMode, type RecordingCoordinationMode, type WhisperLanguage, type WhisperRuntimePreference } from "../../../shared/settings";
import { type NativeInputDevice } from "../../../shared/windows-helper";
import { whisperLanguageOptions } from "./app-options";
import { type ReadyAppViewProps } from "./app-types";

export function DeveloperSettingsSection(props: ReadyAppViewProps): ReactElement {
  const { activeDictationMode, activeProviderLabel, activeTab, captureHotkey, capturingHotkey, clearHotkey, state, updateSettings } = props;
  return (
    <>
        {activeTab === "settings" ? (
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
              <label className="dev-field wide">
                <span>recordingInputDeviceId</span>
                <select
                  value={state.settings.recordingInputDeviceId}
                  onChange={(event) =>
                    void updateSettings({ recordingInputDeviceId: event.target.value })
                  }
                >
                  <option value="default">default</option>
                  {state.inputDevices.map((device: NativeInputDevice) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                      {device.isDefault ? " (default)" : ""}
                    </option>
                  ))}
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
                  onClick={(event) => { captureHotkey(event, "recordingStartHotkey"); }}
                  onContextMenu={(event) => { clearHotkey(event, "recordingStartHotkey"); }}
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
                  onClick={(event) => { captureHotkey(event, "recordingStopHotkey"); }}
                  onContextMenu={(event) => { clearHotkey(event, "recordingStopHotkey"); }}
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
                  onClick={(event) => { captureHotkey(event, "dictationToggleHotkey"); }}
                  onContextMenu={(event) => { clearHotkey(event, "dictationToggleHotkey"); }}
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
                  onClick={(event) => { captureHotkey(event, "dictationHoldHotkey"); }}
                  onContextMenu={(event) => { clearHotkey(event, "dictationHoldHotkey"); }}
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
                  onClick={(event) => { captureHotkey(event, "showWindowHotkey"); }}
                  onContextMenu={(event) => { clearHotkey(event, "showWindowHotkey"); }}
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
                  checked={state.settings.automaticUpdateChecksEnabled}
                  type="checkbox"
                  onChange={(event) =>
                    void updateSettings({ automaticUpdateChecksEnabled: event.target.checked })
                  }
                />
                automaticUpdateChecksEnabled
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
              <code>{activeProviderLabel} · {activeDictationMode.label}</code>
              <code>hotkeys</code>
              <span>
                dictation={state.hotkeys?.dictationToggleHotkey ?? "none"} show=
                {state.hotkeys?.showWindowHotkey ?? "none"}
              </span>
            </div>
          </section>
        ) : null}

    </>
  );
}

