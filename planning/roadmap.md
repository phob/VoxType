# Roadmap

## Phase 0: Planning Foundation

- Maintain this planning directory.
- Decide initial app stack. Done: Electron, TypeScript, React, and electron-vite.
- Decide native helper language. Done: Rust.
- Decide first Whisper runtime and model download source.
- Define minimal app UX. Initial shell created with a status screen and planned capability cards.
- Add CI build checks. Done: GitHub Actions runs `npm ci` and `npm run build`.

## Phase 1: MVP Dictation

Goal: local dictation into normal Windows apps.

Features:

- Electron app shell. Initial scaffold created.
- Tray app. Initial tray context menu created.
- Settings window. First persistent settings panel and main-process settings store created.
- Global push-to-talk hotkey. Configurable hotkeys default to `Ctrl+Alt+Space` for recording/transcription from any app and `Ctrl+Shift+Space` to bring VoxType forward. Settings UI captures pressed key combinations instead of requiring manual accelerator strings.
- Microphone recording. Initial renderer recorder captured microphone audio through `AudioWorkletNode`; recording now uses the Rust Windows helper with CPAL plus Rubato to produce 16 kHz WAV audio. There is no WebAudio fallback.
- Whisper transcription through `whisper.cpp`. Initial service invokes a custom executable path if configured, otherwise the managed CPU x64 `whisper.cpp` runtime, otherwise `whisper-cli`.
- Managed `whisper.cpp` runtime acquisition. Initial implementation downloads and extracts official `ggml-org/whisper.cpp` `v1.8.4` `whisper-bin-x64.zip` and finds `whisper-cli.exe`.
- Basic model download. Initial catalog downloads `tiny.en`, `base.en`, and `small.en` ggml models.
- Clipboard paste insertion. Initial implementation copies the transcript to the clipboard automatically after transcription when clipboard mode is selected. Automatic paste into the previously focused app remains Phase 2 work.
- Simple transcript history. Initial local JSON history stores the latest 50 transcripts.
- Optional system audio mute while recording. Initial implementation mutes the default Windows output device during microphone capture and un-mutes it when recording stops.

## Phase 2: Windows Insertion Reliability

Goal: make VoxType work beyond normal text fields. Initial implementation complete.

Features:

- Native Windows helper. Initial Rust helper scaffold created under `native/windows-helper`.
- Direct keyboard typing. Initial `type-text` helper command sends Unicode `SendInput` events independent of the active Windows keyboard layout.
- Chunked typing. Initial `chunked` insertion mode sends text in configurable chunks with a configurable delay for remote or slow targets.
- Unicode handling. Initial direct typing path uses `KEYEVENTF_UNICODE` instead of layout-dependent virtual keys.
- Active app detection. Initial `active-window` command reports foreground window metadata and is wired into the renderer test panel.
- Clipboard paste insertion into active app. Initial `paste-text` helper command sets Unicode clipboard text and sends Ctrl+V to the active foreground app. Clipboard restore is implemented for common text, HTML, RTF, and image clipboard contents when the setting is enabled.
- Target-window paste after global dictation. Initial hotkey flow captures the active window before dictation and refocuses it before pasting the transcript.
- Recording-safe audio control. Initial native helper command can mute or unmute the default Windows render endpoint for cleaner recordings.
- Per-app insertion profiles. Initial implementation auto-creates a profile when a new app is detected, exposes profiles in the UI, and stores insertion mode plus writing style.
- RDP/TeamViewer profile. Current defaults use chunked typing for Remote Desktop, TeamViewer, and AnyDesk targets; remote clipboard remains available for manual testing.
- Insertion test panel. Initial renderer panel captures a target app after a short delay and can test clipboard paste, Unicode typing, and chunked typing independently.

## Phase 3: Dictionary And Correction Memory

Goal: make the app learn user words locally.

Features:

- User dictionary UI. Initial panel lets users add, disable, and delete entries.
- Replacement rules. Initial dictionary entries store preferred text plus misheard phrases and apply conservative post-processing replacements.
- Correction memory. Initial correction entries can be learned from the latest transcript.
- Fix last dictation. Initial UI saves corrected latest text as a local correction rule.
- Prompt context generation for Whisper. Initial transcription service passes a compact dictionary prompt to `whisper.cpp`.
- Per-app dictionary categories. Initial entries can be scoped to all apps or a detected app profile/process.

## Phase 3.5: Voice Activity Detection And Silence Trimming

Goal: make recordings cleaner by removing silent and non-speech parts before transcription without ending the user's recording session automatically. Initial implementation complete.

Preferred direction:

- Use Silero VAD as the first neural VAD candidate.
- Run VAD locally through ONNX Runtime rather than Python/Torch.
- Keep the initial implementation CPU-only.
- Process the same 16 kHz PCM stream already produced by the renderer audio recorder.
- Maintain a short pre-roll buffer so the beginning of speech is not clipped.
- Trim leading, trailing, and optionally long internal silent spans before sending audio to Whisper.
- Do not use VAD to stop recording automatically.
- Keep recording start/stop under explicit user control through the hotkey or UI.

Features:

- VAD on/off setting. Initial setting added.
- Sensitivity threshold. Initial speech and silence threshold settings added.
- Minimum speech duration. Initial setting added.
- Silence trimming threshold/duration. Initial Silero `redemptionMs` setting added.
- Preserve-short-pause duration so normal thinking pauses are not aggressively removed. Initial segment-join pause setting added.
- Pre-roll duration. Initial setting added.
- Maximum recording duration as a separate safety setting, not driven by VAD.
- VAD trimming summary. Initial UI shows speech segments, kept duration, and trimmed duration after recording.
- Playback for saved processed audio. Initial history UI can play the WAV that was sent to Whisper so VAD trimming bugs can be heard directly.
- Per-device calibration or presets later.
- Diagnostics panel later showing speech probability over time.

