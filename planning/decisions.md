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

For apps like Discord that also use the microphone, VoxType should first support per-app recording actions that send a configured mute/unmute hotkey when VoxType recording starts and stops.

Reason:

Windows does not provide a simple reliable public control for muting only another application's microphone capture while keeping VoxType recording from the same device. Muting the physical input endpoint risks muting VoxType too. App-level hotkey automation is more practical, reversible, user-controlled, and fits VoxType's existing per-app profile direction.

## 2026-04-25: Use Native CPAL Recording As Primary Capture Path

Decision:

VoxType should use the Rust Windows helper as the primary microphone recorder, using CPAL for device capture and Rubato for 16 kHz resampling. The browser `AudioWorkletNode` recorder should remain only as a fallback.

Reason:

Long VoxType recordings started crackling around the 25-30 second mark even when Silero VAD was disabled, which points to the browser/WebAudio capture path rather than VAD trimming. Handy does not show the same problem and uses native CPAL capture plus Rubato resampling, so VoxType should follow that architecture for stable Windows dictation.
