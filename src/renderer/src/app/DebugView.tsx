import { type ReactElement } from "react";
import { type AppProfile, type InsertionMode, type ProfileWhisperLanguage, type WhisperRuntimePreference } from "../../../shared/settings";
import { type DictionaryEntry } from "../../../shared/dictionary";
import { type GpuDevice } from "../../../shared/hardware";
import { type LocalModel } from "../../../shared/models";
import { type OcrTextLine } from "../../../shared/ocr";
import { type WhisperRuntime } from "../../../shared/runtimes";
import {
  WindowTitleBar,
  formatVram,
  gpuFitLabel,
  pngBytesToDataUrl,
} from "./app-helpers";
import { debugTabs, profileWhisperLanguageOptions } from "./app-options";
import { DebugDictationSection } from "./DebugDictationSection";
import { DebugSettingsSection } from "./DebugSettingsSection";
import { type ReadyAppViewProps } from "./app-types";

export function DebugView(props: ReadyAppViewProps): ReactElement {
  const { activeModel, activeTab, appStatus, applyDetectedAppAsInsertionTarget, busyMessage, captureInsertionTarget, captureScreenshot, clearDictionaryForm, confirmingDeleteModelId, currentTarget, deleteModel, dictionaryAppProcess, dictionaryCategory, dictionaryMatches, dictionaryPreferred, downloadModel, editingDictionaryEntryId, error, exactLocalModelSettingsPatch, fixLastText, insertionTarget, insertionTestResult, insertionTestText, installRuntime, installSpecificRuntime, latestOcrResult, latestScreenshot, latestTranscript, learnFixLastDictation, recognizeLatestScreenshot, recording, refreshActiveWindow, refreshHardware, removeDictionaryEntry, runInsertionTest, saveDictionaryEntry, screenshotMode, selectDictionaryEntry, setActiveTab, setDictionaryAppProcess, setDictionaryCategory, setDictionaryMatches, setDictionaryPreferred, setFixLastText, setInsertionTestText, setScreenshotMode, setupFirstRunCuda, startRecording, state, stopAndTranscribe, toggleDictionaryEntry, updateAppProfile, updateSettings, version } = props;
  return (
    <main className="dev-shell">
      <WindowTitleBar title="VoxType Debug" />
      <header className="dev-toolbar">
        <div className="app-title">VoxType Debug</div>
        <div className="toolbar-status">
          <span className={recording ? "status-dot status-dot-recording" : "status-dot"} />
          <code>{appStatus}</code>
        </div>
        <select
          value={state.settings.activeModelId}
          onChange={(event) => void updateSettings(exactLocalModelSettingsPatch(event.target.value))}
        >
          <option value="">model</option>
          {state.models.map((model: LocalModel) => (
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
        <code className="toolbar-code">{state.settings.dictationToggleHotkey || "hotkey:none"}</code>
        <button onClick={() => void refreshActiveWindow()} type="button">
          Refresh
        </button>
        <button onClick={() => void updateSettings({ debugViewEnabled: false })} type="button">
          ExitDebug
        </button>
      </header>

      {error ? (
        <div className="inline-error">
          <code>error</code>
          <span>{error}</span>
        </div>
      ) : null}

      <nav className="dev-tabs" aria-label="Debug tabs">
        {debugTabs.map((tab) => (
          <button
            className={activeTab === tab.id ? "active" : ""}
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); }}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="dev-panel">
        <DebugDictationSection {...props} />
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
                  {state.models.map((model: LocalModel) => (
                    <tr key={model.id}>
                      <td><code>{model.id}</code></td>
                      <td>{model.name}</td>
                      <td>{model.sizeLabel}</td>
                      <td>{gpuFitLabel(state.hardware, model.id)}</td>
                      <td>{state.settings.activeModelId === model.id ? "selected" : model.status}</td>
                      <td><code>{model.localPath}</code></td>
                      <td>
                        <div className="table-actions">
                          <button onClick={() => void updateSettings(exactLocalModelSettingsPatch(model.id))} type="button">
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
                <dd>{state.settings.whisperRuntimeBackend}</dd>
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
                  {(state.hardware?.gpus ?? []).map((gpu: GpuDevice) => (
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
                  {state.runtimes.map((runtime: WhisperRuntime) => (
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
                <button disabled={!state.activeWindow} onClick={() => void applyDetectedAppAsInsertionTarget()} type="button">
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
              <textarea value={insertionTestText} onChange={(event) => { setInsertionTestText(event.target.value); }} />
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
                {state.settings.appProfiles.length ? (
                    state.settings.appProfiles.map((profile: AppProfile) => (
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
                  <input value={dictionaryPreferred} onChange={(event) => { setDictionaryPreferred(event.target.value); }} />
                </label>
                <label className="dev-field">
                  <span>matches</span>
                  <textarea value={dictionaryMatches} onChange={(event) => { setDictionaryMatches(event.target.value); }} />
                </label>
                <label className="dev-field">
                  <span>category</span>
                  <input value={dictionaryCategory} onChange={(event) => { setDictionaryCategory(event.target.value); }} />
                </label>
                <label className="dev-field">
                  <span>scope</span>
                  <select value={dictionaryAppProcess} onChange={(event) => { setDictionaryAppProcess(event.target.value); }}>
                    <option value="">all</option>
                    {state.settings.appProfiles.map((profile: AppProfile) => (
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
                onChange={(event) => { setFixLastText(event.target.value); }}
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
                    state.dictionary.map((entry: DictionaryEntry) => (
                      <tr
                        className={editingDictionaryEntryId === entry.id ? "selected-row" : undefined}
                        key={entry.id}
                        onClick={() => { selectDictionaryEntry(entry); }}
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
                      { setScreenshotMode(event.target.value); }
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
              <pre>{latestOcrResult?.text ?? "empty"}</pre>
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
                    latestOcrResult.lines.map((line: OcrTextLine, index: number) => (
                      <tr key={`${line.text}-${String(index)}`}>
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

        <DebugSettingsSection {...props} />
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

