# Cloud Dictation

Cloud Dictation is the planned opt-in exception to VoxType's local-first default. It should improve dictation accuracy and enable realtime preview while making the cloud boundary obvious and controllable.

## Decisions

- VoxType remains local-first by default. New users start on a local Dictation Mode.
- Cloud Dictation is opt-in and requires one-time consent before first enablement.
- The primary UI concept is **Dictation Mode**, not raw model or backend.
- Dictation Modes use stable domain-level IDs such as `local.fast`, `local.balanced`, `local.accuracy`, `local.custom`, `openai.realtime`, `openai.accuracy`, and `openai.economy`.
- Dictation Modes show beginner-friendly labels with exact provider/model identifiers visible as secondary text.
- OpenAI Cloud Dictation is BYOK first, using one OpenAI API key per Windows user stored in the OS credential store. Development may use an environment-variable override.
- A Codex or ChatGPT subscription does not replace OpenAI API access for these transcription models.
- Cloud Dictation sends microphone audio and a compact Prompt Pack to OpenAI only for modes that support provider prompt text.
- The Prompt Pack always includes selected Dictionary terms for Cloud Dictation modes that support Prompt Pack text.
- OCR Context is not sent to cloud by default; it is controlled by a global setting with App Profile override.
- The full Dictionary, screenshots, transcript history, and insertion target contents are not sent.
- Cloud Dictation must show persistent provider/status UI whenever active.
- Offline Mode disables Cloud Dictation. If enabled during an active Cloud Dictation session, the session is terminated immediately.
- App Profiles can forbid Cloud Dictation. If global Cloud Dictation is active in such an app, VoxType uses local dictation when ready, otherwise blocks with a clear message.
- Cloud failures fail clearly at first; there is no general automatic local fallback.
- Cloud Dictation works regardless of transcript history settings.

## OpenAI Dictation Modes

- **Realtime cloud** — `gpt-realtime-whisper`
  - Uses streaming transcription and Live Preview.
  - VoxType hotkey owns the dictation session lifecycle.
  - Does not send Prompt Pack text because `gpt-realtime-whisper` rejects the realtime transcription `prompt` parameter.
  - Does not use OpenAI server VAD because current realtime transcription docs say to omit `turn_detection` or set it to `null` for `gpt-realtime-whisper`.
  - VoxType manually commits the input audio buffer when the hotkey session stops.
  - Target apps receive final text only; partial text is never live-typed into the target app.
- **Cloud accuracy** — `gpt-4o-transcribe`
  - Uses the existing record -> local VAD trim -> transcribe -> insert flow.
- **Cloud economy** — `gpt-4o-mini-transcribe`
  - Uses the existing record -> local VAD trim -> transcribe -> insert flow at lower cost.

## Local Dictation Modes

Beginner local modes should use parallel labels:

- **Local fast**
- **Local balanced**
- **Local accuracy**

The exact Whisper model remains visible as secondary text. Beginner modes should prefer multilingual models. `.en` variants belong in the advanced exact-model picker. Local accuracy should prefer `large-v3-turbo` when hardware/runtime fit, with fallback recommendations when needed. If a user chooses an exact local Whisper model, the selected Dictation Mode becomes `local.custom` with the exact model stored separately. OpenAI does not get an `openai.custom` mode initially; only tested OpenAI modes are exposed.

## Realtime Behavior

- Realtime Cloud Dictation uses native helper streaming capture -> Electron main -> OpenAI WebSocket.
- On hotkey press, native capture starts immediately and buffers up to 5 seconds of pre-connection audio while the OpenAI session becomes ready.
- If the OpenAI session cannot connect within the buffer window, recording stops and VoxType shows a clear error.
- VoxType does not keep a full-session audio buffer for realtime Cloud Dictation initially.
- Realtime Cloud Dictation should stream mostly raw captured audio and manually commit the input buffer on stop. `gpt-realtime-whisper` does not currently support server VAD in transcription sessions.
- Local VAD trimming settings do not configure OpenAI realtime behavior.
- Realtime should use provider-aware audio configuration; OpenAI realtime should request 24 kHz PCM.
- Realtime latency presets are advanced settings: Fast, Balanced, Accurate. Default is Balanced.
- Presets tune the `gpt-realtime-whisper` transcription `delay` hint.
- The old raw server VAD threshold debug setting is ignored for `gpt-realtime-whisper`.

