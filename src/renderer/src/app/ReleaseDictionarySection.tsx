import { type ReactElement } from "react";
import { ArrowRight, Check, CheckCircle2, Clipboard, Download, FileText, MoreVertical, Play, Plus, RefreshCw, Trash2, UserPlus, X } from "lucide-react";
import { dictationModes } from "../../../shared/asr";
import { cloudDictationConsentExclusions, cloudDictationConsentOfflineNotice, cloudDictationConsentSummary } from "../../../shared/cloud-consent-copy";
import { currentCloudReleaseSmokeTestChecklist, formatCloudReleaseSmokeTestStatus } from "../../../shared/cloud-release-smoke-test";
import { currentOpenAiModeImplementationReadiness } from "../../../shared/openai-readiness";
import { PROMPT_PACK_MAX_CHARS, PROMPT_PACK_MAX_TERMS } from "../../../shared/prompt-pack-limits";
import { type DictionaryEntry } from "../../../shared/dictionary";
import { type AppProfile } from "../../../shared/settings";
import { ReleaseChip, ReleaseIcon, ReleaseSelect, ReleaseStatusBadge, appHotkeyEntries, formatBytes, formatDuration, formatRelativeTimestamp, formatTimestamp, gpuFitLabel, insertionModeLabel, profileWhisperLanguageLabel, recordingInputDeviceLabel, writingStyleLabel } from "./app-helpers";

export function ReleaseDictionarySection(props: Record<string, any>): ReactElement {
  const { closeDictionaryModal, dictionaryAppProcess, dictionaryCategory, dictionaryMatches, dictionaryModalOpen, dictionaryPreferred, editingDictionaryEntryId, latestOcrContext, openEditDictionaryModal, openNewDictionaryModal, releaseTab, removeDictionaryEntry, savedDictionaryTerms, saveDictionaryEntryFromModal, saveOcrTerm, setDictionaryAppProcess, setDictionaryCategory, setDictionaryMatches, setDictionaryPreferred, state, toggleDictionaryEntry } = props;
  return (
    <>
        {releaseTab === "dictionary" ? (
          <div className="release-dictionary-layout">
            <section className="release-panel release-dictionary-list-panel">
              <div className="release-panel-heading">
                <div className="release-panel-title">
                  <ReleaseIcon name="book" decorative />
                  <h2>Saved Entries</h2>
                </div>
                <div className="release-panel-actions">
                  <ReleaseChip>{state.dictionary.length}</ReleaseChip>
                  <button className="release-primary-button" onClick={openNewDictionaryModal} type="button">
                    <Plus aria-hidden="true" className="release-icon-svg" />
                    Add Entry
                  </button>
                </div>
              </div>

              <div className="dictionary-entry-list">
                {state.dictionary.length ? (
                  state.dictionary.map((entry: DictionaryEntry) => (
                    <article
                      className={
                        editingDictionaryEntryId === entry.id
                          ? "dictionary-entry-row selected"
                          : "dictionary-entry-row"
                      }
                      key={entry.id}
                    >
                      <button
                        className="dictionary-entry-main"
                        onClick={() => openEditDictionaryModal(entry)}
                        type="button"
                      >
                        <strong>{entry.preferred}</strong>
                        <span>
                          {entry.category} · {entry.source} · {entry.appProcessName ?? "all apps"}
                        </span>
                      </button>
                      <div className="dictionary-entry-actions">
                        <button
                          className="release-secondary-button"
                          onClick={() => void toggleDictionaryEntry(entry)}
                          type="button"
                        >
                          {entry.enabled ? "On" : "Off"}
                        </button>
                        <button
                          aria-label={`Delete ${entry.preferred}`}
                          className="release-icon-button"
                          data-tooltip="Delete"
                          onClick={() => void removeDictionaryEntry(entry)}
                          type="button"
                        >
                          <Trash2 aria-hidden="true" className="release-icon-svg" />
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="empty-state">No dictionary entries yet.</p>
                )}
              </div>
            </section>

            <section className="release-panel release-ocr-terms-panel">
              <div className="section-title-row">
                <div className="release-panel-title">
                  <ReleaseIcon name="file" decorative />
                  <h2>Latest OCR Terms</h2>
                </div>
                <ReleaseChip tone={latestOcrContext?.terms.length ? "accent" : "neutral"}>
                  {latestOcrContext?.terms.length ?? 0}
                </ReleaseChip>
              </div>
              {latestOcrContext?.terms.length ? (
                <div className="release-ocr-term-list">
                  {latestOcrContext.terms.map((term: string) => {
                    const saved = savedDictionaryTerms.has(term.trim().toLowerCase());

                    return (
                      <button
                        className={saved ? "saved" : ""}
                        disabled={saved}
                        key={term}
                        onClick={() => void saveOcrTerm(term)}
                        title={saved ? "Already in dictionary" : "Add to dictionary"}
                        type="button"
                      >
                        {saved ? <Check aria-hidden="true" className="release-icon-svg" /> : null}
                        <span>{term}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="empty-state">No OCR terms captured yet.</p>
              )}
            </section>

            {dictionaryModalOpen ? (
              <div
                aria-modal="true"
                className="release-modal-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    closeDictionaryModal();
                  }
                }}
                role="dialog"
              >
                <section className="release-modal">
                  <div className="release-modal-header">
                    <div className="release-panel-title">
                      <ReleaseIcon name="book" decorative />
                      <h2>{editingDictionaryEntryId ? "Edit Entry" : "Add Entry"}</h2>
                    </div>
                    <button
                      aria-label="Close dictionary entry"
                      className="release-icon-button"
                      data-tooltip="Close"
                      onClick={closeDictionaryModal}
                      type="button"
                    >
                      <X aria-hidden="true" className="release-icon-svg" />
                    </button>
                  </div>

                  <div className="release-form-grid">
                    <label className="release-field">
                      <span>Word or phrase</span>
                      <input
                        autoFocus
                        value={dictionaryPreferred}
                        onChange={(event) => setDictionaryPreferred(event.target.value)}
                      />
                    </label>
                    <label className="release-field">
                      <span>Misheard as</span>
                      <textarea
                        rows={2}
                        value={dictionaryMatches}
                        onChange={(event) => setDictionaryMatches(event.target.value)}
                      />
                    </label>
                    <div className="release-form-split">
                      <label className="release-field">
                        <span>Category</span>
                        <input
                          value={dictionaryCategory}
                          onChange={(event) => setDictionaryCategory(event.target.value)}
                        />
                      </label>
                      <label className="release-field">
                        <span>Scope</span>
                        <select
                          value={dictionaryAppProcess}
                          onChange={(event) => setDictionaryAppProcess(event.target.value)}
                        >
                          <option value="">All apps</option>
                          {state.settings.appProfiles.map((profile: AppProfile) => (
                            <option key={profile.id} value={profile.processName}>
                              {profile.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="release-form-actions">
                    <button className="release-secondary-button" onClick={closeDictionaryModal} type="button">
                      Cancel
                    </button>
                    <button
                      className="release-primary-button"
                      disabled={!dictionaryPreferred.trim()}
                      onClick={() => void saveDictionaryEntryFromModal()}
                      type="button"
                    >
                      {editingDictionaryEntryId ? "Update" : "Add"}
                    </button>
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        ) : null}

    </>
  );
}

