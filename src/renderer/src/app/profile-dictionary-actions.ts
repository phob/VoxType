import { type DictionaryEntry } from "../../../shared/dictionary";
import { type AppProfile, type InsertionMode } from "../../../shared/settings";
import { type TranscriptEntry } from "../../../shared/transcripts";
import {
  formatError,
  insertionModeLabel,
  normalizeProfileProcessName,
  splitMatches,
  wait
} from "./app-helpers";
import { type AppState } from "./app-state";
import {
  type AppProfilePatch,
  type ProfileDictionaryActionContext,
  type ProfileDictionaryActions
} from "./app-types";

export function useProfileDictionaryActions(
  ctx: ProfileDictionaryActionContext
): ProfileDictionaryActions {
  const { audioElementRef, audioObjectUrlRef, dictionaryAppProcess, dictionaryCategory, dictionaryMatches, dictionaryPreferred, editingDictionaryEntryId, fixLastText, insertionTarget, insertionTestText, latestOcrContext, latestScreenshot, latestTranscript, profileDeleteTimerRef, screenshotMode, selectedProfileProcessName, state, confirmingDeleteProfileProcessName, capturingProfileHotkey, playingTranscriptId, setBusyMessage, setCapturingProfileHotkey, setConfirmingDeleteProfileProcessName, setDictionaryAppProcess, setDictionaryCategory, setDictionaryMatches, setDictionaryModalOpen, setDictionaryPreferred, setEditingDictionaryEntryId, setError, setFixLastText, setInsertionTarget, setInsertionTestResult, setLatestOcrResult, setLatestScreenshot, setPlayingTranscriptId, setSelectedProfileProcessName, setState } = ctx;

  async function refreshActiveWindow(): Promise<void> {
    setError(null);

    try {
      const [windowsHelper, activeWindow] = await Promise.all([
        window.voxtype.windowsHelper.status(),
        window.voxtype.windowsHelper.activeWindow()
      ]);
      const settings = await window.voxtype.settings.get();

      setState((current: AppState) => ({ ...current, windowsHelper, activeWindow, settings }));
    } catch (activeWindowError) {
      const windowsHelper = await window.voxtype.windowsHelper.status();
      setState((current: AppState) => ({ ...current, windowsHelper }));
      setError(formatError(activeWindowError));
    }
  }

  async function addCurrentAppProfile(): Promise<void> {
    setError(null);
    setBusyMessage("Detecting current app...");

    try {
      const [windowsHelper, activeWindow] = await Promise.all([
        window.voxtype.windowsHelper.status(),
        window.voxtype.windowsHelper.activeWindow()
      ]);
      await window.voxtype.appProfiles.ensure(activeWindow);
      const settings = await window.voxtype.settings.get();
      setState((current: AppState) => ({ ...current, windowsHelper, activeWindow, settings }));
      setBusyMessage(`Added ${activeWindow.processName ?? "unknown process"}.`);
      window.setTimeout(() => { setBusyMessage(null); }, 1800);
    } catch (profileError) {
      setError(formatError(profileError));
      setBusyMessage(null);
    }
  }

  async function captureScreenshot(): Promise<void> {
    setError(null);
    setBusyMessage("Capturing screenshot...");

    try {
      const screenshot = await window.voxtype.windowsHelper.captureScreenshot(screenshotMode);
      setLatestScreenshot(screenshot);
      setLatestOcrResult(null);
    } catch (screenshotError) {
      setError(formatError(screenshotError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function recognizeLatestScreenshot(): Promise<void> {
    if (!latestScreenshot) {
      return;
    }

    setError(null);
    setBusyMessage("Running Windows OCR...");

    try {
      const ocrResult = await window.voxtype.ocr.recognizeScreenshot(
        latestScreenshot.path,
        latestScreenshot.mode
      );
      setLatestOcrResult(ocrResult);
    } catch (ocrError) {
      setError(formatError(ocrError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function captureInsertionTarget(): Promise<void> {
    setError(null);
    setInsertionTestResult("Switch to the target app now. Capturing in 2.5 seconds...");

    try {
      await wait(2500);
      const [windowsHelper, activeWindow] = await Promise.all([
        window.voxtype.windowsHelper.status(),
        window.voxtype.windowsHelper.activeWindow()
      ]);
      const settings = await window.voxtype.settings.get();

      setInsertionTarget(activeWindow);
      setState((current: AppState) => ({ ...current, windowsHelper, activeWindow, settings }));
      setInsertionTestResult(
        `Captured ${activeWindow.processName ?? "unknown process"} · ${
          activeWindow.title || "Untitled window"
        }`
      );
    } catch (captureError) {
      const windowsHelper = await window.voxtype.windowsHelper.status();
      setState((current: AppState) => ({ ...current, windowsHelper }));
      setError(formatError(captureError));
    }
  }

  function applyDetectedAppAsInsertionTarget(): Promise<void> {
    if (!state.activeWindow) {
      setError("Refresh or capture a target app before using it for insertion tests.");
      return Promise.resolve();
    }

    setInsertionTarget(state.activeWindow);
    setInsertionTestResult(
      `Using ${state.activeWindow.processName ?? "unknown process"} · ${
        state.activeWindow.title || "Untitled window"
      }`
    );
    return Promise.resolve();
  }

  async function runInsertionTest(mode: InsertionMode): Promise<void> {
    if (!insertionTarget) {
      setError("Capture a target app before running an insertion test.");
      return;
    }

    setError(null);
    setBusyMessage(`Testing ${insertionModeLabel(mode)}...`);

    try {
      await window.voxtype.insertion.testWindow(
        insertionTestText,
        insertionTarget.hwnd,
        mode,
        insertionTarget.processName
      );
      setInsertionTestResult(
        `Sent ${String(insertionTestText.length)} characters with ${insertionModeLabel(mode)}.`
      );
    } catch (testError) {
      setError(formatError(testError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function updateAppProfile(
    profile: AppProfile,
    patch: AppProfilePatch
  ): Promise<void> {
    const nextProfile = {
      insertionMode: patch.insertionMode ?? profile.insertionMode,
      writingStyle: patch.writingStyle ?? profile.writingStyle,
      recordingCoordinationMode:
        patch.recordingCoordinationMode ?? profile.recordingCoordinationMode,
      recordingStartHotkey: patch.recordingStartHotkey ?? profile.recordingStartHotkey,
      recordingStopHotkey: patch.recordingStopHotkey ?? profile.recordingStopHotkey,
      postTranscriptionHotkey:
        patch.postTranscriptionHotkey ?? profile.postTranscriptionHotkey,
      whisperLanguage: patch.whisperLanguage ?? profile.whisperLanguage,
      dictationModeId: patch.dictationModeId ?? profile.dictationModeId,
      forbidCloudDictation: patch.forbidCloudDictation ?? profile.forbidCloudDictation,
      cloudPromptPackOcrEnabled: patch.cloudPromptPackOcrEnabled ?? profile.cloudPromptPackOcrEnabled,
      neverSuspendDictationInFullscreen:
        patch.neverSuspendDictationInFullscreen ??
        profile.neverSuspendDictationInFullscreen
    };
    const settings = await window.voxtype.appProfiles.update(profile.processName, nextProfile);
    setState((current: AppState) => ({ ...current, settings }));
  }

  async function removeAppProfile(profile: AppProfile): Promise<void> {
    if (confirmingDeleteProfileProcessName !== profile.processName) {
      setConfirmingDeleteProfileProcessName(profile.processName);

      if (profileDeleteTimerRef.current !== null) {
        window.clearTimeout(profileDeleteTimerRef.current);
      }

      profileDeleteTimerRef.current = window.setTimeout(() => {
        setConfirmingDeleteProfileProcessName((current: string | null) =>
          current === profile.processName ? null : current
        );
        profileDeleteTimerRef.current = null;
      }, 3000);
      return;
    }

    setError(null);

    if (profileDeleteTimerRef.current !== null) {
      window.clearTimeout(profileDeleteTimerRef.current);
      profileDeleteTimerRef.current = null;
    }

    setBusyMessage("Removing profile...");

    try {
      const settings = await window.voxtype.appProfiles.remove(profile.processName);
      setState((current: AppState) => ({ ...current, settings }));
      setConfirmingDeleteProfileProcessName(null);

      if (selectedProfileProcessName === profile.processName) {
        setSelectedProfileProcessName(null);
      }

      if (capturingProfileHotkey === profile.processName) {
        setCapturingProfileHotkey(null);
      }
    } catch (profileError) {
      setError(formatError(profileError));
    } finally {
      setBusyMessage(null);
    }
  }

  function closeProfileModal(): void {
    setSelectedProfileProcessName(null);
    setCapturingProfileHotkey(null);
  }

  async function updateProfileHotkey(processName: string, accelerator: string): Promise<void> {
    const profile = state.settings?.appProfiles.find((item: AppProfile) => item.processName === processName);

    if (!profile) {
      return;
    }

    await updateAppProfile(profile, { postTranscriptionHotkey: accelerator });
  }

  async function sendProfilePostTranscriptionHotkey(
    processName: string | null | undefined
  ): Promise<void> {
    if (!processName) {
      return;
    }

    const normalizedProcess = normalizeProfileProcessName(processName);

    if (!normalizedProcess) {
      return;
    }

    const profile = state.settings?.appProfiles.find(
      (item: AppProfile) => item.processName === normalizedProcess
    );
    const hotkey = profile?.postTranscriptionHotkey.trim();

    if (!hotkey) {
      return;
    }

    await wait(120);
    await window.voxtype.windowsHelper.sendHotkey(hotkey);
  }

  function clearDictionaryForm(): void {
    setDictionaryPreferred("");
    setDictionaryMatches("");
    setDictionaryCategory("general");
    setDictionaryAppProcess("");
    setEditingDictionaryEntryId(null);
  }

  function selectDictionaryEntry(entry: DictionaryEntry): void {
    setDictionaryPreferred(entry.preferred);
    setDictionaryMatches(entry.matches.join("\n"));
    setDictionaryCategory(entry.category);
    setDictionaryAppProcess(entry.appProcessName ?? "");
    setEditingDictionaryEntryId(entry.id);
  }

  function openNewDictionaryModal(): void {
    clearDictionaryForm();
    setDictionaryModalOpen(true);
  }

  function openEditDictionaryModal(entry: DictionaryEntry): void {
    selectDictionaryEntry(entry);
    setDictionaryModalOpen(true);
  }

  function closeDictionaryModal(): void {
    setDictionaryModalOpen(false);
    clearDictionaryForm();
  }

  async function saveDictionaryEntryFromModal(): Promise<void> {
    const saved = await saveDictionaryEntry();
    if (saved) {
      setDictionaryModalOpen(false);
    }
  }

  async function saveDictionaryEntry(): Promise<boolean> {
    setError(null);

    try {
      const entryInput = {
        preferred: dictionaryPreferred,
        matches: splitMatches(dictionaryMatches),
        category: dictionaryCategory || "general",
        appProcessName: dictionaryAppProcess || null
      };
      const dictionary = editingDictionaryEntryId
        ? await window.voxtype.dictionary.update(editingDictionaryEntryId, entryInput)
        : await window.voxtype.dictionary.add({
            ...entryInput,
            source: "user"
          });
      setState((current: AppState) => ({ ...current, dictionary }));
      clearDictionaryForm();
      return true;
    } catch (dictionaryError) {
      setError(formatError(dictionaryError));
      return false;
    }
  }

  async function toggleDictionaryEntry(entry: DictionaryEntry): Promise<void> {
    const dictionary = await window.voxtype.dictionary.update(entry.id, {
      enabled: !entry.enabled
    });
    setState((current: AppState) => ({ ...current, dictionary }));
  }

  async function removeDictionaryEntry(entry: DictionaryEntry): Promise<void> {
    const dictionary = await window.voxtype.dictionary.remove(entry.id);
    setState((current: AppState) => ({ ...current, dictionary }));
    if (editingDictionaryEntryId === entry.id) {
      clearDictionaryForm();
    }
  }

  async function learnFixLastDictation(): Promise<void> {
    if (!latestTranscript || !fixLastText.trim()) {
      setError("Enter corrected text for the latest transcript before saving a correction.");
      return;
    }

    setError(null);

    try {
      const dictionary = await window.voxtype.dictionary.add({
        preferred: fixLastText,
        matches: [latestTranscript.text],
        category: "correction",
        source: "correction"
      });
      setState((current: AppState) => ({ ...current, dictionary }));
      setFixLastText("");
    } catch (dictionaryError) {
      setError(formatError(dictionaryError));
    }
  }

  async function saveOcrTerm(term: string): Promise<void> {
    const preferred = term.trim();

    if (!preferred) {
      return;
    }

    setError(null);

    try {
      const dictionary = await window.voxtype.dictionary.add({
        preferred,
        category: "ocr",
        appProcessName: latestOcrContext?.processName ?? null,
        source: "ocr"
      });
      setState((current: AppState) => ({ ...current, dictionary }));
    } catch (dictionaryError) {
      setError(formatError(dictionaryError));
    }
  }

  async function copyOcrRawText(): Promise<void> {
    if (!latestOcrContext?.rawText) {
      return;
    }

    await window.voxtype.insertion.copy(latestOcrContext.rawText);
    setBusyMessage("Copied raw OCR text.");
    window.setTimeout(() => { setBusyMessage(null); }, 1800);
  }

  async function copyOcrTerms(): Promise<void> {
    if (!latestOcrContext?.terms.length) {
      return;
    }

    await window.voxtype.insertion.copy(latestOcrContext.terms.join(", "));
    setBusyMessage("Copied OCR terms.");
    window.setTimeout(() => { setBusyMessage(null); }, 1800);
  }

  async function playTranscriptAudio(entry: TranscriptEntry): Promise<void> {
    setError(null);

    try {
      if (playingTranscriptId === entry.id) {
        stopTranscriptAudio();
        return;
      }

      stopTranscriptAudio();

      const audioBytes = await window.voxtype.history.audio(entry.id);
      const audioCopy = new Uint8Array(audioBytes.byteLength);
      audioCopy.set(audioBytes);
      const blob = new Blob([audioCopy.buffer], { type: "audio/wav" });
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);

      audioElementRef.current = audio;
      audioObjectUrlRef.current = objectUrl;
      setPlayingTranscriptId(entry.id);

      audio.addEventListener(
        "ended",
        () => {
          stopTranscriptAudio();
        },
        { once: true }
      );
      audio.addEventListener(
        "error",
        () => {
          setError("Could not play the saved transcript audio.");
          stopTranscriptAudio();
        },
        { once: true }
      );

      await audio.play();
    } catch (audioError) {
      stopTranscriptAudio();
      setError(formatError(audioError));
    }
  }

  function stopTranscriptAudio(): void {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current = null;
    }

    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }

    setPlayingTranscriptId(null);
  }


  return { 
refreshActiveWindow, addCurrentAppProfile, captureScreenshot, recognizeLatestScreenshot, captureInsertionTarget, applyDetectedAppAsInsertionTarget, runInsertionTest, updateAppProfile, removeAppProfile, closeProfileModal, updateProfileHotkey, sendProfilePostTranscriptionHotkey, clearDictionaryForm, selectDictionaryEntry, openNewDictionaryModal, openEditDictionaryModal, closeDictionaryModal, saveDictionaryEntryFromModal, saveDictionaryEntry, toggleDictionaryEntry, removeDictionaryEntry, learnFixLastDictation, saveOcrTerm, copyOcrRawText, copyOcrTerms, playTranscriptAudio, stopTranscriptAudio
 };
}



