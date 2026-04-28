<p align="center">
  <img src="resources/icons/voxtype-logo-transparent.png" alt="VoxType logo" width="160" />
</p>

# VoxType

VoxType is state-of-the-art voice recognition software for Windows: local-first, privacy-focused, screen-aware dictation built for people who want fast, reliable speech-to-text across real Windows apps.

It is designed to feel like the best Windows dictation tool: press a global hotkey, speak naturally, and let VoxType transcribe locally, understand the active app, and insert the result where you were working.

## Why VoxType

- **Windows-first dictation**: built around global hotkeys, native Windows app detection, and reliable insertion into desktop apps.
- **Local-first privacy**: transcription, OCR context, dictionary behavior, and correction memory are designed to run locally.
- **Whisper-powered recognition**: uses managed `whisper.cpp` runtimes with local model downloads.
- **Screen-aware context**: local OCR can read the active window and bias transcription toward visible names, terms, codes, and UI text.
- **App profiles**: VoxType can adapt insertion mode, writing style, language, and send-after-insert behavior per target app.
- **Remote-safe insertion modes**: clipboard paste, Unicode typing, chunked typing, and remote-oriented profile defaults help with apps like Remote Desktop and TeamViewer.
- **Native audio path**: recording runs through a Rust Windows helper with local Silero VAD support for cleaner dictation audio.

## First Release Notes

VoxType is currently preparing its first public GitHub release. The initial Windows installer is expected to be unsigned, so Windows SmartScreen may warn before installation.

Screenshots and release badges will be added here as the release page settles.

## Installation

1. Download the latest `VoxType-Setup-*-x64.exe` installer from the GitHub Releases page.
2. Run the installer.
3. Start VoxType and choose your preferred model, hotkey, and insertion settings.
4. Press the dictation hotkey from any Windows app and speak.

## License

License information will be added before broader distribution.
