import { type ReactElement } from "react";
import { ArrowRight, CheckCircle2, Clipboard, Download, FileText, MoreVertical, Play, RefreshCw, Trash2 } from "lucide-react";
import { dictationModes } from "../../../shared/asr";
import { getDictationModeAvailability } from "../../../shared/dictation-mode-availability";
import { currentOpenAiModeImplementationReadiness } from "../../../shared/openai-readiness";
import { type LocalModel } from "../../../shared/models";
import { type SherpaModel } from "../../../shared/sherpa-models";
import { type TranscriptEntry } from "../../../shared/transcripts";
import { type NativeInputDevice } from "../../../shared/windows-helper";
import {
  ReleaseChip,
  ReleaseIcon,
  ReleaseSelect,
  ReleaseStatusBadge,
  WindowTitleBar,
  formatDuration,
  formatRelativeTimestamp,
  formatTimestamp,
  gpuFitLabel,
  recordingInputDeviceLabel,
} from "./app-helpers";
import { type ReleaseIconName } from "./app-helpers";
import { whisperLanguageOptions, type ReleaseModelFilter, type ReleaseTab } from "./app-options";
import { ReleaseCloudSection } from "./ReleaseCloudSection";
import { ReleaseProfilesSection } from "./ReleaseProfilesSection";
import { ReleaseDictionarySection } from "./ReleaseDictionarySection";
import { type ReadyAppViewProps, type SetupStep } from "./app-types";

