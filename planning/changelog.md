# Planning Changelog

## 2026-04-24

- Created initial planning directory.
- Captured VoxType product vision.
- Set direction as Windows-first Electron app.
- Set Whisper as main ASR engine.
- Moved Parakeet V3 to optional later engine.
- Defined dictionary as local context/correction layer.
- Added OCR-derived temporary dictionary as a signature feature.
- Added Windows insertion strategies: clipboard, keyboard emulation, chunked typing, UI Automation.
- Added roadmap from MVP dictation through OCR, polish, and optional engines.
- Created a project-specific Codex skill, `voxtype-planning-steward`, to keep planning files updated in future sessions.
- Added release and changelog strategy using Conventional Commits plus Release Please as the initial recommendation.
- Started the basic Electron app scaffold with TypeScript, React, electron-vite, a preload bridge, tray setup, and an initial VoxType status screen.
- Added concrete Release Please configuration, GitHub Actions workflow, PR template, and contribution notes for consistent public changelogs.
- Added GitHub CI build checks for `npm ci` and `npm run build`.
- Added the first persistent settings foundation with typed settings, main-process JSON storage, preload IPC methods, and a renderer settings panel.
- Added Release Please troubleshooting note for GitHub Actions pull request permission errors.
- Completed the first Phase 1 dictation vertical slice: Whisper model catalog/downloads, microphone WAV recording, configured `whisper-cli` transcription, clipboard-ready insertion, global shortcut to show VoxType, and local transcript history.
- Added managed Windows CPU x64 `whisper.cpp` runtime acquisition from official `ggml-org/whisper.cpp` `v1.8.4` release assets, with UI install status and automatic use before falling back to `whisper-cli`.
- Started Phase 2 with a Rust native Windows helper scaffold, foreground active-window detection, Electron IPC integration, and a renderer Windows integration panel.
- Added native clipboard paste insertion through the Rust helper, including a `paste-text` command, Electron insertion IPC, and a renderer "Paste To Active App" action for the latest transcript.
- Added global `Ctrl+Alt+Space` dictation toggle that captures the target window before recording, stops/transcribes on the second press, refocuses the captured app, and pastes the transcript without requiring VoxType button clicks.
- Made the dictation and show-window global hotkeys configurable through persisted settings, with registration status shown in the UI.
- Replaced manual hotkey text entry with key-combination capture controls in the settings UI.
