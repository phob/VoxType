# Cloud Dictation Implementation Status

Last reviewed: 2026-05-21

This document captures the current implementation state against
[cloud-dictation-prd.md](cloud-dictation-prd.md). It is a handoff snapshot for
continuing Cloud Dictation work without reconstructing state from chat history.

## Overall Status

Cloud Dictation is partially implemented and still developer-preview quality.

File-based OpenAI dictation is closest to the PRD. Realtime OpenAI dictation has
the session API shape mostly resolved, but live native PCM streaming is not
proven in the real app path. Current realtime finalization includes a fallback
that sends the stopped recording WAV to the realtime session if no live PCM
chunks reached OpenAI. That fallback is useful for functionality/debugging, but
it is not the intended final realtime architecture.

Normal release exposure should remain gated until the cloud release smoke tests
are completed.

## Implemented

- Dictation Mode IDs exist for `local.fast`, `local.balanced`,
  `local.accuracy`, `local.custom`, `openai.realtime`, `openai.accuracy`, and
  `openai.economy` in `src/shared/asr.ts`.
- Beginner-facing OpenAI modes exist:
  - Realtime cloud: `gpt-realtime-whisper`
  - Cloud accuracy: `gpt-4o-transcribe`
  - Cloud economy: `gpt-4o-mini-transcribe`
- OpenAI API key storage exists through Electron `safeStorage` in
  `src/main/openai-credential-store.ts`, with an `OPENAI_API_KEY` environment
  override for development.
- Cloud Dictation consent, API key entry, Offline Mode, cloud file audio
  history, realtime latency preset, cloud session warning/max duration, and OCR
  Prompt Pack controls exist in the Settings UI.
- Cloud readiness checks block cloud recording when consent, API key, or
  Offline Mode requirements are not satisfied.
- App Profiles can forbid Cloud Dictation and fall back to `local.balanced`.
- File cloud dictation uses `/v1/audio/transcriptions` through
  `OpenAiFileAsrProvider`.
- File cloud modes send processed WAV bytes plus allowed Prompt Pack text.
- Cloud Prompt Pack limits are implemented: 50 terms and 1,000 characters.
- Cloud Prompt Pack excludes `whisperPromptOverride`-style text.
- OCR Context inclusion for cloud Prompt Pack is opt-in globally and can be
  overridden per App Profile.
- Explicit dictionary correction memory is applied after file cloud results.
- Realtime provider exists through `OpenAiRealtimeAsrProvider`.
- Realtime connection uses:
  - `wss://api.openai.com/v1/realtime?intent=transcription`
  - `session.update`
  - `session.type = "transcription"`
  - nested `audio.input.transcription.model = "gpt-realtime-whisper"`
- Realtime session uses 24 kHz PCM16 mono audio configuration.
- Native realtime PCM emission is now explicitly requested only for
  `openai.realtime` recordings through the Electron recording options and the
  Windows helper `--emit-realtime-pcm16` flag. Local and OpenAI file modes keep
  realtime PCM emission disabled.
- Realtime turn accumulation exists through `TranscriptTurnAccumulator`.
- Realtime sessions keep `audio.input.turn_detection` set to `null` because
  `gpt-realtime-whisper` does not support OpenAI server VAD in transcription
  sessions. Latency presets tune only the transcription `delay` hint.
- Realtime history entries store provider/mode/model, turn count/status, raw
  text when changed by corrections, and `audioUnavailableReason`.
- Realtime final text insertion remains final-only; partials are preview-only.
- Realtime audio playback is not saved in history.
- Cloud logging helpers assert metadata-only log entries.
- Error handling now preserves sanitized OpenAI error messages for request-shape
  debugging without logging full provider responses.
- Native recording diagnostics now travel with `NativeRecordingResult` and are
  shown in the developer Dictation panel. The diagnostics include helper path,
  requested capture mode, stdout line/event counts, recording level counts,
  realtime PCM chunk/byte counts, stderr byte count, process exit status, and
  final WAV metadata without retaining realtime audio payloads.

## Partially Implemented / Risky

- ASR Provider architecture is only partly complete. OpenAI file and realtime
  providers exist, but local Whisper transcription still lives directly in
  `TranscriptionService` instead of a local `FileAsrProvider`.