Implementation notes:

- Native recording is the only recording path. The Windows helper captures audio with CPAL, converts to mono, resamples to 16 kHz with Rubato, optionally applies native Silero VAD v4, and writes WAV audio for the existing Whisper pipeline.
- Native Silero VAD follows Handy's integration: `vad-rs`, `silero_vad_v4.onnx`, 30 ms frames, and a `SmoothedVad` wrapper with prefill, hangover, and onset confirmation.
- If native helper recording or native VAD cannot start, dictation should cancel with a clear error instead of falling back to browser recording or browser VAD.
- VAD should gate and trim audio, but it must not replace or trigger the user's explicit start/stop hotkey.
- VAD only detects speech/non-speech; automatic stopping based on pauses or transcript meaning is out of scope for the planned first VAD implementation.

## Phase 3.6: Recording Coordination

Goal: avoid microphone conflicts with communication apps while VoxType is recording.

Preferred direction:

- Do not rely on muting the global Windows microphone endpoint because that may also mute VoxType.
- Prefer WASAPI exclusive capture as the device-level coordination strategy when users want other apps blocked from the microphone.
- Keep app-native hotkey automation as a global fallback for apps like Discord where users want the app's own mute state and UI to stay synchronized.
- Do not require profile integration for the hotkey fallback yet; one global start hotkey and one global stop hotkey are enough for the first implementation.
- Treat capture-session mute as experimental because testing showed it can silence Discord but may also interfere with VoxType capture depending on timing/session behavior.

Features:

- Recorder capture modes: `sharedCapture`, `exclusiveCapturePreferred`, and `exclusiveCaptureRequired`.
- WASAPI exclusive recorder path with hardware-format negotiation and fallback behavior for preferred mode.
- Global recording coordination mode: none or send hotkey.
- Configurable global recording start and stop hotkeys.
- Recording flow integration after microphone capture opens and during cleanup.
- Discord setup guidance later, using user-confirmed hotkeys rather than hardcoded behavior.

Later possibilities:

- Per-app profile integration for recording coordination if global hotkey fallback is not enough.
- App-specific adapters if a target app exposes a safe local control API.
- UI Automation where reliable.
- A virtual microphone/silence-routing approach only if the product later needs a heavy-duty solution.

## Phase 4: OCR Context

Goal: make VoxType screen-aware. Initial implementation is good enough for now.

Features:

- Screenshot capture. Initial native helper command captures the full virtual screen, active foreground window, or a captured target hwnd to PNG, with Electron IPC and a renderer OCR preview panel.
- OCR service boundary backed by Windows Media OCR through the native helper.
- Region selection overlay is skipped for now; active-window OCR is the intended first context source.
- Local OCR through Windows Media OCR. Initial OCR tab can run OCR on captured screenshots and display recognized text and line results.
- OCR term extraction. Initial conservative extraction is wired into global-hotkey dictation context and runs in the background after recording has already started. Global-hotkey OCR screenshots use the captured target hwnd rather than whichever window is foreground later.
- Temporary OCR dictionary. Initial OCR context is held per dictation session and shown in the dictation debug UI.
- Add OCR terms to permanent dictionary. Initial UI can save individual OCR terms as dictionary entries scoped to the detected process.
- Use OCR context in Whisper prompt and post-processing. Initial implementation feeds extracted active-window OCR terms into the Whisper prompt and applies conservative OCR-term spelling corrections after ASR.
- Final user-facing OCR UI should be simple: a setting/checkbox to enable or disable OCR context. The detailed OCR raw text, rejected terms, prompt, and correction diagnostics can remain in a developer/debug view.
- Known limitation accepted for now: some difficult visible words still do not improve transcription correctly even when OCR detects them. Phase 4 is considered sufficient to move on because the rejection/filtering behavior is useful and higher-priority tasks remain.

## Phase 5: Polish And Power Features

Goal: become a go-to Windows dictation app.

Features:

- GPU acceleration as the first Phase 5 priority. Initial implementation adds automatic GPU/VRAM detection, per-model fit checks, CPU/CUDA managed runtime downloads, backend preference selection, and Vulkan custom-runtime support.
- Release-ready UI separation: the dense current interface is now treated as a developer UI behind a developer/debug switch, while the default app surface should become a simple end-user dictation home.
- First-run NVIDIA setup: the developer UI now has a CUDA setup action that detects a capable NVIDIA GPU, chooses CUDA 12.4 or CUDA 11.8 from the driver version, installs the managed `whisper.cpp` runtime, and keeps backend selection on `auto`.
- Dictation modes.
- Confidence review.
- Local formatting engine.
- Transcript consistency layer for stable punctuation, casing, spacing, and style level.
- Separate raw ASR text from final inserted text in transcript history.
- Better model manager.
- Offline mode.
- Auto-start with Windows.
- Signed installer.
- Auto-update.
- Local logs with opt-in export.

## Phase 6: Optional Engines

Goal: expand model choice after the Whisper core is stable.

Possible additions:

- Parakeet V3 or newer Parakeet model.
- Faster Whisper/CTranslate2.
- Additional OCR engines only if Windows Media OCR proves insufficient.
- Local LLM formatting provider.
