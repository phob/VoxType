# Models

## Current Decision

Use Whisper as the main ASR engine.

Parakeet V3 should remain a later optional engine because its custom vocabulary and hotword behavior is more runtime-dependent, especially for Windows-friendly ONNX deployments.

## Whisper-First Strategy

Recommended initial backend:

- `whisper.cpp`

Reasons:

- Mature local inference ecosystem.
- Good Windows portability.
- Broad language support.
- Supports multiple model sizes.
- Can be packaged as native binaries.
- Has practical CPU and GPU acceleration paths.
- Can be prompted with context, even if it cannot truly learn new vocabulary at runtime.

Initial model options:

- `base`: smallest practical starting point.
- `small`: likely default for many users.
- `medium`: higher accuracy for good machines.
- `large-v3-turbo`: advanced/high-quality option if hardware allows.

Exact model names, quantization levels, and download sources should be pinned later with checksums.

## Whisper Dictionary Limitation

Whisper cannot simply add new vocabulary like a traditional dictionary where the model learns the word. VoxType should compensate with:

- initial prompt context
- OCR-derived temporary vocabulary
- user dictionary replacements
- correction memory
- app-specific formatting

The dictionary should be a VoxType feature around Whisper, not a promise that Whisper itself learns new words.

## Transcript Consistency

Whisper punctuation and casing can vary noticeably between recordings, even with the same user and model.

Likely causes:

- audio quality differences, especially clipping, noise, room echo, or VAD trimming artifacts
- missing natural pause cues when speech is too continuous or silence is cut too aggressively
- model size and language mode differences
- decoding settings such as temperature fallback, beam size, and context carryover
- prompt/context changes from dictionary or OCR terms
- chunk boundaries, especially when the model does not see enough before/after context

VoxType should treat ASR as the raw transcript source and add a separate local consistency layer for the final inserted text. That layer can normalize punctuation, casing, spacing, and app-specific style without pretending the ASR model itself is always stable.

Implementation direction:

- keep raw ASR output in transcript history
- store final post-processed text separately
- expose style levels through app profiles, such as raw, clean dictation, chat, professional, terminal, and code
- keep Whisper decoding settings pinned per model/profile so behavior does not drift unexpectedly
- add local punctuation/casing restoration later if Whisper output remains inconsistent

## Parakeet V3 Later

Parakeet V3 is interesting as an optional engine later:

- likely fast
- multilingual for supported European languages
- good punctuation/capitalization
- strong candidate for real-time dictation

Known reasons not to make it the primary engine now:

- official deployment path is more NVIDIA/NeMo-oriented
- Windows packaging may rely on ONNX or community conversion
- hotword/custom vocabulary behavior depends on runtime support
- language coverage is narrower than Whisper
- long-audio and streaming behavior may vary by runtime

Parakeet should fit behind the same ASR provider interface.

## OCR Models

OCR is a core feature because it feeds the live dictionary/context system.

Preferred OCR direction:

- Windows Media OCR should be the first OCR engine for Phase 4 because VoxType is OCRing Windows screenshots, and the native API is fast, local, package-light, and good enough for the first screen-aware dictation loop.
- Heavier OCR engines should remain future options only if Windows Media OCR cannot handle important screenshot cases.

Implementation direction:

- Keep OCR behind a provider-shaped service boundary so future engines can share the same screenshot-to-context pipeline if needed.
- Initial implementation uses `native/windows-helper ocr-image`, which loads screenshots into a WinRT `SoftwareBitmap` and recognizes text with `Windows.Media.Ocr`.
- Local smoke testing through the Rust helper was sub-second including helper process startup, with the Windows OCR engine itself reporting low hundreds of milliseconds on active-window screenshots.
- Treat startup latency, package size, offline behavior, and screenshot accuracy as first-class acceptance criteria before considering any heavier OCR backend.

OCR should support:

- region screenshot OCR
- active window OCR
- full screen OCR
- extraction of likely vocabulary terms
- extraction of error codes, file names, hostnames, product names, and technical identifiers

## Voice Activity Detection

VAD should become part of the core local audio pipeline.

Preferred first candidate:

- Silero VAD through ONNX Runtime.

Current implementation:

- `@ricky0123/vad-web` NonRealTimeVAD
- bundled Silero legacy ONNX model
- bundled ONNX Runtime Web/WASM assets
- post-recording trimming before Whisper transcription
- conservative first/last speech envelope trimming instead of internal pause cutting
- Web Audio offline resampling before VAD/Whisper, with linear fallback
- no automatic recording stop behavior

Handy comparison:

- Handy uses `vad-rs` with `silero_vad_v4.onnx`.
- Handy feeds Silero 30 ms frames.
- Handy wraps Silero in `SmoothedVad` with prefill frames, hangover frames, and onset confirmation.
- Handy uses a Rubato FFT resampler before VAD/Whisper.
- VoxType should consider a native/helper VAD path if browser-side VAD remains unstable.

Reasons:

- small model size
- fast CPU inference
- works with 16 kHz audio, which matches the current VoxType recorder path
- broad language/noise training background
- permissive MIT license
- practical local deployment through ONNX without Python/Torch

Initial behavior:

- detect speech start
- keep a short pre-roll buffer
- ignore short noise bursts
- trim leading and trailing silence before Whisper transcription
- optionally trim long internal silent spans while preserving natural short pauses
- never stop the recording session automatically
- expose conservative sensitivity presets before exposing advanced knobs

Limitations:

- VAD detects speech activity, not intent or "the user is done thinking".
- It may false-trigger on TV, voices from speakers, or noisy rooms.
- It needs threshold and silence-duration tuning per microphone/environment.
- It must preserve manual hotkey control; VAD should improve captured audio, not decide when recording ends.

Possible alternatives or fallbacks:

- WebRTC VAD for a smaller traditional baseline if Silero packaging is too heavy.
- Native ONNX Runtime worker if ONNX Runtime Web/WASM is awkward inside Electron packaging.
- Later automatic stopping based on pauses or transcript meaning could be explored as a separate optional feature, but it is not part of the intended Silero VAD role.

## Model Manager

The app needs a model manager with:

- model catalog
- download, pause, resume, delete
- checksum verification
- storage location display
- active model selection
- model compatibility checks
- CPU/GPU backend selection where available
- offline mode after install

Each model entry should show:

- size
- language support
- speed estimate
- accuracy tier
- RAM/VRAM requirement
- source/license
- local path

VAD assets should be shown in the same model/runtime management philosophy as ASR and OCR assets, even if the UI presents them as "speech detection runtime" rather than a user-facing transcription model.
