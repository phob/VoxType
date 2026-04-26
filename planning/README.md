# VoxType Planning

This directory is the living planning memory for VoxType.

Read this directory first in future sessions before making product or architecture decisions. Keep these files updated whenever ideas, priorities, model choices, or implementation decisions change.

## What VoxType Is

VoxType is a Windows-first, local-first speech-to-text app built with Electron. It should feel like the go-to dictation tool for Windows users who need privacy, reliability, app compatibility, and smart context awareness.

The core idea:

> VoxType does not only transcribe what the user says. It understands the screen, the target app, and the user's personal vocabulary well enough to type the right thing in the right place.

## Current Direction

- Main ASR engine: Whisper, likely through `whisper.cpp`.
- Current Phase 5 priority: GPU acceleration, starting with automatic GPU/VRAM detection and model fit checks before managed CUDA/Vulkan runtime selection.
- Optional later ASR engine: Parakeet V3 or newer Parakeet models.
- Main OS target: Windows.
- App shell: Electron with TypeScript.
- Native Windows helper: required for global hotkeys, typing, clipboard, screenshots, and app detection.
- OCR: local-only OCR used both for screenshot text extraction and live vocabulary/context.
- Dictionary: local user dictionary plus OCR-derived temporary dictionary and post-processing corrections.

## File Map

- [product-vision.md](product-vision.md): product identity, principles, target users, standout ideas.
- [architecture.md](architecture.md): technical structure and main components.
- [models.md](models.md): ASR/OCR model strategy, Whisper-first direction, Parakeet notes.
- [dictionary-and-context.md](dictionary-and-context.md): custom vocabulary, OCR context, correction memory.
- [windows-insertion.md](windows-insertion.md): typing, clipboard, SendInput, UI Automation, RDP/TeamViewer behavior.
- [features.md](features.md): feature inventory and standout product ideas.
- [roadmap.md](roadmap.md): phased implementation plan.
- [release-and-changelog-strategy.md](release-and-changelog-strategy.md): release automation, Conventional Commits, and public changelog strategy.
- [decisions.md](decisions.md): decisions already made and why.
- [open-questions.md](open-questions.md): unresolved product and technical questions.
- [ideas-backlog.md](ideas-backlog.md): rough ideas to revisit later.
- [changelog.md](changelog.md): planning updates over time.

## Update Rules

When new ideas come up:

1. Add rough ideas to `ideas-backlog.md`.
2. Promote accepted ideas into `features.md`, `architecture.md`, or another specific file.
3. Record major decisions in `decisions.md`.
4. Add unresolved questions to `open-questions.md`.
5. Add a short note to `changelog.md`.

These docs are allowed to evolve. They should not be treated as frozen requirements.

## Planning Steward Skill

A project-specific Codex skill exists at:

```text
C:\Users\pho\.codex\skills\voxtype-planning-steward
```

Use it when discussing VoxType ideas, decisions, architecture, roadmap, models, dictionary/context behavior, OCR, or Windows insertion behavior. The skill's job is to keep this planning directory current over time.
