# Open Questions

## Product

- Should VoxType show a transcript review overlay by default, or insert immediately by default?
- Should the app be power-user-first or beginner-friendly-first?
- Should dictionary learning be automatic, manual, or suggested?
- How visible should OCR context be to users?
- Should screen-aware dictation require an explicit screenshot hotkey, or should it happen automatically for active windows?

## Technical

- Should the native helper be written in Rust or C++?
- Which Whisper model should be the default first-run recommendation?
- Which `whisper.cpp` binary/backend should be packaged first: CPU-only, Vulkan, CUDA, or multiple?
- How should VoxType bundle or acquire the `whisper.cpp` executable for Windows instead of requiring the user to set `whisperExecutablePath`?
- Which OCR engine should ship first: Tesseract or PaddleOCR?
- How should model downloads be hosted and verified?
- Should inference workers communicate with Electron through stdio, named pipes, local HTTP, or another IPC mechanism?
- How should VoxType detect and handle elevated target apps?
- How much transcript history should be stored by default?

## UX

- What should the first-run onboarding flow look like?
- Should model download happen before the app is usable, or only when the user starts dictating?
- How should the user choose between paste, direct typing, and remote mode?
- What should "fix last dictation" look like?
- How should uncertain words be highlighted without slowing down fast dictation?
