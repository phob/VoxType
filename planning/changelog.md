# Planning Changelog

## 2026-04-27

- Added managed CUDA runtime selection for official `whisper.cpp` v1.8.4 CUDA 12.4 and CUDA 11.8 Windows archives.
- Added a backend preference direction for `auto`, `cpu`, `cuda`, and `vulkan`, with custom Vulkan runtime support until a managed Vulkan archive exists.
- Clarified that custom `whisperExecutablePath` remains the highest-priority override above managed runtime selection.
- Moved the dense current interface behind a developer mode switch and added a simpler default dictation home for release-readiness.
- Added first-run NVIDIA CUDA auto-install as the next release-readiness direction.
- Added an always-on-top recording/transcribing overlay with live input level updates from the native recorder.

## 2026-04-26

- Made GPU acceleration the first Phase 5 priority, with automatic GPU/VRAM detection and per-model fit checks as the initial slice.
- Added Whisper GPU research notes covering `whisper.cpp` CUDA/Vulkan/OpenVINO support, Python Whisper CUDA caveats, and Faster Whisper as a later optional runtime.
- Added a hardware capability service to the architecture notes for detecting CUDA/Vulkan suitability and VRAM before recommending GPU Whisper runtimes.
- Confirmed the local hardware detector reports the user's GPU as capable of hardware acceleration, making managed GPU runtime acquisition the next GPU work item.
- Added Windows Media OCR as a native Rust-helper OCR provider/benchmark and fixed active-window screenshot offsets by using DWM extended frame bounds.
- Removed the heavyweight OCR runtime path and made Windows Media OCR the Phase 4 OCR direction for screenshot-based context.
- Wired global-hotkey dictation to capture active-window OCR context, extract conservative terms, and feed them into the Whisper prompt path.
- Added an editable Whisper prompt override in the dictation UI, with a Default action that returns to the generated dictionary/OCR prompt.
- Moved active-window OCR for global-hotkey dictation into a background session update so microphone recording starts immediately and short recordings can proceed without OCR context.
- Added conservative OCR-term post-processing, separate OCR correction reporting, and one-click OCR term promotion into the dictionary.
- Added Windows OCR tiling based on `OcrEngine::MaxImageDimension` so large active-window screenshots, including 4K-sized windows, can be recognized in overlapping chunks.
- Added raw OCR text diagnostics beside filtered OCR terms in the dictation UI.
- Added OCR term extraction modes (`strict`, `balanced`, `broad`), rejected-candidate diagnostics, and copy buttons for raw OCR text and extracted terms.
- Fixed global-hotkey OCR capture to screenshot the captured target hwnd instead of whichever window is foreground when OCR starts.
- Marked Phase 4 OCR context as good enough for now, with final UI direction reduced to a simple OCR enable/disable control and detailed OCR output kept as diagnostics.

## 2026-04-25

- Started the first OCR provider path with a managed local runtime experiment before replacing it with native Windows OCR.
- Started Phase 4 with native screenshot capture for active-window and full-screen OCR context, plus renderer preview plumbing.
- Added transcript consistency as a planned VoxType layer for stable punctuation, casing, spacing, and app/profile style levels.
- Clarified that raw ASR output should be preserved separately from the final post-processed inserted text.
- Clarified the recording-path difference between VoxType and Handy, and captured native microphone capture as the likely next fix if renderer/WebAudio capture still crackles during longer recordings.
- Promoted native CPAL microphone recording through the Windows helper to the capture direction.
- Removed the browser recording/VAD fallback direction and promoted native Silero VAD through the Windows helper using Handy-style `vad-rs`, Silero v4, 30 ms frames, and smoothing.
- Fixed a native WAV writer sign bug that rectified negative samples into positive values, causing severely distorted audio from the Rust helper recordings.
- Reworked Phase 3.6 around WASAPI exclusive capture, exclusive-format negotiation, and global hotkey coordination fallback instead of profile-bound hotkeys.

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
- Added optional system-audio mute while recording, backed by a Windows Core Audio command in the native helper.
- Replaced deprecated `ScriptProcessorNode` microphone capture with an `AudioWorkletNode` recorder.
- Added direct Unicode keyboard insertion and configurable chunked typing for remote or slow target apps.
- Fixed target-window focusing so insertion no longer un-maximizes maximized applications.
- Added an insertion test panel for captured target apps with clipboard, Unicode typing, and chunked typing checks.
- Added auto-created per-app profiles with editable insertion mode and saved writing style defaults for browsers, remote apps, terminals, and Outlook.
- Implemented restore-clipboard behavior for paste insertion, including common rich clipboard content snapshots.
- Moved into Phase 3 with a local dictionary store, dictionary UI, replacement rules, simple correction memory, fix-latest correction capture, and Whisper prompt context generation.
- Planned local voice activity detection as Phase 3.5, with Silero VAD via ONNX as the preferred first direction for speech gating and silence trimming.
- Clarified that Silero VAD should cut silent/non-speech parts from recordings before Whisper, not stop the recording automatically.
- Implemented the first Phase 3.5 slice with bundled Silero VAD/ONNX Runtime assets, post-recording silence trimming, VAD settings, no-speech skip behavior, fallback to untrimmed audio if VAD fails, and a trimming summary in the dictation UI.
- Added Phase 3.6 recording coordination for communication apps, with Discord-style mute/unmute hotkey automation as the preferred first approach instead of trying to globally mute other microphone consumers.
- Added saved processed-audio playback to transcript history so VAD trimming problems can be debugged by listening to the exact WAV sent to Whisper.
- Deepened the Handy comparison for VAD/audio quality. Updated VoxType's Phase 3.5 direction toward high-quality resampling and conservative edge-only VAD trimming until Handy-style frame smoothing/native VAD is available.
