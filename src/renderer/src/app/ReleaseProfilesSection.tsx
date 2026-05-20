import { type ReactElement } from "react";
import { Trash2, UserPlus, X } from "lucide-react";
import { type AppProfile } from "../../../shared/settings";
import { ReleaseIcon, ReleaseSelect, insertionModeLabel, profileWhisperLanguageLabel, writingStyleLabel } from "./app-helpers";
import {
  insertionModeOptions,
  profileCloudPromptPackOcrOptions,
  profileDictationModeOptions,
  profileWhisperLanguageOptions,
  writingStyleOptions
} from "./app-options";
import { type ReadyAppViewProps } from "./app-types";

export function ReleaseProfilesSection(props: ReadyAppViewProps): ReactElement {
  const { addCurrentAppProfile, busyMessage, capturingProfileHotkey, closeProfileModal, confirmingDeleteProfileProcessName, currentProfileProcessName, releaseTab, removeAppProfile, selectedProfile, setCapturingProfileHotkey, setSelectedProfileProcessName, state, updateAppProfile } = props;
  return (
    <>
        {releaseTab === "profiles" ? (
          <section className="release-panel release-scroll-panel">
            <div className="release-panel-heading">
              <div className="release-panel-title">
                <ReleaseIcon name="user" decorative />
                <h2>App Profiles</h2>
              </div>
              <button
                className="release-primary-button"
                disabled={Boolean(busyMessage)}
                onClick={() => void addCurrentAppProfile()}
                type="button"
              >
                <UserPlus aria-hidden="true" className="release-icon-svg" />
                Add current app
              </button>
            </div>
            <div className="profile-list">
              {state.settings.appProfiles.length ? (
                state.settings.appProfiles.map((profile: AppProfile) => (
                  <article className="profile-row" key={profile.id}>
                    <button
                      className="profile-row-main"
                      onClick={() => { setSelectedProfileProcessName(profile.processName); }}
                      type="button"
                      aria-label={`Open ${profile.displayName} profile settings`}
                    >
                      <span className="profile-row-top">
              <span className="profile-heading">
              <strong>{profile.displayName}</strong>
            </span>
            {profile.processName === currentProfileProcessName ? (
              <span className="profile-current-badge">Current app</span>
            ) : null}
                      </span>
                      <span className="profile-summary">
                        <span>
                          <small>Insert</small>
                          {insertionModeLabel(profile.insertionMode)}
                        </span>
                        <span>
                          <small>Style</small>
                          {writingStyleLabel(profile.writingStyle)}
                        </span>
                        <span>
                          <small>Language</small>
                          {profileWhisperLanguageLabel(profile.whisperLanguage)}
                        </span>
                        <span>
                          <small>Send key</small>
                          {profile.postTranscriptionHotkey || "None"}
                        </span>
                        {state.settings.suspendDictationHotkeysInFullscreenApps &&
                        profile.neverSuspendDictationInFullscreen ? (
                          <span>
                            <small>Fullscreen</small>
                            Keep hotkeys
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <button
                      aria-label={
                        confirmingDeleteProfileProcessName === profile.processName
                          ? `Confirm remove ${profile.displayName} profile`
                          : `Remove ${profile.displayName} profile`
                      }
                      className={
                        confirmingDeleteProfileProcessName === profile.processName
                          ? "release-destructive-button"
                          : "release-icon-button"
                      }
                      data-tooltip={
                        confirmingDeleteProfileProcessName === profile.processName
                          ? "Confirm remove"
                          : "Remove profile"
                      }
                      disabled={Boolean(busyMessage)}
                      onClick={() => void removeAppProfile(profile)}
                      type="button"
                    >
                      {confirmingDeleteProfileProcessName === profile.processName ? (
                        "Confirm"
                      ) : (
                        <Trash2 aria-hidden="true" className="release-icon-svg" />
                      )}
                    </button>
                  </article>
                ))
              ) : (
                <p className="empty-state">
                  Add an app profile to tune insertion, writing style, language, and send keys for the app
                  you are using.
                </p>
              )}
            </div>

            {selectedProfile ? (
              <div
                aria-modal="true"
                className="release-modal-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    closeProfileModal();
                  }
                }}
                role="dialog"
              >
                <section className="release-modal profile-modal">
                  <div className="release-modal-header">
                    <div className="release-panel-title">
                      <ReleaseIcon name="user" decorative />
                      <h2>{selectedProfile.displayName}</h2>
                    </div>
                    <button
                      aria-label="Close profile settings"
                      className="release-icon-button"
                      data-tooltip="Close"
                      onClick={closeProfileModal}
                      type="button"
                    >
                      <X aria-hidden="true" className="release-icon-svg" />
                    </button>
                  </div>

                  <div className="release-form-grid">
                    <div className="release-field">
                      <span>Insert with</span>
                      <ReleaseSelect
                        ariaLabel={`Insertion mode for ${selectedProfile.displayName}`}
                        options={insertionModeOptions}
                        value={selectedProfile.insertionMode}
                        onChange={(value) =>
                          void updateAppProfile(selectedProfile, {
                            insertionMode: value
                          })
                        }
                      />
                    </div>
                    <div className="release-field">
                      <span>Writing style</span>
                      <ReleaseSelect
                        ariaLabel={`Writing style for ${selectedProfile.displayName}`}
                        options={writingStyleOptions}
                        value={selectedProfile.writingStyle}
                        onChange={(value) =>
                          void updateAppProfile(selectedProfile, {
                            writingStyle: value
                          })
                        }
                      />
                    </div>
                    <div className="release-field">
                      <span>Language</span>
                      <ReleaseSelect
                        ariaLabel={`Language for ${selectedProfile.displayName}`}
                        options={profileWhisperLanguageOptions}
                        value={selectedProfile.whisperLanguage}
                        onChange={(value) =>
                          void updateAppProfile(selectedProfile, {
                            whisperLanguage: value
                          })
                        }
                      />
                    </div>
                    <div className="release-field">
                      <span>Dictation Mode</span>
                      <ReleaseSelect
                        ariaLabel={`Dictation Mode for ${selectedProfile.displayName}`}
                        options={profileDictationModeOptions}
                        value={selectedProfile.dictationModeId}
                        onChange={(value) =>
                          void updateAppProfile(selectedProfile, {
                            dictationModeId: value
                          })
                        }
                      />
                    </div>
                    <label className="setting-row">
                      <span>
                        <strong>Forbid Cloud Dictation</strong>
                        <small>Use this for sensitive apps; cloud modes will be blocked here.</small>
                      </span>
                      <input
                        checked={selectedProfile.forbidCloudDictation}
                        type="checkbox"
                        onChange={(event) =>
                          void updateAppProfile(selectedProfile, {
                            forbidCloudDictation: event.target.checked
                          })
                        }
                      />
                    </label>
                    <div className="release-field">
                      <span>Cloud Prompt Pack OCR</span>
                      <ReleaseSelect
                        ariaLabel={`Cloud Prompt Pack OCR for ${selectedProfile.displayName}`}
                        options={profileCloudPromptPackOcrOptions}
                        value={selectedProfile.cloudPromptPackOcrEnabled}
                        onChange={(value) =>
                          void updateAppProfile(selectedProfile, {
                            cloudPromptPackOcrEnabled: value
                          })
                        }
                      />
                    </div>
                    <div className="release-field">
                      <span>Send after insert</span>
                      <button
                        className="release-command-button"
                        onClick={() => { setCapturingProfileHotkey(selectedProfile.processName); }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          void updateAppProfile(selectedProfile, { postTranscriptionHotkey: "" });
                        }}
                        title="Click to capture a hotkey. Press Escape while capturing or right-click to clear."
                        type="button"
                      >
                        {capturingProfileHotkey === selectedProfile.processName
                          ? "Press keys..."
                          : selectedProfile.postTranscriptionHotkey || "None"}
                      </button>
                    </div>
                    {state.settings.suspendDictationHotkeysInFullscreenApps ? (
                      <label className="setting-row">
                        <span>
                          <strong>Never suspend in fullscreen</strong>
                          <small>Keep dictation hotkeys active for this app.</small>
                        </span>
                        <input
                          checked={selectedProfile.neverSuspendDictationInFullscreen}
                          type="checkbox"
                          onChange={(event) =>
                            void updateAppProfile(selectedProfile, {
                              neverSuspendDictationInFullscreen: event.target.checked
                            })
                          }
                        />
                      </label>
                    ) : null}
                  </div>

                  <div className="release-form-actions">
                    <button
                      className="release-destructive-button"
                      disabled={Boolean(busyMessage)}
                      onClick={() => void removeAppProfile(selectedProfile)}
                      type="button"
                    >
                      {confirmingDeleteProfileProcessName === selectedProfile.processName ? (
                        "Confirm remove"
                      ) : (
                        <>
                          <Trash2 aria-hidden="true" className="release-icon-svg" />
                          Remove
                        </>
                      )}
                    </button>
                    <button className="release-primary-button" onClick={closeProfileModal} type="button">
                      Done
                    </button>
                  </div>
                </section>
              </div>
            ) : null}
          </section>
        ) : null}

    </>
  );
}

