# Cloud Dictation Implementation Status

Last reviewed: 2026-05-22

This document captures the current implementation state against
[cloud-dictation-prd.md](cloud-dictation-prd.md). It is a handoff snapshot for
continuing Cloud Dictation work without reconstructing state from chat history.

## Overall Status

Cloud Dictation is implemented and has passed the app-driven cloud release smoke
checks reported on 2026-05-22.

File-based OpenAI dictation and realtime OpenAI dictation are functionally
verified. Realtime native PCM streaming has been verified in the real app path.
Current realtime finalization still includes a fallback that sends the stopped
recording WAV to the realtime session if no live PCM chunks reached OpenAI. That
fallback should now be treated as a recovery path rather than the primary
realtime architecture.

Normal release exposure can proceed once product/docs polish and any desired
fallback cleanup are complete.

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
- Realtime has a fallback path that passes the stopped recording WAV into
  realtime finalize, converts it to 24 kHz mono PCM16, and appends it before
  commit if no live PCM reached OpenAI. App-driven testing has verified live
  native PCM streaming, so this fallback should be demoted to a clearly marked
  recovery path or removed if it is no longer needed.
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
- Cloud mode release gating exists, and the release smoke-test checklist is now
  complete in `src/shared/cloud-release-smoke-test.ts` based on app-driven
  verification reported on 2026-05-22.
- Developer builds can preview cloud modes despite release gating.
- History and correction behavior exist, but should be manually verified across
  all three OpenAI modes.
- Public README/Product docs still describe VoxType as local-first without
  advertising opt-in Cloud Dictation as implemented.

## Missing Against The PRD

- Demote or remove the realtime WAV finalize fallback now that live native PCM
  streaming is verified in the real app path.
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

The previous realtime blocker was local app audio flow, not OpenAI session
setup. App-driven testing on 2026-05-22 confirmed realtime native PCM chunks
flow through the real app path and are appended to the OpenAI realtime provider.

## Recommended Next Milestone

Prepare Cloud Dictation for release exposure.

Suggested order:

1. Demote or remove the realtime WAV finalize fallback now that live native PCM
   streaming is verified.
2. Add/update public docs to describe VoxType as local-first with opt-in Cloud
   Dictation.
3. Review the release-gating UI path and decide whether developer-preview copy
   should change now that smoke tests are complete.
4. Keep the realtime diagnostics available for future regressions.

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
- App-driven smoke testing completed successfully on 2026-05-22:
  - realtime end-to-end dictation passed,
  - cloud accuracy file dictation passed,
  - cloud economy file dictation passed,
  - Offline Mode kill switch passed,
  - App Profile cloud-forbid fallback passed,
  - no sensitive cloud logs verified.
- Updated `src/shared/cloud-release-smoke-test.ts` so the checklist reflects the
  completed smoke tests.
- Next step: demote or remove the realtime WAV finalize fallback and update
  public docs for local-first, opt-in Cloud Dictation.

## Release Gate

All three OpenAI modes are functionally verified and the smoke-test checklist is
complete. Cloud Dictation can move toward normal release exposure after docs and
fallback cleanup decisions are complete.
