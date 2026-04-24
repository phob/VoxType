# Architecture

## High-Level Shape

VoxType should be an Electron app with separate native and model-processing components.

```text
Electron Renderer
  UI, settings, model manager, tray window, history, dictionary editor

Electron Main
  app lifecycle, IPC, updater, config, worker orchestration

Native Windows Helper
  global hotkeys, active-window detection, clipboard, SendInput, UI Automation,
  screenshots, privilege checks

ASR Worker
  local speech-to-text engines, model loading, streaming/batch transcription

OCR Worker
  local OCR engines, screenshot text extraction, context term extraction

Local Data Store
  settings, dictionary, correction memory, model manifests, transcript history
```

## Recommended Stack

- Electron for desktop shell.
- TypeScript for app and shared domain code.
- React for UI unless a different frontend stack is chosen later.
- Vite for renderer development.
- Native helper in Rust, including Windows integration that is awkward or unreliable from Electron alone.
- `whisper.cpp` as the first ASR backend.
- Tesseract or PaddleOCR as local OCR backends.
- `electron-builder` with NSIS for Windows installer.

## Process Boundaries

The app should keep these responsibilities separated:

- Electron UI should never run heavy transcription directly.
- The native Windows helper should remain small and stable.
- Model inference should run in a worker process that can crash or restart without taking the whole app down.
- Model downloads should be resumable and checksum-verified.

## ASR Engine Interface

VoxType should use an internal ASR provider interface so Whisper is the main implementation but Parakeet or other engines can be added later.

```ts
interface AsrEngine {
  id: string;
  displayName: string;
  capabilities: AsrCapabilities;
  loadModel(modelPath: string, options: ModelOptions): Promise<void>;
  transcribeFile(path: string, options: TranscriptionOptions): Promise<Transcript>;
  transcribeStream?(stream: AudioStream, options: TranscriptionOptions): AsyncIterable<PartialTranscript>;
  unload(): Promise<void>;
}
```

Capabilities should include:

- supported languages
- streaming support
- timestamps support
- prompt/context support
- hotword support
- CPU/GPU support
- expected memory requirements

## Text Pipeline

The output pipeline should be engine-independent:

```text
audio
  -> ASR engine
  -> transcript normalization
  -> dictionary and OCR-context corrections
  -> optional formatting
  -> insertion strategy
  -> target app
```

This pipeline lets VoxType improve quality even when the ASR model cannot truly learn new words.

## Local Data

Likely storage locations on Windows:

- App config: `%APPDATA%\VoxType`
- Models/cache: `%LOCALAPPDATA%\VoxType\Models`
- Logs: `%LOCALAPPDATA%\VoxType\Logs`
- User dictionary: `%APPDATA%\VoxType\dictionary.json`

Final paths can be changed later, but user data and downloaded model data should be separated.

Current foundation:

- `src/shared/settings.ts` defines typed app settings and sanitization.
- `src/main/settings-store.ts` stores settings as JSON under Electron's `app.getPath("userData")`.
- `src/preload/index.ts` exposes settings read/update/reset methods to the renderer through IPC.
- Initial settings include model directory, insertion mode, app profiles, offline mode, clipboard restoration, remote typing delay, remote typing chunk size, configurable hotkeys, and optional automatic system-audio mute while recording.
- `src/renderer/src/audio-recorder.ts` captures microphone audio with an `AudioWorkletNode`, keeps the monitor path silent with zero gain, resamples to 16 kHz, and encodes WAV for Whisper.
- `src/shared/models.ts` defines the initial Whisper model catalog.
- `src/main/model-service.ts` downloads Whisper ggml models from the `ggerganov/whisper.cpp` Hugging Face repository into the configured model directory.
- `src/shared/runtimes.ts` pins the first managed Windows runtime to official `ggml-org/whisper.cpp` `v1.8.4` `whisper-bin-x64.zip`.
- `src/main/runtime-service.ts` downloads and extracts the managed CPU x64 `whisper.cpp` runtime into Electron's `userData` runtime directory.
- `src/main/transcription-service.ts` writes recorded WAV audio to a temp file and invokes the custom executable path if configured, otherwise the managed runtime executable, otherwise `whisper-cli`.
- `src/main/history-store.ts` persists recent transcript history under Electron's `userData` path.
- `src/main/insertion-service.ts` prepares clipboard insertion and delegates paste-into-active-app behavior to the native helper.
- `src/main/insertion-service.ts` centralizes insertion modes for clipboard paste, Unicode typing, and chunked typing. It consults per-app profiles when a target process is known. The renderer insertion test panel can call these modes with one-off overrides without changing the saved default insertion mode.
- App profiles live in settings for now. They are auto-created from detected foreground windows and store insertion mode plus writing style for later formatting behavior.
- `native/windows-helper` contains the first Rust native helper. It currently exposes `active-window`, `focus-window`, `paste-text`, `type-text`, and `set-system-mute` commands. `active-window` returns foreground window title, hwnd, process id, process path, and process name as JSON. `focus-window` restores/focuses a captured hwnd. `paste-text` accepts UTF-8 text through stdin, sets the Windows Unicode clipboard, and sends Ctrl+V with `SendInput`. `type-text` accepts UTF-8 text through stdin and emits Unicode `SendInput` events so direct typing is not tied to the active keyboard layout. `set-system-mute` uses the Windows Core Audio endpoint API to mute or unmute the default render device.
- `src/main/windows-helper-service.ts` resolves and invokes the native helper from Electron, with dev/release/resource path candidates.
- Configurable global hotkeys are persisted in settings. Defaults are `CommandOrControl+Alt+Space` for dictation toggle and `CommandOrControl+Shift+Space` for showing VoxType. The dictation hotkey captures the foreground window before recording, signals the renderer to start/stop microphone capture, then refocuses the captured window before paste insertion.
- The optional system-audio mute setting mutes the default Windows output device before microphone recording starts and un-mutes it immediately after the recording stops, before local transcription begins.

## Security And Privacy

- Core transcription and OCR should run without internet after models are installed.
- Do not upload audio, screenshots, OCR text, transcripts, or dictionary entries.
- Network access should be limited to model downloads and updates unless the user opts into extra features.
- Provide an offline mode that blocks all network access except explicit user action.
