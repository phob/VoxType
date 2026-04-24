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
