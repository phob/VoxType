# Roadmap

## Phase 0: Planning Foundation

- Maintain this planning directory.
- Decide initial app stack. Done: Electron, TypeScript, React, and electron-vite.
- Decide native helper language.
- Decide first Whisper runtime and model download source.
- Define minimal app UX. Initial shell created with a status screen and planned capability cards.
- Add CI build checks. Done: GitHub Actions runs `npm ci` and `npm run build`.

## Phase 1: MVP Dictation

Goal: local dictation into normal Windows apps.

Features:

- Electron app shell. Initial scaffold created.
- Tray app. Initial tray context menu created.
- Settings window. First persistent settings panel and main-process settings store created.
- Global push-to-talk hotkey.
- Microphone recording.
- Whisper transcription through `whisper.cpp`.
- Basic model download.
- Clipboard paste insertion.
- Simple transcript history.

## Phase 2: Windows Insertion Reliability

Goal: make VoxType work beyond normal text fields.

Features:

- Native Windows helper.
- Direct keyboard typing.
- Chunked typing.
- Unicode handling.
- Active app detection.
- Per-app insertion profiles.
- RDP/TeamViewer profile.
- Insertion test panel.

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
