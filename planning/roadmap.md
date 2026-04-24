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
- Microphone recording. Initial renderer recorder captures microphone audio through `AudioWorkletNode`, keeps monitoring silent, and encodes 16 kHz WAV.
- Whisper transcription through `whisper.cpp`. Initial service invokes a custom executable path if configured, otherwise the managed CPU x64 `whisper.cpp` runtime, otherwise `whisper-cli`.
- Managed `whisper.cpp` runtime acquisition. Initial implementation downloads and extracts official `ggml-org/whisper.cpp` `v1.8.4` `whisper-bin-x64.zip` and finds `whisper-cli.exe`.
- Basic model download. Initial catalog downloads `tiny.en`, `base.en`, and `small.en` ggml models.
- Clipboard paste insertion. Initial implementation copies the transcript to the clipboard automatically after transcription when clipboard mode is selected. Automatic paste into the previously focused app remains Phase 2 work.
- Simple transcript history. Initial local JSON history stores the latest 50 transcripts.
- Optional system audio mute while recording. Initial implementation mutes the default Windows output device during microphone capture and un-mutes it when recording stops.

## Phase 2: Windows Insertion Reliability

Goal: make VoxType work beyond normal text fields.

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
- RDP/TeamViewer profile. Initial defaults use chunked typing for Remote Desktop, TeamViewer, and AnyDesk targets.
- Insertion test panel. Initial renderer panel captures a target app after a short delay and can test clipboard paste, Unicode typing, and chunked typing independently.

## Phase 3: Dictionary And Correction Memory

Goal: make the app learn user words locally.

Features:

- User dictionary UI.
- Replacement rules.
- Correction memory.
- Fix last dictation.
- Prompt context generation for Whisper.
- Per-app dictionary categories.

## Phase 4: OCR Context

Goal: make VoxType screen-aware.

Features:

- Screenshot capture.
- Region selection overlay.
- Local OCR.
- OCR term extraction.
- Temporary OCR dictionary.
- Add OCR terms to permanent dictionary.
- Use OCR context in Whisper prompt and post-processing.

## Phase 5: Polish And Power Features

Goal: become a go-to Windows dictation app.

Features:

- Dictation modes.
- Confidence review.
- Local formatting engine.
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
- PaddleOCR.
- Local LLM formatting provider.
