import { type ReactElement } from "react";
import { ArrowRight, Check, CheckCircle2, Clipboard, Download, FileText, MoreVertical, Play, Plus, RefreshCw, Trash2, UserPlus, X } from "lucide-react";
import { dictationModes } from "../../../shared/asr";
import { cloudDictationConsentExclusions, cloudDictationConsentOfflineNotice, cloudDictationConsentSummary } from "../../../shared/cloud-consent-copy";
import { currentCloudReleaseSmokeTestChecklist, formatCloudReleaseSmokeTestStatus } from "../../../shared/cloud-release-smoke-test";
import { currentOpenAiModeImplementationReadiness } from "../../../shared/openai-readiness";
import { PROMPT_PACK_MAX_CHARS, PROMPT_PACK_MAX_TERMS } from "../../../shared/prompt-pack-limits";
import { type RealtimeLatencyPreset } from "../../../shared/settings";
import { ReleaseChip, ReleaseIcon, ReleaseSelect, ReleaseStatusBadge, appHotkeyEntries, formatBytes, formatDuration, formatRelativeTimestamp, formatTimestamp, getOpenAiCredentialStatusText, gpuFitLabel, insertionModeLabel, profileWhisperLanguageLabel, recordingInputDeviceLabel, writingStyleLabel } from "./app-helpers";
import { realtimeLatencyPresetOptions } from "./app-options";