- Realtime live PCM streaming from the native helper is not proven in the real
  app path. Diagnostics showed:
  - `nativeChunks=0`
  - `nativeBytes=0`
  - `providerAppendedBytes=0`
  This means the app did not receive any `realtimePcm16Chunk` events during the
  tested realtime run, even though a standalone native-helper probe did emit
  realtime PCM chunks.
- Realtime has a fallback path that passes the stopped recording WAV into
  realtime finalize, converts it to 24 kHz mono PCM16, and appends it before
  commit if no live PCM reached OpenAI. This should help final transcript
  functionality, but it does not satisfy the PRD's live-preview streaming goal.
- Realtime native PCM streaming is explicitly requested in the app path, but it
  still needs a hotkey-driven app smoke test to confirm `nativeChunks > 0` and
  `providerAppendedBytes > 0` on the user's microphone/device setup.
- Realtime Prompt Pack is not sent to `gpt-realtime-whisper` because a live API
  check rejected the transcription `prompt` parameter for that model with
  `invalid_request_error / invalid_value`. File OpenAI modes still send the
  capped Prompt Pack.
- Realtime server VAD is not enabled for `gpt-realtime-whisper` because current
  OpenAI realtime transcription docs say to omit `turn_detection` or set it to
  `null` for this model and commit audio manually.
- Test connection checks `/v1/models/{modelId}` for the selected mode; it does
  not validate an actual OpenAI file transcription upload or realtime WebSocket
  handshake.
- Cloud mode release gating exists, but the release smoke-test checklist is all
  false in `src/shared/cloud-release-smoke-test.ts`.
- Developer builds can preview cloud modes despite release gating.
- History and correction behavior exist, but should be manually verified across
  all three OpenAI modes.
- Public README/Product docs still describe VoxType as local-first without
  advertising opt-in Cloud Dictation as implemented.

## Missing Against The PRD

- Verified transcript return from all three OpenAI modes:
  - `openai.realtime`
  - `openai.accuracy`
  - `openai.economy`
- End-to-end realtime live preview with native helper streaming.
- Reliable `realtimePcm16Chunk` delivery in the real app path.
- Realtime Prompt Pack support if OpenAI exposes a supported field or realtime
  transcription model for Prompt Pack text.
- Realtime server VAD turn behavior if OpenAI exposes support for
  `gpt-realtime-whisper` or another suitable streaming transcription model.
- OCR 1-second startup budget for realtime and warning when OCR is slow/fails.
- Dictionary-only realtime startup fallback when OCR misses the budget.
- Bounded partial fallback behavior fully verified and reflected in history.
- "Test all OpenAI modes" advanced validation.
- Expandable technical-details UI for cloud errors; current behavior is mostly
  direct error strings.
- Completed cloud release smoke tests:
  - Realtime end-to-end dictation
  - Cloud accuracy file dictation
  - Cloud economy file dictation
  - Offline Mode kill switch
  - App Profile cloud-forbid fallback
  - No sensitive cloud logs
- Public docs update for local-first with opt-in Cloud Dictation.

## Current Realtime Debugging State

The OpenAI realtime API shape was tested with the stored VoxType OpenAI key.
The working handshake is:

```text
wss://api.openai.com/v1/realtime?intent=transcription
event: session.update
session.type: transcription
audio.input.transcription.model: gpt-realtime-whisper
```

Known rejected shapes:

- `/v1/realtime/transcription_sessions` as a WebSocket path produced socket
  errors in the local harness.
- `transcription_session.update` is rejected by the GA realtime API.
- `OpenAI-Beta: realtime=v1` is rejected because the beta API is disabled.
- `gpt-realtime-whisper` cannot be the outer realtime session model.

The remaining realtime blocker is local app audio flow, not OpenAI session
setup. The app path reported zero native realtime chunks during a real
dictation attempt. A standalone native-helper probe with the configured mic did
emit realtime chunks, so the next debugging pass should focus on the Electron
main-process recording lifecycle, helper stdout parsing, selected helper binary,
and timing of `windows-helper:start-recording`.

## Recommended Next Milestone

Make the real app path report `nativeChunks > 0` during realtime dictation.