export function ReleaseView(props: ReadyAppViewProps): ReactElement {
  const { activeDictationMode, activeModelLabel, activeProviderLanguageHint, activeRuntimeLabel, appStatus, busyMessage, captureHotkey, capturingHotkey, clearHotkey, cloudModeSelectionReady, confirmingDeleteModelId, copyTranscript, deleteModel, deleteParakeetModel, dictationModeSettingsPatch, downloadModel, downloadParakeetModel, error, exactLocalModelSettingsPatch, handleUpdateButtonClick, insertTranscript, isDeveloperBuild, manualUpdateCooldownSeconds, playingTranscriptId, playTranscriptAudio, readinessDetail, readinessTitle, readyToDictate, realtimeModeSelectionReady, recording, releaseModelFilter, releaseModels, releaseSherpaModels, releaseTab, releaseTooltip, retranscribingTranscriptId, setReleaseModelFilter, setReleaseTab, setReleaseTooltip, setupSteps, state, transcribeSavedTranscript, updateButtonDisabled, updateButtonLabel, updateSettings, updateStatus, version } = props;
  const incompleteSetupSteps = setupSteps.filter((step: SetupStep) => !step.ready);
  const parakeetHotwordsAvailable = state.sherpaModels.some((model) => model.hotwordsAvailable);
  const readinessPanelClassName = [
    "release-panel",
    "release-readiness-panel",
    readyToDictate ? "ready" : "needs-setup",
    incompleteSetupSteps.length ? null : "no-checklist"
  ]
    .filter(Boolean)
    .join(" ");

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
              ["history", "History", "history"],
              ...(!state.settings.offlineMode ? [["cloud", "Cloud", "cloud"] as [ReleaseTab, string, ReleaseIconName]] : [])
            ] as [ReleaseTab, string, ReleaseIconName][]).map(([tab, label, icon]) => (
              <button
                className={releaseTab === tab ? "active" : ""}
                key={tab}
                onClick={() => { setReleaseTab(tab); }}
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
            {isDeveloperBuild ? (
              <button
                className="release-developer-link"
                onClick={() => void updateSettings({ debugViewEnabled: true })}
                type="button"
              >
                <span className="release-nav-icon" aria-hidden="true">
                  <ReleaseIcon name="code" decorative />
                </span>
                <span>Debug</span>
              </button>
            ) : null}
            <button
              className={
                releaseTab === "settings" ? "release-settings-link active" : "release-settings-link"
              }
              onClick={() => { setReleaseTab("settings"); }}
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
                        ? `Check again in ${String(manualUpdateCooldownSeconds)} seconds`
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

        <div
          className="release-main"
          onMouseOver={(event) => {
            const tooltipTarget = (event.target as HTMLElement).closest<HTMLElement>("[data-tooltip]");

            if (!tooltipTarget) {
              return;
            }

            const tooltipText = tooltipTarget.dataset.tooltip;

            if (!tooltipText) {
              return;
            }

            const rect = tooltipTarget.getBoundingClientRect();
            setReleaseTooltip({ text: tooltipText, x: rect.left + rect.width / 2, y: rect.top - 8 });
          }}
          onMouseOut={(event) => {
            const tooltipTarget = (event.target as HTMLElement).closest<HTMLElement>("[data-tooltip]");

            if (!tooltipTarget || tooltipTarget.contains(event.relatedTarget as Node | null)) {
              return;
            }

            setReleaseTooltip(null);
          }}
        >
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

          {releaseTooltip ? (
            <div
              className="release-tooltip"
              style={{ left: releaseTooltip.x, top: releaseTooltip.y }}
              role="tooltip"
            >
              {releaseTooltip.text}
            </div>
          ) : null}

          {releaseTab === "general" ? (
            <div className="release-home-stack">
            <section className={readinessPanelClassName}>
              <div className="readiness-main">
                <span className="readiness-icon" aria-hidden="true">
                  <ReleaseIcon name={readyToDictate ? "shield" : "bolt"} decorative />
                </span>
                <div>
                  <strong>{readinessTitle}</strong>
                  <p>{readinessDetail}</p>
                </div>
              </div>
              {incompleteSetupSteps.length ? (
                <div className="readiness-steps" aria-label="Setup checklist">
                  {incompleteSetupSteps.map((step: SetupStep) => (
                    <button
                      className="needs-setup"
                      key={step.id}
                      onClick={() => { setReleaseTab(step.tab); }}
                      type="button"
                    >
                      <span className="step-dot" aria-hidden="true" />
                      <span>
                        <strong>{step.label}</strong>
                        <small>{step.detail}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
            <section className="release-panel release-summary-panel">
              <dl className="home-summary">
                <div>
                  <dt>Hotkey</dt>
                  <dd>{state.settings.dictationToggleHotkey || "Unset"}</dd>
                </div>
                <div>
                  <dt>Speech engine</dt>
                  <dd>{activeRuntimeLabel}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{activeModelLabel}</dd>
                </div>
                <div>
                  <dt>Acceleration</dt>
                  <dd>{state.hardware?.bestGpu?.name ?? "CPU fallback"}</dd>
                </div>
              </dl>
            </section>
            <section className="release-panel settings-panel">
              <div className="settings-list">
                <label className="setting-row">
                  <span>
                    <strong>Dictation Mode</strong>
                    <small>Choose local dictation or an available cloud mode for your default transcription path.</small>
                  </span>
                  <select
                    value={state.settings.dictationModeId}
                    onChange={(event) =>
                      void updateSettings(dictationModeSettingsPatch(event.target.value))
                    }
                  >
                    {dictationModes.map((mode) => {
                      const availability = getDictationModeAvailability({
                        modeId: mode.id,
                        settings: state.settings,
                        hasOpenAiApiKey: Boolean(state.openaiCredentials?.hasApiKey),
                        realtimeStreamingReady: realtimeModeSelectionReady,
                        allOpenAiModesReadyForRelease: cloudModeSelectionReady,
                        openAiReadiness: currentOpenAiModeImplementationReadiness
                      });

                      return (
                        <option disabled={!availability.selectable} key={mode.id} value={mode.id}>
                          {mode.label} - {mode.secondaryText}{availability.reason ? ` (${availability.reason})` : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Language</strong>
                    <small>Auto-detect or force Whisper to listen for one language. {activeProviderLanguageHint?.reason ?? (activeProviderLanguageHint?.parameterValue ? `${activeDictationMode.label} will request ${activeProviderLanguageHint.parameterValue}.` : "")}</small>
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
                <button className="ghost-link-button" onClick={() => { setReleaseTab("history"); }} type="button">
                  <span>View all history</span>
                  <ReleaseIcon name="arrowRight" decorative />
                </button>
              </div>
              <div className="recent-history-list">
                {state.history.length ? (
                  state.history.slice(0, 2).map((entry: TranscriptEntry) => (
                    <article className="recent-history-row" key={entry.id}>
                      <FileText aria-hidden="true" className="release-icon-svg" />
                      <p>{entry.text}</p>
                      <small>{entry.providerId === "openai" ? "Cloud Dictation" : "Local dictation"}{entry.languageHint ? ` · ${entry.languageHint}` : " · auto"}</small>
                      <time>{formatRelativeTimestamp(entry.createdAt)}</time>
                      <button
                        aria-label="View transcript actions"
                        data-tooltip="View actions in History"
                        onClick={() => { setReleaseTab("history"); }}
                        title="View actions in History"
                        type="button"
                      >
                        <MoreVertical aria-hidden="true" className="release-icon-svg" />
                      </button>
                    </article>
                  ))
                ) : (
                  <p className="empty-state">
                    Your latest dictations will appear here after you use the hotkey in another app.
                  </p>
                )}
              </div>
            </section>
            </div>
          ) : null}

          <ReleaseCloudSection {...props} />
          {releaseTab === "settings" ? (
            <section className="release-panel settings-panel release-scroll-panel">
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
                    <strong>Check for updates automatically</strong>
                    <small>Look for a new release at startup and about every hour.</small>
                  </span>
                  <input
                    checked={state.settings.automaticUpdateChecksEnabled}
                    type="checkbox"
                    onChange={(event) =>
                      void updateSettings({
                        automaticUpdateChecksEnabled: event.target.checked
                      })
                    }
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
                    <strong>Microphone</strong>
                    <small>{recordingInputDeviceLabel(state.settings, state.inputDevices)}</small>
                  </span>
                  <select
                    value={state.settings.recordingInputDeviceId}
                    onChange={(event) =>
                      void updateSettings({ recordingInputDeviceId: event.target.value })
                    }
                  >
                    <option value="default">System default</option>
                    {state.inputDevices.map((device: NativeInputDevice) => (
                      <option key={device.id} value={device.id}>
                        {device.name}
                        {device.isDefault ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
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
                    <small>Tap to start or stop. Hold longer than 700 ms to record only while held.</small>
                  </span>
                  <button
                    className="release-command-button"
                    onClick={(event) => { captureHotkey(event, "dictationToggleHotkey"); }}
                    onContextMenu={(event) => { clearHotkey(event, "dictationToggleHotkey"); }}
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
                    <small>Can use the same key as Dictation for press-duration behavior.</small>
                  </span>
                  <button
                    className="release-command-button"
                    onClick={(event) => { captureHotkey(event, "dictationHoldHotkey"); }}
                    onContextMenu={(event) => { clearHotkey(event, "dictationHoldHotkey"); }}
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
                    onClick={(event) => { captureHotkey(event, "showWindowHotkey"); }}
                    onContextMenu={(event) => { clearHotkey(event, "showWindowHotkey"); }}
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
                    Hold{" "}
                    {state.settings.dictationHoldHotkey &&
                    state.settings.dictationHoldHotkey === state.settings.dictationToggleHotkey
                      ? "shared with dictation"
                      : state.hotkeys?.dictationHoldHotkey
                        ? "registered"
                        : "not registered"}
                  </ReleaseStatusBadge>
                  <ReleaseStatusBadge tone={state.hotkeys?.showWindowHotkey ? "ready" : "disabled"}>
                    Show window {state.hotkeys?.showWindowHotkey ? "registered" : "not registered"}
                  </ReleaseStatusBadge>
                </div>
              </div>
            </section>
          ) : null}

        {releaseTab === "models" ? (
          <section className="release-panel release-scroll-panel">
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
                    onClick={() => { setReleaseModelFilter(filter); }}
                    type="button"
                  >
                    {filter[0].toUpperCase() + filter.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="model-list">
              {releaseModels.map((model: LocalModel) => (
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
                      onClick={() => void updateSettings(exactLocalModelSettingsPatch(model.id))}
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
              {releaseSherpaModels.map((model: SherpaModel) => (
                <article className="model-row" key={model.id}>
                  <div>
                    <strong>{model.name}</strong>
                    <div className="release-chip-row">
                      <ReleaseChip>{model.language}</ReleaseChip>
                      <ReleaseChip>{model.sizeLabel}</ReleaseChip>
                      <ReleaseChip tone={model.status === "downloaded" ? "success" : "neutral"}>
                        {model.status === "downloaded" ? "Installed" : "Available"}
                      </ReleaseChip>
                    </div>
                    <small>{model.description}</small>
                  </div>
                  <div className="model-actions">
                    <button
                      className="release-secondary-button"
                      disabled={state.settings.dictationModeId === "local.parakeet"}
                      onClick={() => void updateSettings(dictationModeSettingsPatch("local.parakeet"))}
                      type="button"
                    >
                      {state.settings.dictationModeId === "local.parakeet" ? "Active" : "Use"}
                    </button>
                    <button
                      className="release-primary-button"
                      disabled={model.status === "downloaded" || Boolean(busyMessage)}
                      onClick={() => void downloadParakeetModel(model.id)}
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
                      onClick={() => void deleteParakeetModel(model.id)}
                      type="button"
                    >
                      {confirmingDeleteModelId === model.id ? "Confirm" : <Trash2 aria-hidden="true" className="release-icon-svg" />}
                    </button>
                  </div>
                </article>
              ))}
              {!releaseModels.length && !releaseSherpaModels.length ? <p className="empty-state">No models match this filter.</p> : null}
            </div>
            <label className="setting-row">
              <span>
                <strong>Parakeet decode-time hotword biasing (experimental)</strong>
                <small>
                  May occasionally produce empty or wrong results on Windows. Dictionary corrections
                  still apply regardless.
                </small>
                {!parakeetHotwordsAvailable ? (
                  <small>
                    Unavailable: this model build ships no bpe.vocab, which decode-time
                    biasing requires.
                  </small>
                ) : null}
              </span>
              <input
                checked={state.settings.parakeetHotwordsEnabled}
                disabled={!parakeetHotwordsAvailable}
                type="checkbox"
                onChange={(event) =>
                  void updateSettings({ parakeetHotwordsEnabled: event.target.checked })
                }
              />
            </label>
          </section>
        ) : null}

        <ReleaseProfilesSection {...props} />
        <ReleaseDictionarySection {...props} />
        {releaseTab === "history" ? (
          <section className="release-panel release-scroll-panel">
            <div className="release-panel-title">
              <ReleaseIcon name="history" decorative />
              <h2>Latest Transcriptions</h2>
            </div>
            <div className="history-list">
              {state.history.length ? (
                state.history.map((entry: TranscriptEntry) => (
                  <article className="history-row" key={entry.id}>
                    <div>
                      <strong>{formatTimestamp(entry.createdAt)}</strong>
                      <p>{entry.text}</p>
                      <small>
                        {entry.providerId === "openai" ? "Cloud Dictation" : "Local dictation"} · {entry.dictationModeId ?? "local.custom"} · {entry.modelId} · {formatDuration(entry.durationMs)}
                        {entry.languageHint ? ` · language ${entry.languageHint}` : " · language auto"}
                        {entry.turnCount ? ` · ${String(entry.turnCount)} turns` : ""}
                        {entry.turnStatus ? ` · ${entry.turnStatus}` : ""}
                        {entry.audioFileName ? " · audio saved" : ""}
                        {entry.audioUnavailableReason ? ` · ${entry.audioUnavailableReason}` : ""}
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
                        data-tooltip={entry.audioUnavailableReason ?? (playingTranscriptId === entry.id ? "Stop audio" : "Play audio")}
                        disabled={!entry.audioFileName}
                        onClick={() => void playTranscriptAudio(entry)}
                        type="button"
                      >
                        <Play aria-hidden="true" className="release-icon-svg" />
                      </button>
                      <button
                        aria-label="Retranscribe saved audio"
                        className="release-icon-button"
                        data-tooltip="Retranscribe"
                        disabled={!entry.audioFileName || Boolean(retranscribingTranscriptId)}
                        onClick={() => void transcribeSavedTranscript(entry)}
                        type="button"
                      >
                        <RefreshCw
                          aria-hidden="true"
                          className={
                            retranscribingTranscriptId === entry.id
                              ? "release-icon-svg spinning"
                              : "release-icon-svg"
                          }
                        />
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


