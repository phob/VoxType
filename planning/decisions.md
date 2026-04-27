# Decisions

Record important decisions here so future sessions do not reopen settled topics without a reason.

## 2026-04-24: Windows-First Electron App

Decision:

VoxType will be planned as a Windows-first Electron app.

Reason:

The product needs a desktop UI, tray behavior, model management, and deep Windows integration.

## 2026-04-24: Local-First Core

Decision:

Core speech-to-text, OCR, dictionary, and insertion should work locally.

Reason:

Privacy and offline reliability are central to the product identity.

## 2026-04-24: Whisper As Main ASR Engine

Decision:

Use Whisper as the primary ASR direction, likely via `whisper.cpp`.

Reason:

Whisper is mature, broad, portable, and more suitable as the dependable first engine.

## 2026-04-24: Parakeet Later

Decision:

Parakeet V3 should be an optional later engine, not the primary implementation.

Reason:

Parakeet is promising but has runtime-dependent limitations around Windows packaging and dictionary/hotword support.

## 2026-04-24: Dictionary Is A VoxType Layer

Decision:

The dictionary should be implemented as a VoxType context/correction layer rather than relying on ASR model vocabulary modification.

Reason:

Whisper cannot simply learn new words at runtime. Prompt biasing, OCR context, and post-processing are more practical.

## 2026-04-24: OCR Context Is A Signature Feature

Decision:

Screenshot OCR should feed the speech-to-text dictionary/context system.

Reason:

This can make VoxType stand out from generic local Whisper dictation tools.

## 2026-04-24: Use Reviewable Release Automation

Decision:

Use Conventional Commits plus Release Please as the initial changelog and release automation strategy once the app scaffold exists.

Reason:

VoxType needs consistent public changelogs that do not rely on manual updates, while still giving the maintainer a reviewable release PR before tags and GitHub Releases are created. This works well with AI-assisted development because generated release notes can be reviewed and edited before publication.

## 2026-04-24: Store Settings In The Main Process

Decision:

Persist initial app settings through a typed main-process settings store and expose them to the renderer through a preload IPC bridge.

Reason:

The renderer should not own filesystem access. Keeping settings in the Electron main process creates a cleaner boundary for future local model paths, privacy/offline settings, insertion defaults, and Windows helper configuration.

## 2026-04-24: Use Rust For The Windows Helper

Decision:

Build the native Windows helper in Rust.

Reason:

Rust gives VoxType a small, memory-safe native executable with good Windows API access through the `windows` crate. It is a good fit for foreground-window detection, clipboard/paste helpers, keyboard injection, screenshot support, and future privilege-boundary handling.

## 2026-04-24: Make System Audio Muting Optional

Decision:

VoxType should offer an opt-in setting that mutes Windows system audio while microphone recording is active, then unmutes after recording stops.

Reason:

Muting playback during capture can prevent speaker audio from bleeding into dictation, but it changes global system state, so the behavior should be controlled by the user.

## 2026-04-24: Direct Typing Must Be Keyboard-Layout Independent

Decision:

VoxType's direct typing path should send Unicode text rather than layout-dependent virtual key presses.

Reason:

Users may dictate in one language while Windows is using another keyboard layout. Dictation insertion should preserve the transcript text instead of changing behavior based on the active keyboard layout.

## 2026-04-24: Add Local VAD Before OCR Polish

Decision:

Add voice activity detection and silence trimming as Phase 3.5, directly after the dictionary/correction-memory work and before the larger OCR phase.

Reason:

VAD materially improves the everyday dictation loop by avoiding silence/noise transcription and trimming audio before Whisper. It should not end recording automatically; the user remains in control through the hotkey or UI. It is foundational enough to plan immediately, but separate enough from dictionary and OCR to deserve its own roadmap slice.

## 2026-04-24: Prefer Silero VAD Through ONNX

Decision:

Use Silero VAD as the preferred first VAD candidate, deployed locally through ONNX Runtime rather than Python/Torch.

Reason:

Silero VAD is small, fast on CPU, supports the 16 kHz audio path VoxType already uses, has broad speech/noise training coverage, and can be packaged for a local Windows Electron app without requiring a Python environment.

## 2026-04-24: Use App Hotkey Automation For Microphone Coordination First

Decision:

Superseded by `2026-04-25: Layer Microphone Coordination Around Exclusive Capture`.

Reason:

Research and testing showed that WASAPI exclusive capture is a better first-class device-level strategy than hotkey automation when the user wants other apps blocked from the microphone. Hotkey automation remains useful as a global fallback for app-native state sync.

## 2026-04-25: Use Native CPAL Recording As Only Capture Path

Decision:

VoxType should use the Rust Windows helper as the microphone recorder, using CPAL for device capture and Rubato for 16 kHz resampling. The browser `AudioWorkletNode` recorder should not be used as a fallback.

Reason:

Long VoxType recordings started crackling around the 25-30 second mark even when Silero VAD was disabled, which points to the browser/WebAudio capture path rather than VAD trimming. Handy does not show the same problem and uses native CPAL capture plus Rubato resampling, so VoxType should follow that architecture for stable Windows dictation.