The latest implementation slice added metadata-only recording diagnostics in
the Electron main-process helper path. The next app-driven realtime test should
now be self-explanatory: which helper binary was launched, which capture mode
was requested, whether stdout contained realtime PCM events, how many
recording-level events arrived, and what final WAV metadata was produced.

Suggested order:

1. Verify which Windows helper binary the running app resolves.
2. Reproduce a realtime recording from the app and confirm whether stdout
   contains `realtimePcm16Chunk` lines.
3. Once live chunks flow, remove or demote the WAV finalize fallback to a
   clearly marked recovery path.
4. Verify live preview turns and final insertion.
5. Mark the realtime smoke test only after a real hotkey-driven dictation
   succeeds end to end.

## Active Ten-Point Implementation Plan

The next logical implementation pass is to close the gap between "realtime
session shape is known" and "the app can reliably stream live native PCM into
OpenAI":

1. [x] Update this status file with a concrete ten-point implementation plan.
2. [x] Make native realtime PCM streaming an explicit recording option instead of
   relying on implicit helper behavior.
3. [x] Surface whether realtime PCM was requested in metadata-only native recording
   diagnostics.
4. [x] Have the renderer request realtime PCM only for `openai.realtime` sessions.
5. [x] Preserve file-mode recording behavior by keeping realtime PCM disabled for
   local and OpenAI file modes.
6. [x] Check realtime Prompt Pack support against the live API and keep it
   disabled for `gpt-realtime-whisper` because the model rejects `prompt`.
7. [x] Check realtime server VAD support and keep `turn_detection: null` for
   `gpt-realtime-whisper` because this model requires manual commits.
8. [x] Keep realtime latency presets mapped to the transcription `delay` hint.
9. [x] Update the Cloud settings copy so realtime Prompt Pack and server VAD
   limitations are explicit instead of implied future work.
10. [x] Run static verification and refresh this status file with the completed
    implementation notes.

## Implementation Log

### 2026-05-21

- Selected metadata-only `WindowsHelperService.startRecording` diagnostics as
  the next implementation slice before another realtime reproduction attempt.
- The diagnostics should avoid sensitive payloads and log counts, byte totals,
  helper path, capture options, process exit status, and final WAV metadata
  only.
- Implemented native recording diagnostics and surfaced the key realtime chunk
  counts in the developer Dictation panel.
- Next step: run a hotkey-driven realtime dictation in the app and check
  `realtimeChunks`, `realtimeBytes`, and `levelEvents`.
- Added the active ten-point implementation plan for explicit realtime PCM
  capture, realtime Prompt Pack verification, realtime VAD capability checks,
  UI copy cleanup, verification, and final status refresh.
- Implemented the ten-point pass:
  - added explicit native realtime PCM recording options and helper
    `--emit-realtime-pcm16` support,
  - exposed `realtimePcm16Requested` in native recording diagnostics,
  - requested realtime PCM only for `openai.realtime`,
  - verified that `gpt-realtime-whisper` rejects the transcription `prompt`
    field, so realtime Prompt Pack is not sent for that model,
  - verified that `gpt-realtime-whisper` should keep `turn_detection: null`,
  - refreshed Cloud settings copy for realtime Prompt Pack/server VAD
    limitations,
  - verified with `bun run lint`, `bun run typecheck`, and
    `cargo check --manifest-path native/windows-helper/Cargo.toml`.
- Fixed the follow-up realtime regression from the live app test:
  - removed the unsupported realtime `prompt` field while keeping the known-good
    WebSocket endpoint and `session.update` GA session shape,
  - removed OpenAI server VAD from the realtime session payload and returned to
    manual commit behavior for `gpt-realtime-whisper`,
  - changed native realtime PCM emission to resample microphone chunks directly
    to 24 kHz before emitting `realtimePcm16Chunk`, so Electron no longer rejects
    helper chunks as invalid 16 kHz audio.
- Next step: run a hotkey-driven realtime dictation in the app and confirm
  `realtimePcm16Requested=true`, `realtimeChunks > 0`, `realtimeBytes > 0`, and
  `providerAppendedBytes > 0`; only then mark realtime end-to-end smoke testing
  complete.

## Release Gate

Cloud Dictation should not be exposed in normal release UI until all three
OpenAI modes are functionally verified and the smoke-test checklist is complete.
