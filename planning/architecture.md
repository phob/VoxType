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
- Native helper in Rust or C++.
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
- Initial settings include model directory, insertion mode, offline mode, clipboard restoration, and remote typing delay.

## Security And Privacy

- Core transcription and OCR should run without internet after models are installed.
- Do not upload audio, screenshots, OCR text, transcripts, or dictionary entries.
- Network access should be limited to model downloads and updates unless the user opts into extra features.
- Provide an offline mode that blocks all network access except explicit user action.