## Live Preview

- Live Preview appears in the recording overlay.
- Main-window details are limited to developer/debug surfaces.
- Overlay shows a rolling 3-5 line preview of completed turns plus the current provisional turn.
- Provisional partial text is visually distinct from completed Transcript Turns.
- When recording stops, the overlay remains visible in a Finalizing state until insertion succeeds or fails.
- On stop, VoxType stops recording, commits/flushes as needed, and waits briefly for final completion. If no final completion arrives, a bounded partial fallback may be used and history should mark that fallback.

## Transcript Turn Composition

- Realtime transcription events are accumulated by provider item ID.
- Each Transcript Turn tracks provider item ID, provisional text, final text, status, and first-seen sequence number.
- Final insertion composes completed turns in sequence order.
- Provider formatting wins over default separators. If adjacent turns contain structural formatting such as newlines or list markers, use newline boundaries; otherwise use the profile/mode separator.
- Partial transcripts are never used for correction learning.

## Corrections And History

- Explicit Dictionary correction memory applies to Cloud Dictation output.
- Heuristic OCR-term post-corrections are disabled for Cloud Dictation initially because OCR terms may already be in the Prompt Pack.
- `fix last dictation` works for Cloud Dictation and saves local correction memory as usual.
- History stores one entry per hotkey Dictation Session.
- History should include provider, exact model ID, Dictation Mode ID, duration sent, and turn count/status.
- History should store both `dictationModeId` and raw `modelId` so future mode remapping does not obscure what actually ran.
- `rawText` should be the provider-final composed text before local corrections, stored only when it differs from final inserted text.
- Normal history should not store turn-by-turn JSON or Prompt Pack by default.
- Non-realtime Cloud Dictation respects the existing/global audio history behavior for saving processed WAV audio.
- Realtime Cloud Dictation does not save audio initially, even if audio history is enabled. History/details should note that audio playback is not saved for Realtime cloud dictation.

## Implementation Scope

- The first public/release Cloud Dictation surface should expose Cloud Dictation only when all three OpenAI modes are functional: Realtime cloud, Cloud accuracy, and Cloud economy.
- Internally, implementation may be staged: provider architecture and file transcription paths can be built before realtime streaming.
- Developer/debug UI may expose partial cloud work during development for testing, but release UI should wait for the complete three-mode cloud feature.
- The first implementation success bar is functional: mode selection, consent, API key storage, audio plus Prompt Pack submission, transcript return, explicit local corrections, insertion, and clear failure handling. A formal accuracy benchmark is not required before the first implementation.

## Setup And Validation

- The release Home page owns the global Dictation Mode selector so the default transcription path is part of everyday setup.
- Cloud-specific controls live on a dedicated Cloud page instead of the general Settings page.
- The Cloud page is only visible when Offline Mode is off; Offline Mode remains the general Settings kill switch for network use.
- Cloud modes can be selected before an API key exists, but dictation is blocked before recording until setup is complete.
- The setup surface should include a Test connection action.
- Default testing validates the API key plus the currently selected OpenAI mode. A future advanced action may test all OpenAI modes.
- Unavailable OpenAI modes remain visible but disabled with a reason.
- Cloud Dictation errors show a friendly summary with expandable technical details.
- Logs should include metadata only: provider, model, duration, status/error code. Never log audio, Prompt Pack, transcript text, or API key.

## Consent Wording

Suggested one-time consent copy:

> When Cloud Dictation is enabled, VoxType sends your microphone audio and a compact Prompt Pack to OpenAI for transcription. The Prompt Pack may include selected words from your Dictionary and, if you enable it, visible text extracted from the target app. VoxType does not send your full Dictionary, transcript history, screenshots, or insertion target contents. Cloud Dictation is disabled in Offline Mode and can be blocked for specific App Profiles.

## Prompt Pack Preview

- Settings/debug surfaces should offer an expandable preview of context that may be sent.
- If OCR-to-cloud is enabled, the preview should include OCR Context terms.
- Do not interrupt each dictation with a Prompt Pack preview.

## Documentation Timing

- Keep public README/Product language stable until implementation exists.
- Update public docs during the implementation PR to say local-first by default with opt-in Cloud Dictation.