## 2026-04-25: Run Silero VAD In The Native Helper

Decision:

VoxType should run Silero VAD in the Rust Windows helper using Handy's approach: `vad-rs`, `silero_vad_v4.onnx`, 30 ms frames, and `SmoothedVad` prefill/hangover/onset smoothing.

Reason:

Keeping capture, resampling, and VAD in the same native pipeline avoids renderer/WebAudio timing issues, removes ONNX Runtime Web from the transcription path, and matches the Handy integration that behaved better during audio-quality testing.

## 2026-04-25: Layer Microphone Coordination Around Exclusive Capture

Decision:

VoxType should offer layered microphone coordination: shared capture as the default, WASAPI exclusive capture as the preferred device-level way to block other microphone consumers, and global app-native hotkey automation as a compatibility fallback.

Reason:

Testing confirmed that capture-session mute can prevent Discord from receiving audio but can also leave VoxType with no detected speech. WASAPI exclusive capture keeps VoxType as the recorder while preventing other shared-mode consumers when Windows allows exclusive access. Discord hotkey automation is still valuable because it updates Discord's own mute state and UI, but it does not need to be profile-bound for the first implementation.

## 2026-04-25: Prefer Windows Media OCR For Phase 4

Decision:

VoxType should target Windows Media OCR as the preferred first OCR engine for Phase 4.

Reason:

VoxType works with Windows screenshots, and local testing showed the native Windows OCR path is fast enough for the screen-aware dictation loop without introducing a managed Python runtime, large model downloads, or slow warm-up costs.

## 2026-04-26: Treat Phase 4 OCR As Good Enough For Now

Decision:

Phase 4 OCR context is sufficient to move on after the initial Windows Media OCR, target-window screenshot, term extraction, prompt-context, post-processing, diagnostics, and dictionary-promotion work. The final user-facing OCR control should be a simple enable/disable setting, while raw OCR text, rejected terms, prompt previews, and correction diagnostics stay in a developer/debug view.

Reason:

OCR is tricky and will not perfectly fix every difficult visible word even when the word appears in the screenshot. The current rejection/filtering behavior is useful, and the feature now provides enough screen-aware context to keep, but higher-priority VoxType work should take precedence over deeper OCR tuning.

## 2026-04-26: Make GPU Acceleration The First Phase 5 Priority

Decision:

Phase 5 should start with Whisper GPU acceleration planning and implementation. VoxType should first detect GPU capability and VRAM, then recommend or select CUDA/Vulkan-capable Whisper runtimes only when the user's hardware and selected model are suitable.

Reason:

Whisper can use GPUs when the runtime supports it, and `whisper.cpp` has practical CUDA and Vulkan paths. VoxType currently installs a CPU-only managed runtime, so the safe next step is hardware/VRAM detection and model compatibility reporting before adding automatic GPU runtime acquisition.

## 2026-04-27: Use Managed CUDA And Custom Vulkan Runtime Selection

Decision:

VoxType should support GPU transcription through a runtime backend preference: `auto`, `cpu`, `cuda`, and `vulkan`. CUDA uses managed official `ggml-org/whisper.cpp` v1.8.4 Windows archives for CUDA 12.4 and CUDA 11.8. Vulkan is exposed as a selectable/custom runtime backend until VoxType ships a Vulkan build or upstream publishes a Windows Vulkan zip.

Reason:

The official `whisper.cpp` v1.8.4 release publishes CPU and CUDA Windows binaries, but no Windows Vulkan archive. This lets NVIDIA users get managed GPU acceleration now while preserving the cross-vendor Vulkan path without pretending there is an official downloadable runtime that does not exist.

## 2026-04-27: Move Dense UI Behind Developer Mode

Decision:

The current dense VoxType interface should be treated as a developer/debug UI and hidden behind a persisted developer mode setting. The default app surface should become a simpler end-user dictation home.

Reason:

The current UI is useful for building and diagnosing models, OCR, insertion, and runtime behavior, but it exposes too many implementation details for release users. Hiding it preserves engineering velocity while making room for a calmer product UI.

## 2026-04-27: Keep The Main UI Setup-Focused

Decision:

The default VoxType UI should be organized around General, Hotkeys, and Models tabs. It should not include an in-app record button because recording is triggered from outside the app through global hotkeys and target-app workflows. Advanced settings and diagnostics should remain in developer mode.

Reason:

Release users need to set up models, hotkeys, and a small number of product-level preferences, but they should not have to understand runtime internals or press buttons inside VoxType during normal dictation.

## 2026-04-27: Default To Capable Behavior With Internal Fallbacks

Decision:

User-facing defaults should choose the strongest practical behavior when a fallback exists. VAD should be enabled by default, recording coordination should prefer `exclusiveCapturePreferred`, and model/runtime selection should prefer the highest-quality compatible option before falling back automatically.

Reason:

VoxType should feel like it chooses the best local dictation path for the user instead of asking them to tune implementation settings up front. Fallbacks are still important, but they should make the product more resilient rather than adding setup burden.
