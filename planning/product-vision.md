# Product Vision

## Product Name

VoxType

## One-Line Vision

VoxType is a local-first Windows dictation app that turns speech into accurate text anywhere, using local models, screen-aware context, and reliable insertion into third-party apps.

## Positioning

VoxType should not be "just another Whisper UI." Its differentiator is that it understands the user's working context:

- What app is active.
- What text is visible on screen.
- What words the user commonly corrects.
- Whether the target app supports paste, direct typing, or needs a slower remote-desktop-safe insertion mode.

The app should feel practical, private, and deeply Windows-native.

## Target Users

- Windows power users who dictate into many apps.
- Developers and technical users who need code words, file names, product names, and abbreviations recognized.
- Support, sales, operations, and admin workers who type repetitive text into remote sessions, CRMs, ticket systems, and office apps.
- Privacy-conscious users who do not want cloud transcription.
- Users who work with TeamViewer, Remote Desktop, AnyDesk, virtual machines, or admin tools.

## Core Principles

- Local-first by default.
- No cloud dependency for core transcription, OCR, dictionary, or insertion.
- Windows compatibility is a first-class product feature.
- Model downloads should be explicit, verified, and user-controlled.
- Users should understand what model is active and where it is stored.
- Dictation should work outside normal input fields, including remote and legacy apps where possible.
- Corrections should make VoxType smarter over time without retraining large models.

## Signature Idea

VoxType should understand the thing the user is looking at.

The user can take a screenshot or let VoxType inspect the active screen locally. OCR extracts visible terms and uses them as temporary context for the next dictation. This helps with names, technical terms, error codes, UI labels, server names, customer names, and domain-specific vocabulary.

Example:

```text
Visible on screen:
TeamViewer, OpenVPN, Kundenauftrag, InitializeComponent, HRESULT, 192.168.178.42

Speech:
"please check the open vpn tunnel and the h result in initialize component"

Preferred output:
"Please check the OpenVPN tunnel and the HRESULT in InitializeComponent."
```

## Product Feeling

VoxType should feel:

- Fast.
- Private.
- Dependable.
- Technical when needed, but not intimidating.
- Calm and useful rather than flashy.
- Built for real Windows work, including messy third-party apps.

