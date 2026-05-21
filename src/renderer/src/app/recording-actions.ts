import { startNativePcmRecorder } from "../audio-recorder";
import { getDictationMode, type DictationModeId } from "../../../shared/asr";
import { type AppSettings } from "../../../shared/settings";
import { type TranscriptEntry } from "../../../shared/transcripts";
import { type ActiveWindowInfo, type DictationHotkeyPayload } from "../../../shared/windows-helper";
import { type OcrPromptContext } from "../../../shared/ocr-context";
import {
  formatError,
  joinErrors,
  normalizeProfileProcessName,
  playRecordingCue,
  wait
} from "./app-helpers";
import { type AppState } from "./app-state";
import { type RecordingActionContext, type RecordingActions } from "./app-types";

export function useRecordingActions(ctx: RecordingActionContext): RecordingActions {
  const { currentTarget, hotkeyOcrContextRef, hotkeySessionIdRef, hotkeyTargetRef, latestOcrContext, latestTranscript, recorderRef, recording, recordingStopHotkeyRef, state, systemAudioMutedByVoxTypeRef, setBusyMessage, setError, setInsertionTestResult, setLastRecordingResult, setLatestOcrContext, setRecording, setRetranscribingTranscriptId, setState, clearCloudSessionLimitTimer, startCloudSessionLimitTimer } = ctx;

  async function startRecording(): Promise<void> {
    setError(null);

    const readiness = await window.voxtype.transcription.getReadiness(
      hotkeyTargetRef.current?.processName ?? state.activeWindow?.processName
    );

    if (!readiness.ready) {
      setError(readiness.reason ?? "Dictation is not ready.");
      return;
    }

    const readinessMode = getDictationMode(readiness.modeId);
    const readinessLocalModel = state.models.find((model: AppState["models"][number]) => model.id === readinessMode.modelId);

    if (!readiness.cloud && readinessLocalModel?.status !== "downloaded") {
      setError(`Download ${readinessMode.label} (${readinessMode.modelId}) before recording.`);
      return;
    }

    if (readiness.fallbackModeId && readiness.reason) {
      const fallbackMode = getDictationMode(readiness.fallbackModeId);
      setBusyMessage(`${readiness.reason} Fallback mode: ${fallbackMode.label}.`);
    }

    try {
      await window.voxtype.recordingOverlay.showRecording(
        readiness.cloud
          ? {
              cloudProviderLabel: "Cloud Dictation",
              elapsedMs: 0,
              message: "Cloud Dictation 0:00"
            }
          : undefined
      );
      await playRecordingCue("start");

      if (state.settings?.autoMuteSystemAudio) {
        await window.voxtype.windowsHelper.setSystemMute(true);
        systemAudioMutedByVoxTypeRef.current = true;
      }

      recorderRef.current = await startNativePcmRecorder(state.settings, {
        realtimePcm16Enabled: readiness.modeId === "openai.realtime"
      });

      if (readiness.modeId === "openai.realtime") {
        await window.voxtype.transcription.startRealtime({
          processName: hotkeyTargetRef.current?.processName ?? state.activeWindow?.processName,
          ocrContext: hotkeyOcrContextRef.current
        });
      }

      await startRecordingCoordination(state.settings);
      if (state.settings) {
        startCloudSessionLimitTimer(state.settings, readiness.modeId);
      }
      setRecording(true);
    } catch (recordingError) {
      await window.voxtype.recordingOverlay.hide();
      const recorder = recorderRef.current;
      recorderRef.current = null;
      const recorderStopError = recorder
        ? await recorder.stop().then(
            () => null,
            (stopError: unknown) => formatError(stopError)
          )
        : null;
      if (readinessMode.id === "openai.realtime") {
        await window.voxtype.transcription.cancelRealtime("Realtime Cloud Dictation failed to start.").catch(() => undefined);
      }
      const coordinationError = await stopRecordingCoordination();
      const unmuteError = await unmuteSystemAudio();
      setError(
        joinErrors(
          joinErrors(joinErrors(formatError(recordingError), recorderStopError), coordinationError),
          unmuteError
        )
      );
    }
  }

  async function installSpecificRuntime(runtimeId: string): Promise<void> {
    setError(null);
    setBusyMessage("Installing whisper.cpp runtime...");

    try {
      const runtime = await window.voxtype.runtime.installWhisperRuntime(runtimeId);
      const runtimes = await window.voxtype.runtime.listWhisper();
      setState((current: AppState) => ({ ...current, runtime, runtimes }));
    } catch (runtimeError) {
      setError(formatError(runtimeError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function setupFirstRunCuda(): Promise<void> {
    setError(null);
    setBusyMessage("Setting up CUDA runtime...");

    try {
      const result = await window.voxtype.runtime.setupFirstRunCuda();
      const runtimes = await window.voxtype.runtime.listWhisper();
      setState((current: AppState) => ({
        ...current,
        runtime: result.runtime,
        runtimes,
        settings: result.settings,
        hardware: result.hardware
      }));
      setInsertionTestResult(result.message);
    } catch (runtimeError) {
      setError(formatError(runtimeError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function refreshHardware(): Promise<void> {
    setError(null);

    try {
      const hardware = await window.voxtype.hardware.getAccelerationReport();
      setState((current: AppState) => ({ ...current, hardware }));
    } catch (hardwareError) {
      setError(formatError(hardwareError));
    }
  }

  async function handleHotkeyStart(payload: DictationHotkeyPayload): Promise<void> {
    if (recording || recorderRef.current) {
      if (hotkeySessionIdRef.current === payload.sessionId && payload.ocrContext) {
        hotkeyOcrContextRef.current = payload.ocrContext;
        setLatestOcrContext(payload.ocrContext);
      }

      return;
    }

    hotkeySessionIdRef.current = payload.sessionId;
    hotkeyTargetRef.current = payload.target;
    hotkeyOcrContextRef.current = payload.ocrContext;
    setLatestOcrContext(payload.ocrContext);
    const settings = await window.voxtype.settings.get();
    setState((current: AppState) => ({
      ...current,
      activeWindow: payload.target,
      settings
    }));
    await startRecording();
  }

  async function handleHotkeyStop(payload: DictationHotkeyPayload): Promise<void> {
    if (payload.target) {
      hotkeyTargetRef.current = payload.target;
    }

    if (payload.ocrContext) {
      hotkeyOcrContextRef.current = payload.ocrContext;
      setLatestOcrContext(payload.ocrContext);
    }

    await stopAndTranscribe({
      pasteTarget: hotkeyTargetRef.current,
      ocrContext: hotkeyOcrContextRef.current
    });
    await window.voxtype.dictation.setHotkeyRecording(false);
    hotkeyTargetRef.current = null;
    hotkeyOcrContextRef.current = null;
    hotkeySessionIdRef.current = null;
  }

  async function stopAndTranscribe(options?: {
    pasteTarget?: ActiveWindowInfo | null;
    ocrContext?: OcrPromptContext | null;
  }): Promise<void> {
    if (!recorderRef.current) {
      return;
    }

    clearCloudSessionLimitTimer();
    setRecording(false);
    let stopReadinessModeId: DictationModeId | null = null;

    try {
      void window.voxtype.diagnostics.logRealtimeTiming("renderer stop recording requested", {
        rendererMonotonicMs: Math.round(performance.now())
      });
      const recordingResult = await recorderRef.current.stop();
      void window.voxtype.diagnostics.logRealtimeTiming("native recorder stopped", {
        rendererMonotonicMs: Math.round(performance.now()),
        recordingByteCount: recordingResult.wavBytes.byteLength,
        originalDurationMs: recordingResult.vad.originalDurationMs,
        trimmedDurationMs: recordingResult.vad.trimmedDurationMs
      });
      recorderRef.current = null;
      const readiness = await window.voxtype.transcription.getReadiness(
        options?.pasteTarget?.processName ?? hotkeyTargetRef.current?.processName
      );
      stopReadinessModeId = readiness.modeId;
      setBusyMessage(
        readiness.modeId === "openai.realtime"
          ? "Finalizing realtime cloud dictation..."
          : readiness.cloud
            ? "Transcribing with OpenAI..."
            : "Transcribing locally..."
      );
      if (readiness.modeId !== "openai.realtime") {
        await window.voxtype.recordingOverlay.showTranscribing({
          cloudProviderLabel: readiness.cloud ? "Cloud Dictation" : undefined,
          message: readiness.cloud ? "Transcribing with OpenAI" : "Transcribing locally"
        });
      }
      const coordinationError = await stopRecordingCoordination();
      const unmuteError = await unmuteSystemAudio();
      await playRecordingCue("stop");
      setLastRecordingResult(recordingResult);

      if (recordingResult.vad.enabled && !recordingResult.vad.speechDetected) {
        if (stopReadinessModeId === "openai.realtime") {
          await window.voxtype.transcription.cancelRealtime("Realtime Cloud Dictation cancelled because no speech was detected.").catch(() => undefined);
        }
        const cleanupError = joinErrors(coordinationError ?? "", unmuteError).trim();
        if (cleanupError) {
          setError(`${recordingResult.vad.skippedReason ?? "No speech detected."} ${cleanupError}`);
        } else {
          setError(recordingResult.vad.skippedReason ?? "No speech detected.");
        }
        return;
      }

      const entry = readiness.modeId === "openai.realtime"
        ? await window.voxtype.transcription.finalizeRealtime(recordingResult.wavBytes)
        : (await window.voxtype.transcription.transcribeWav(recordingResult.wavBytes, {
            processName: options?.pasteTarget?.processName ?? hotkeyTargetRef.current?.processName,
            ocrContext: options?.ocrContext ?? hotkeyOcrContextRef.current
          })).entry;

      if (!entry.text.trim()) {
        throw new Error("Dictation completed but returned no transcript text.");
      }
      if (readiness.modeId !== "openai.realtime") {
        await window.voxtype.recordingOverlay.showFinalizing({
          cloudProviderLabel: readiness.cloud ? "Cloud Dictation" : undefined,
          message: readiness.cloud ? "Finalizing cloud dictation" : "Finalizing local dictation"
        });
      }
      if (unmuteError) {
        setError(unmuteError);
      }
      if (coordinationError) {
        setError(coordinationError);
      }
      if (state.settings?.insertionMode === "clipboard" && !options?.pasteTarget?.hwnd) {
        await window.voxtype.insertion.copy(entry.text);
      } else if (options?.pasteTarget?.hwnd) {
        await window.voxtype.insertion.insertWindow(
          entry.text,
          options.pasteTarget.hwnd,
          options.pasteTarget.processName
        );
        await sendProfilePostTranscriptionHotkey(options.pasteTarget.processName);
      }
      const [runtime, history, dictionary] = await Promise.all([
        window.voxtype.runtime.getWhisper(),
        window.voxtype.history.list(),
        window.voxtype.dictionary.list()
      ]);
      setState((current: AppState) => ({
        ...current,
        runtime,
        dictionary,
        history: history.length > 0 ? history : [entry, ...current.history]
      }));
    } catch (transcriptionError) {
      if (stopReadinessModeId === "openai.realtime") {
        await window.voxtype.transcription.cancelRealtime("Realtime Cloud Dictation cancelled after finalization failed.").catch(() => undefined);
      }
      const coordinationError = await stopRecordingCoordination();
      const unmuteError = await unmuteSystemAudio();
      setError(joinErrors(joinErrors(formatError(transcriptionError), coordinationError), unmuteError));
    } finally {
      await window.voxtype.recordingOverlay.hide();
      setBusyMessage(null);
    }
  }

  async function startRecordingCoordination(settings: AppSettings | null): Promise<void> {
    if (settings?.recordingCoordinationMode !== "sendHotkey") {
      return;
    }

    await window.voxtype.windowsHelper.sendHotkey(settings.recordingStartHotkey);
    recordingStopHotkeyRef.current = settings.recordingStopHotkey || settings.recordingStartHotkey;
  }

  async function stopRecordingCoordination(): Promise<string | null> {
    const stopHotkey = recordingStopHotkeyRef.current;

    if (!stopHotkey) {
      return null;
    }

    recordingStopHotkeyRef.current = null;

    try {
      await window.voxtype.windowsHelper.sendHotkey(stopHotkey);
      return null;
    } catch (coordinationError) {
      return `Failed to restore recording coordination: ${formatError(coordinationError)}`;
    }
  }

  async function unmuteSystemAudio(): Promise<string | null> {
    if (!systemAudioMutedByVoxTypeRef.current) {
      return null;
    }

    systemAudioMutedByVoxTypeRef.current = false;
    try {
      await window.voxtype.windowsHelper.setSystemMute(false);
      return null;
    } catch (muteError) {
      return `Failed to unmute system audio: ${formatError(muteError)}`;
    }
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
      (item) => item.processName === normalizedProcess
    );
    const hotkey = profile?.postTranscriptionHotkey.trim();

    if (!hotkey) {
      return;
    }

    await wait(120);
    await window.voxtype.windowsHelper.sendHotkey(hotkey);
  }

  async function copyLatestTranscript(): Promise<void> {
    if (!latestTranscript) {
      return;
    }

    await window.voxtype.insertion.copy(latestTranscript.text);
    setBusyMessage("Copied transcript to clipboard.");
    window.setTimeout(() => { setBusyMessage(null); }, 1800);
  }

  async function pasteLatestTranscript(): Promise<void> {
    if (!latestTranscript) {
      return;
    }

    await insertTranscript(latestTranscript);
  }

  async function insertTranscript(entry: TranscriptEntry): Promise<void> {
    setError(null);

    try {
      await window.voxtype.insertion.insertActive(entry.text);
      setBusyMessage("Inserted transcript into the active app.");
      window.setTimeout(() => { setBusyMessage(null); }, 1800);
    } catch (pasteError) {
      setError(formatError(pasteError));
    }
  }

  async function copyTranscript(entry: TranscriptEntry): Promise<void> {
    await window.voxtype.insertion.copy(entry.text);
    setBusyMessage("Copied transcript to clipboard.");
    window.setTimeout(() => { setBusyMessage(null); }, 1800);
  }

  async function cleanupHistory(): Promise<void> {
    setError(null);

    try {
      const history = await window.voxtype.history.cleanup();
      setState((current: AppState) => ({ ...current, history }));
      setBusyMessage("Cleaned up old history.");
      window.setTimeout(() => { setBusyMessage(null); }, 1800);
    } catch (cleanupError) {
      setError(formatError(cleanupError));
    }
  }

  async function transcribeSavedTranscript(entry: TranscriptEntry): Promise<void> {
    if (!entry.audioFileName) {
      return;
    }

    setError(null);
    setRetranscribingTranscriptId(entry.id);
    setBusyMessage("Retranscribing saved audio...");

    try {
      const audioBytes = await window.voxtype.history.audio(entry.id);
      const result = await window.voxtype.transcription.transcribeWav(audioBytes, {
        processName: currentTarget?.processName ?? hotkeyTargetRef.current?.processName,
        ocrContext: latestOcrContext ?? hotkeyOcrContextRef.current,
        forceModeId: "local.custom"
      });
      const [runtime, history, dictionary] = await Promise.all([
        window.voxtype.runtime.getWhisper(),
        window.voxtype.history.list(),
        window.voxtype.dictionary.list()
      ]);

      setState((current: AppState) => ({
        ...current,
        runtime,
        dictionary,
        history: history.length > 0 ? history : [result.entry, ...current.history]
      }));
    } catch (transcriptionError) {
      setError(formatError(transcriptionError));
    } finally {
      setRetranscribingTranscriptId(null);
      setBusyMessage(null);
    }
  }

  async function transcribeLatestTranscript(): Promise<void> {
    if (!latestTranscript) {
      return;
    }

    await transcribeSavedTranscript(latestTranscript);
  }


  return { 
startRecording, installSpecificRuntime, setupFirstRunCuda, refreshHardware, handleHotkeyStart, handleHotkeyStop, stopAndTranscribe, startRecordingCoordination, stopRecordingCoordination, unmuteSystemAudio, copyLatestTranscript, pasteLatestTranscript, insertTranscript, copyTranscript, cleanupHistory, transcribeSavedTranscript, transcribeLatestTranscript
 };
}



