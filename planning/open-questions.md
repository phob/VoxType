# Open Questions

## Product

- Should VoxType show a transcript review overlay by default, or insert immediately by default?
- Should the app be power-user-first or beginner-friendly-first?
- Should dictionary learning be automatic, manual, or suggested?

## Technical

- Which Whisper model should be the default first-run recommendation?
- Should Discord be detected and offered a guided setup for the global recording coordination hotkey?
- Should VoxType eventually add per-app recording coordination profiles, or is a global hotkey fallback enough alongside WASAPI exclusive capture?
- Should VoxType expose which exclusive hardware format was selected for diagnostics?
- What screenshot cases, languages, or UI layouts would justify adding a heavier OCR engine beyond Windows Media OCR?
- How should model downloads be hosted and verified?
- Should inference workers communicate with Electron through stdio, named pipes, local HTTP, or another IPC mechanism?
- Is VibeVoice-ASR practical for VoxType's local Windows dictation loop given its Python/Transformers/vLLM deployment path, 7B/8B-class BF16 model size, and long-form orientation?
- How should VoxType detect and handle elevated target apps?
- How much transcript history should be stored by default?
- Should system-audio mute restore the previous mute state instead of always unmuting after VoxType finishes recording?

Resolved before first GitHub release:

- Native helper language is Rust.
- Silero VAD runs inside the Rust Windows helper, not in the renderer.
- The Silero VAD asset is bundled with the installer as an Electron extra resource.
- Initial VAD trimming defaults are implemented and can be tuned later from developer settings.

## UX

- What should the first-run onboarding flow look like?
- Should model download happen before the app is usable, or only when the user starts dictating?
- How should the user choose between paste, direct typing, and remote mode?
- What should "fix last dictation" look like?
- How should uncertain words be highlighted without slowing down fast dictation?
