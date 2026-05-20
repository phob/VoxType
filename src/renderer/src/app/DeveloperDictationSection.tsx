import { type ReactElement } from "react";
import { type InsertionMode, type OcrTermMode, type RecorderCaptureMode, type RecordingCoordinationMode } from "../../../shared/settings";
import { formatBytes, formatTimestamp } from "./app-helpers";
import { type ReadyAppViewProps } from "./app-types";

export function DeveloperDictationSection(props: ReadyAppViewProps): ReactElement {
  const { activeModel, activeTab, appStatus, busyMessage, copyLatestTranscript, copyOcrRawText, copyOcrTerms, currentTarget, effectiveWhisperPrompt, generatedWhisperPrompt, insertionTestResult, lastRecordingResult, latestOcrContext, latestTranscript, pasteLatestTranscript, playingTranscriptId, playTranscriptAudio, recording, saveOcrTerm, startRecording, state, stopAndTranscribe, transcribeLatestTranscript, updateSettings } = props;
  return (
    <>
        {activeTab === "dictation" ? (
          <div className="dictation-layout">
            <section className="panel-block">
              <h2>control</h2>
              <div className="button-row">
                <button disabled={Boolean(busyMessage) || recording} onClick={() => void startRecording()} type="button">
                  Start
                </button>
                <button disabled={!recording} onClick={() => void stopAndTranscribe()} type="button">
                  Stop
                </button>
                <button disabled={!latestTranscript} onClick={() => void copyLatestTranscript()} type="button">
                  Copy
                </button>
                <button disabled={!latestTranscript} onClick={() => void pasteLatestTranscript()} type="button">
                  Insert
                </button>
              </div>
              <div className="form-grid compact">
                  <label className="checkbox-field">
                    <input
                      checked={state.settings.vadEnabled}
                      type="checkbox"
                      onChange={(event) => void updateSettings({ vadEnabled: event.target.checked })}
                    />
                    VAD
                  </label>
                  <label className="checkbox-field">
                    <input
                      checked={state.settings.autoMuteSystemAudio}
                      type="checkbox"
                      onChange={(event) =>
                        void updateSettings({ autoMuteSystemAudio: event.target.checked })
                      }
                    />
                    mute
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
                  <label className="dev-field">
                    <span>recordingCoordinationMode</span>
                    <select
                      value={state.settings.recordingCoordinationMode}
                      onChange={(event) =>
                        void updateSettings({
                          recordingCoordinationMode:
                            event.target.value as RecordingCoordinationMode
                        })
                      }
                    >
                      <option value="none">none</option>
                      <option value="sendHotkey">sendHotkey</option>
                    </select>
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
              </div>
            </section>

            <section className="panel-block">
              <h2>state</h2>
              <dl className="kv-grid">
                <dt>state</dt>
                <dd>{appStatus}</dd>
                <dt>model</dt>
                <dd>{activeModel?.id ?? "none"}</dd>
                <dt>runtime</dt>
                <dd>{state.runtime ? `${state.runtime.version} ${state.runtime.backend}` : "none"}</dd>
                <dt>helper</dt>
                <dd>{state.windowsHelper?.available ? "available" : "unavailable"}</dd>
                <dt>helperBuild</dt>
                <dd title={state.windowsHelper?.helperModifiedAt ?? undefined}>
                  {formatTimestamp(state.windowsHelper?.helperModifiedAt)}
                </dd>
                <dt>helperSize</dt>
                <dd>{formatBytes(state.windowsHelper?.helperSizeBytes)}</dd>
                <dt>captureMode</dt>
                <dd>{lastRecordingResult?.captureMode ?? state.settings.recorderCaptureMode}</dd>
                <dt>target</dt>
                <dd>{currentTarget?.processName ?? "none"}</dd>
                <dt>hwnd</dt>
                <dd>{currentTarget?.hwnd ?? "none"}</dd>
              </dl>
            </section>

            <section className="panel-block transcript-block">
              <h2>latestTranscript</h2>
              <pre>{latestTranscript?.text ?? "empty"}</pre>
              <dl className="kv-grid">
                <dt>dictionaryFixes</dt>
                <dd>{latestTranscript?.correctionsApplied?.length ?? 0}</dd>
                <dt>ocrFixes</dt>
                <dd>{latestTranscript?.ocrCorrectionsApplied?.length ?? 0}</dd>
              </dl>
              <pre>
                {[
                  ...(latestTranscript?.correctionsApplied ?? []).map((item: string) => `dictionary: ${item}`),
                  ...(latestTranscript?.ocrCorrectionsApplied ?? []).map((item: string) => `ocr: ${item}`)
                ].join("\n") || "no corrections"}
              </pre>
              {latestTranscript ? (
                <div className="button-row">
                  <button onClick={() => void copyLatestTranscript()} type="button">
                    Copy
                  </button>
                  <button onClick={() => void pasteLatestTranscript()} type="button">
                    Insert
                  </button>
                  <button
                    disabled={!latestTranscript.audioFileName || Boolean(busyMessage)}
                    onClick={() => void transcribeLatestTranscript()}
                    type="button"
                  >
                    Transcribe
                  </button>
                  <button
                    disabled={!latestTranscript.audioFileName}
                    onClick={() => void playTranscriptAudio(latestTranscript)}
                    type="button"
                  >
                    {playingTranscriptId === latestTranscript.id ? "Stop" : "Play"}
                  </button>
                </div>
              ) : null}
            </section>

            <section className="panel-block transcript-block">
              <h2>whisperPrompt</h2>
              <dl className="kv-grid">
                <dt>mode</dt>
                <dd>{state.settings.whisperPromptOverride.trim() ? "custom" : "default"}</dd>
                <dt>sent</dt>
                <dd>{latestTranscript?.promptContext ? "yes" : "none"}</dd>
              </dl>
              <textarea
                value={
                  state.settings.whisperPromptOverride
                    ? state.settings.whisperPromptOverride
                    : generatedWhisperPrompt
                }
                onChange={(event) => void updateSettings({ whisperPromptOverride: event.target.value })}
              />
              <div className="button-row">
                <button
                  disabled={!state.settings.whisperPromptOverride}
                  onClick={() => void updateSettings({ whisperPromptOverride: "" })}
                  type="button"
                >
                  Default
                </button>
              </div>
              <pre>{latestTranscript?.promptContext ?? (effectiveWhisperPrompt ? effectiveWhisperPrompt : "empty")}</pre>
            </section>

            <section className="panel-block">
              <h2>vad</h2>
              <dl className="kv-grid">
                <dt>enabled</dt>
                <dd>{String(lastRecordingResult?.vad.enabled ?? state.settings.vadEnabled)}</dd>
                <dt>speech</dt>
                <dd>{String(lastRecordingResult?.vad.speechDetected ?? false)}</dd>
                <dt>segments</dt>
                <dd>{lastRecordingResult?.vad.speechSegments ?? 0}</dd>
                <dt>originalMs</dt>
                <dd>{lastRecordingResult?.vad.originalDurationMs ?? 0}</dd>
                <dt>trimmedMs</dt>
                <dd>{lastRecordingResult?.vad.trimmedDurationMs ?? 0}</dd>
                <dt>removedMs</dt>
                <dd>{lastRecordingResult?.vad.removedDurationMs ?? 0}</dd>
              </dl>
            </section>

            <section className="panel-block transcript-block">
              <h2>ocrContext</h2>
              <dl className="kv-grid">
                <dt>engine</dt>
                <dd>{latestOcrContext?.engine ?? "none"}</dd>
                <dt>target</dt>
                <dd>{latestOcrContext?.processName ?? "none"}</dd>
                <dt>mode</dt>
                <dd>{latestOcrContext?.termMode ?? state.settings.ocrTermMode}</dd>
                <dt>lines</dt>
                <dd>{latestOcrContext?.lineCount ?? 0}</dd>
                <dt>rawChars</dt>
                <dd>{latestOcrContext?.rawText.length ?? 0}</dd>
                <dt>terms</dt>
                <dd>{latestOcrContext?.terms.length ?? 0}</dd>
                <dt>rejected</dt>
                <dd>{latestOcrContext?.rejectedTerms.length ?? 0}</dd>
              </dl>
              <label className="dev-field">
                <span>ocrTermMode</span>
                <select
                  value={state.settings.ocrTermMode}
                  onChange={(event) =>
                    void updateSettings({ ocrTermMode: event.target.value as OcrTermMode })
                  }
                >
                  <option value="strict">strict</option>
                  <option value="balanced">balanced</option>
                  <option value="broad">broad</option>
                </select>
              </label>
              <h2>ocrRawText</h2>
              <div className="button-row">
                <button disabled={!latestOcrContext?.rawText} onClick={() => void copyOcrRawText()} type="button">
                  CopyRaw
                </button>
                <button disabled={!latestOcrContext?.terms.length} onClick={() => void copyOcrTerms()} type="button">
                  CopyTerms
                </button>
              </div>
              <pre>{latestOcrContext?.rawText ?? "empty"}</pre>
              <h2>ocrTerms</h2>
              {latestOcrContext?.terms.length ? (
                <div className="ocr-term-list">
                  {latestOcrContext.terms.map((term: string) => (
                    <button
                      key={term}
                      onClick={() => void saveOcrTerm(term)}
                      type="button"
                      title="Save OCR term to dictionary"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              ) : (
                <pre>empty</pre>
              )}
              <h2>ocrRejected</h2>
              <pre>
                {latestOcrContext?.rejectedTerms.length
                  ? latestOcrContext.rejectedTerms.join(", ")
                  : "empty"}
              </pre>
            </section>

            <section className="panel-block log-block">
              <h2>events</h2>
              <pre>
                {[
                  `status=${appStatus}`,
                  `model=${activeModel?.id ?? "none"}`,
                  `target=${currentTarget?.processName ?? "none"}`,
                  `history=${String(state.history.length)}`,
                  `dictionary=${String(state.dictionary.length)}`,
                  latestOcrContext ? `ocrTerms=${String(latestOcrContext.terms.length)}` : null,
                  insertionTestResult ? `insertionTest=${insertionTestResult}` : null,
                  lastRecordingResult
                    ? `vad speech=${String(lastRecordingResult.vad.speechDetected)} trimmed=${String(lastRecordingResult.vad.removedDurationMs)}ms`
                    : null
                ]
                  .filter(Boolean)
                  .join("\n")}
              </pre>
            </section>
          </div>
        ) : null}

    </>
  );
}

