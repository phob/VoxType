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