export function ReleaseCloudSection(props: Record<string, any>): ReactElement {
  const { activeDictationMode, activeProviderLabel, clearOpenAiApiKey, cloudModeGateLabel, cloudModeSelectionReady, normalizedCloudSessionMaxMinutes, openAiApiKeyDraft, previewCloudPromptPack, releaseTab, saveOpenAiApiKey, setOpenAiApiKeyDraft, state, testOpenAiConnection, updateSettings } = props;
  return (
    <>
          {releaseTab === "cloud" && !state.settings.offlineMode ? (
            <section className="release-panel cloud-page release-scroll-panel">
              <div className="release-panel-heading cloud-page-heading">
                <div className="release-panel-title">
                  <ReleaseIcon name="cloud" decorative />
                  <h2>Cloud</h2>
                </div>
                <div className="release-chip-row cloud-page-chips">
                  <ReleaseChip tone={activeDictationMode.providerId === "openai" ? "warning" : "success"}>
                    {activeProviderLabel}: {activeDictationMode.label}
                  </ReleaseChip>
                  <ReleaseChip tone={cloudModeSelectionReady ? "accent" : "neutral"}>
                    {cloudModeGateLabel}
                  </ReleaseChip>
                </div>
              </div>
              <p className="cloud-page-intro">
                Configure the opt-in OpenAI path. Offline Mode hides this page and blocks cloud sessions.
              </p>
              <div className="cloud-readiness-strip" aria-label="Cloud readiness">
                <ReleaseStatusBadge tone={currentOpenAiModeImplementationReadiness.realtimeSessionIpcReady ? "ready" : "disabled"}>
                  IPC {currentOpenAiModeImplementationReadiness.realtimeSessionIpcReady ? "ready" : "pending"}
                </ReleaseStatusBadge>
                <ReleaseStatusBadge tone={currentOpenAiModeImplementationReadiness.realtimeRendererLifecycleReady ? "ready" : "disabled"}>
                  Renderer {currentOpenAiModeImplementationReadiness.realtimeRendererLifecycleReady ? "ready" : "pending"}
                </ReleaseStatusBadge>
                <ReleaseStatusBadge tone={currentOpenAiModeImplementationReadiness.realtimeNativePcmStreamingReady ? "ready" : "disabled"}>
                  PCM {currentOpenAiModeImplementationReadiness.realtimeNativePcmStreamingReady ? "ready" : "pending"}
                </ReleaseStatusBadge>
                <ReleaseStatusBadge tone={currentOpenAiModeImplementationReadiness.releaseSmokeTested ? "ready" : "disabled"}>
                  {formatCloudReleaseSmokeTestStatus(currentCloudReleaseSmokeTestChecklist)}
                </ReleaseStatusBadge>
              </div>
              <div className="cloud-scroll-body">
                <section className="cloud-consent-block" aria-labelledby="cloud-consent-heading">
                  <div className="cloud-setting-copy">
                    <h3 id="cloud-consent-heading">Cloud Dictation consent</h3>
                    <p>{cloudDictationConsentSummary} {cloudDictationConsentExclusions} {cloudDictationConsentOfflineNotice}</p>
                    {state.settings.cloudDictationConsentAcceptedAt ? (
                      <p>Accepted {new Date(state.settings.cloudDictationConsentAcceptedAt).toLocaleDateString()}.</p>
                    ) : null}
                    <span className="inline-doc-links">
                      <a href="https://openai.com/api/pricing/" rel="noreferrer" target="_blank">Pricing</a>
                      <a href="https://openai.com/policies/privacy-policy/" rel="noreferrer" target="_blank">Privacy</a>
                      <a href="https://platform.openai.com/docs/models" rel="noreferrer" target="_blank">API docs</a>
                    </span>
                  </div>
                  <label className="cloud-consent-switch">
                    <span>Consent</span>
                    <input
                      checked={state.settings.cloudDictationConsentAccepted}
                      type="checkbox"
                      onChange={(event) =>
                        void updateSettings({ cloudDictationConsentAccepted: event.target.checked })
                      }
                    />
                  </label>
                </section>
                <div className="settings-list cloud-settings-list">
                <label className="setting-row">
                  <span>
                    <strong>Cloud session warning</strong>
                    <small>Warn after this many minutes; default is 5.</small>
                  </span>
                  <input
                    min={1}
                    type="number"
                    value={Math.round(state.settings.cloudSessionWarnMs / 60000)}
                    onChange={(event) =>
                      void updateSettings({ cloudSessionWarnMs: Number(event.target.value) * 60000 })
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Cloud session maximum</strong>
                    <small>Automatically finalize after this many minutes; leave blank for unlimited.</small>
                  </span>
                  <input
                    min={1}
                    type="number"
                    value={normalizedCloudSessionMaxMinutes}
                    onChange={(event) =>
                      void updateSettings({
                        cloudSessionMaxMs: event.target.value === "" ? null : Number(event.target.value) * 60000
                      })
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Save cloud file audio history</strong>
                    <small>Stores processed WAV audio for non-realtime Cloud Dictation history; realtime cloud audio is never saved.</small>
                  </span>
                  <input
                    checked={state.settings.cloudFileAudioHistoryEnabled}
                    type="checkbox"
                    onChange={(event) =>
                      void updateSettings({ cloudFileAudioHistoryEnabled: event.target.checked })
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Realtime latency preset</strong>
                    <small>OpenAI realtime transcription delay; Balanced is recommended.</small>
                  </span>
                  <select
                    value={state.settings.realtimeLatencyPreset}
                    onChange={(event) =>
                      void updateSettings({ realtimeLatencyPreset: event.target.value as RealtimeLatencyPreset })
                    }
                  >
                    {realtimeLatencyPresetOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} - {option.meta}
                      </option>
                    ))}
                  </select>
                </label>
                {state.settings.developerModeEnabled && state.settings.realtimeVadThresholdOverride !== null ? (
                  <label className="setting-row">
                    <span>
                      <strong>Legacy realtime VAD threshold</strong>
                      <small>Ignored for gpt-realtime-whisper transcription sessions because server VAD is disabled; clear it to remove stale debug state.</small>
                    </span>
                    <button
                      type="button"
                      onClick={() => void updateSettings({ realtimeVadThresholdOverride: null })}
                    >
                      Clear ignored VAD override
                    </button>
                  </label>
                ) : null}
                <label className="setting-row">
                  <span>
                    <strong>Allow OCR Context in cloud Prompt Pack</strong>
                    <small>Off by default. Dictionary terms are still capped to {PROMPT_PACK_MAX_TERMS} terms / {PROMPT_PACK_MAX_CHARS.toLocaleString()} characters. App Profiles can override this for sensitive apps.</small>
                  </span>
                  <input
                    checked={state.settings.cloudPromptPackOcrEnabled}
                    type="checkbox"
                    onChange={(event) =>
                      void updateSettings({ cloudPromptPackOcrEnabled: event.target.checked })
                    }
                  />
                </label>
                <div className="setting-row cloud-setting-wide">
                  <span>
                    <strong>OpenAI API key</strong>
                    <small>{getOpenAiCredentialStatusText(state.openaiCredentials)}</small>
                  </span>
                  <div className="setting-actions setting-actions-with-input cloud-key-actions">
                    <input
                      aria-label="OpenAI API key"
                      autoComplete="off"
                      placeholder="sk-..."
                      type="password"
                      value={openAiApiKeyDraft}
                      onChange={(event) => setOpenAiApiKeyDraft(event.target.value)}
                    />
                    <button disabled={!openAiApiKeyDraft.trim()} onClick={() => void saveOpenAiApiKey()} type="button">Save key</button>
                    <button
                      disabled={activeDictationMode.id === "openai.realtime"}
                      title={activeDictationMode.id === "openai.realtime" ? "Realtime Cloud Dictation does not send Prompt Pack text." : "Preview the capped Prompt Pack for file cloud modes."}
                      onClick={() => void previewCloudPromptPack()}
                      type="button"
                    >Prompt Pack preview</button>
                    <button
                      disabled={!state.openaiCredentials?.hasApiKey || state.settings.offlineMode}
                      title={state.settings.offlineMode ? "Disabled in Offline Mode" : !state.openaiCredentials?.hasApiKey ? "API key required before test connection" : "Test OpenAI API key and selected cloud model"}
                      onClick={() => void testOpenAiConnection()}
                      type="button"
                    >Test connection</button>
                    <button disabled={!state.openaiCredentials?.hasApiKey || state.openaiCredentials.source === "environment"} onClick={() => void clearOpenAiApiKey()} type="button">Clear stored key</button>
                  </div>
                </div>
                </div>
              </div>
            </section>
          ) : null}

    </>
  );
}

