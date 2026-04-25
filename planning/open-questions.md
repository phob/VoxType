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
- Which accelerated `whisper.cpp` runtime should be added after CPU x64: Vulkan, CUDA, or both?
- Should managed `whisper.cpp` runtimes be downloaded from official GitHub releases at first run, bundled into the installer, or mirrored with VoxType-owned checksums?
- Should Silero VAD assets be bundled with the installer, downloaded on first use, or managed like the Whisper runtime with checksums?
- Should VAD run in a renderer Web Worker through ONNX Runtime Web/WASM, or in a separate native/helper process through ONNX Runtime?
- What should the default VAD silence-trimming values be for Windows dictation: threshold, minimum speech duration, pre-roll, trailing silence, and internal pause preservation?
- Should Discord be detected and offered a guided setup for the global recording coordination hotkey?
- Should VoxType eventually add per-app recording coordination profiles, or is a global hotkey fallback enough alongside WASAPI exclusive capture?
- Should VoxType expose which exclusive hardware format was selected for diagnostics?
- Which OCR engine should ship first: Tesseract or PaddleOCR?
- How should model downloads be hosted and verified?
- Should inference workers communicate with Electron through stdio, named pipes, local HTTP, or another IPC mechanism?
- How should VoxType detect and handle elevated target apps?
- How much transcript history should be stored by default?
- Should system-audio mute restore the previous mute state instead of always unmuting after VoxType finishes recording?

## UX

- What should the first-run onboarding flow look like?
- Should model download happen before the app is usable, or only when the user starts dictating?
- How should the user choose between paste, direct typing, and remote mode?
- What should "fix last dictation" look like?
- How should uncertain words be highlighted without slowing down fast dictation?
