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
  screenshots, privilege checks, recording hotkey automation

ASR Worker
  local speech-to-text engines, model loading, streaming/batch transcription

Hardware Capability Service
  GPU detection, VRAM reporting, backend suitability, model/runtime compatibility

OCR Worker
  local OCR engines, screenshot text extraction, context term extraction

VAD Worker
  local speech activity detection, silence trimming, speech probability signals

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
- Windows Media OCR as the first local OCR backend for screenshot text extraction.
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
  -> voice activity detection and trimming
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
- Initial settings include model directory, insertion mode, app profiles, offline mode, developer mode, Windows login startup, start minimized, clipboard restoration, remote typing delay, remote typing chunk size, configurable hotkeys, optional automatic system-audio mute while recording, global recording-coordination mode and hotkeys, recorder capture mode, and Silero VAD trimming controls.
- Electron main applies the persisted Windows startup setting through the platform login-item API when settings are loaded, updated, or reset. `startWithWindows` controls automatic launch at sign-in, while `startMinimized` controls whether the main window hides to the tray after startup.
- The renderer now defaults to a release-style dictation home for ordinary users and keeps the prior dense diagnostic interface behind `developerModeEnabled`.
- Recording shows a small always-on-top overlay window near the bottom of the active screen. The native helper emits live recording-level JSON events while capturing, Electron forwards them to the overlay, and the overlay switches from recording to transcribing before hiding at the end of transcription.
- The dictation recorder starts native capture through `native/windows-helper record-wav <output.wav>`. The helper uses CPAL to open the default input device, chooses a native/default sample format and rate, converts to mono, resamples to 16 kHz with Rubato FFT resampling, optionally applies Silero VAD v4 through `vad-rs` plus Handy-style smoothing, and writes a 16-bit PCM WAV. Electron stops recording by closing the helper's stdin command stream, then reads the WAV bytes for the existing Whisper pipeline.
- Native WAV encoding must preserve the sign of centered PCM samples. A prior writer bug multiplied negative float samples by `i16::MIN`, which turned them positive and made recordings sound heavily distorted.
- The old browser `AudioWorkletNode` recorder and renderer VAD path have been removed. If native helper recording fails to start, dictation cancels instead of falling back to WebAudio.
- Handy records differently from the original VoxType browser recorder: Handy uses native Rust/CPAL capture, native sample format selection, native worker-thread buffering, Rubato resampling, `vad-rs`, `silero_vad_v4.onnx`, 30 ms frames, and `SmoothedVad`. VoxType's recording path now follows that direction through the Windows helper.
- `src/shared/models.ts` defines the initial Whisper model catalog.
- `src/main/model-service.ts` downloads Whisper ggml models from the `ggerganov/whisper.cpp` Hugging Face repository into the configured model directory.
- `src/shared/runtimes.ts` defines the managed `whisper.cpp` runtime catalog: CPU x64, CUDA 12.4 x64, CUDA 11.8 x64, and a Vulkan custom-runtime slot. Official `ggml-org/whisper.cpp` `v1.8.4` release assets are used for CPU/CUDA downloads.
- `src/main/runtime-service.ts` downloads and extracts managed `whisper.cpp` runtimes into Electron's `userData` runtime directory, lists installed runtimes, selects an executable according to the user's `auto`/`cpu`/`cuda`/`vulkan` backend preference, and exposes first-run CUDA setup that chooses CUDA 12.4 or 11.8 from the detected NVIDIA driver version. A custom `whisperExecutablePath` still overrides managed runtime selection.
- `src/main/hardware-service.ts` detects GPU capability for Phase 5 acceleration planning. It uses `nvidia-smi` when available for NVIDIA GPU name, VRAM, and driver details, falls back to Windows `Win32_VideoController` data, and reports CUDA/Vulkan suitability plus per-model VRAM fit through a renderer IPC surface.
- `src/main/ocr-service.ts` owns OCR orchestration and currently delegates screenshot recognition to the Rust helper's Windows Media OCR command. This keeps Phase 4 local, native, and fast for active-window screenshots without managing a separate Python runtime or OCR model bundle. During global-hotkey dictation, the main process captures active-window OCR before VoxType takes focus, extracts conservative terms, and sends those terms through the renderer to the transcription prompt context.
- `src/main/history-store.ts` persists recent transcript history under Electron's `userData` path.
- Transcript history now stores successful transcription audio as WAV files under Electron's `userData` path and exposes them through IPC for playback. The saved audio is the processed WAV sent to Whisper, which makes VAD trimming issues audible from the history UI.
- `src/main/dictionary-store.ts` persists local dictionary entries and correction memory under Electron's `userData` path. It builds compact Whisper prompts and applies conservative phrase replacements after ASR.
- `src/main/transcription-service.ts` writes recorded WAV audio to a temp file, invokes Whisper with optional dictionary prompt context, applies local dictionary corrections, then stores corrected transcript history.
- `src/main/insertion-service.ts` prepares clipboard insertion and delegates paste-into-active-app behavior to the native helper.
- `src/main/insertion-service.ts` centralizes insertion modes for clipboard paste, Unicode typing, and chunked typing. It consults per-app profiles when a target process is known. Clipboard paste can snapshot and restore common prior clipboard contents after insertion. The renderer insertion test panel can call these modes with one-off overrides without changing the saved default insertion mode.
- App profiles live in settings for now. They are auto-created from detected foreground windows and store insertion mode plus writing style for later formatting behavior.
- Recording coordination is global for now: VoxType can send one configured start hotkey and one configured stop hotkey around every recording when the user enables `sendHotkey`. This keeps Discord-style app-native mute automation simple without requiring profile integration first.
- `native/windows-helper` contains the first Rust native helper. It currently exposes `active-window`, `focus-window`, `capture-screenshot`, `ocr-image`, `record-wav`, `paste-text`, `type-text`, `send-hotkey`, `mute-capture-session`, `restore-capture-session`, and `set-system-mute` commands. `active-window` returns foreground window title, hwnd, process id, process path, and process name as JSON. `focus-window` restores/focuses a captured hwnd. `capture-screenshot` captures either the full virtual screen, active foreground window, or a specific captured hwnd to PNG for the Phase 4 OCR pipeline; active-window and hwnd capture use DWM extended frame bounds instead of `GetWindowRect` to avoid DPI/window-frame offset errors. Global-hotkey OCR uses the captured target hwnd so VoxType does not accidentally OCR itself or another foreground app while recording starts. `ocr-image` uses Windows Media OCR through WinRT for fast native OCR benchmarking and tiles screenshots that exceed `OcrEngine::MaxImageDimension`, with overlap, so 4K-sized windows can be recognized without exceeding the Windows OCR bitmap limit. `record-wav` captures native microphone audio until stopped through stdin and writes a 16 kHz WAV, optionally trimming non-speech through native Silero VAD v4. `record-wav` can use shared capture, prefer WASAPI exclusive capture with shared fallback, or require WASAPI exclusive capture. The exclusive path negotiates hardware-friendly formats instead of assuming the shared mix format is valid. `paste-text` accepts UTF-8 text through stdin, sets the Windows Unicode clipboard, and sends Ctrl+V with `SendInput`. `type-text` accepts UTF-8 text through stdin and emits Unicode `SendInput` events so direct typing is not tied to the active keyboard layout. `send-hotkey` emits a configured accelerator through `SendInput`. `set-system-mute` uses the Windows Core Audio endpoint API to mute or unmute the default render device.
- `src/main/windows-helper-service.ts` resolves and invokes the native helper from Electron, with dev/release/resource path candidates.
- Configurable global hotkeys are persisted in settings. Defaults are `CommandOrControl+Alt+Space` for dictation toggle and `CommandOrControl+Shift+Space` for showing VoxType. The dictation hotkey captures the foreground window before recording, signals the renderer to start/stop microphone capture, then refocuses the captured window before paste insertion.
- The optional system-audio mute setting mutes the default Windows output device before microphone recording starts and un-mutes it immediately after the recording stops, before local transcription begins.

## Security And Privacy

- Core transcription and OCR should run without internet after models are installed.
- Do not upload audio, screenshots, OCR text, transcripts, or dictionary entries.
- Network access should be limited to model downloads and updates unless the user opts into extra features.
- Provide an offline mode that blocks all network access except explicit user action.
