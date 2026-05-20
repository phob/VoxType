# Cloud Dictation Implementation Status

Last reviewed: 2026-05-20

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
- Realtime turn accumulation exists through `TranscriptTurnAccumulator`.
- Realtime history entries store provider/mode/model, turn count/status, raw
  text when changed by corrections, and `audioUnavailableReason`.
- Realtime final text insertion remains final-only; partials are preview-only.
- Realtime audio playback is not saved in history.
- Cloud logging helpers assert metadata-only log entries.
- Error handling now preserves sanitized OpenAI error messages for request-shape
  debugging without logging full provider responses.

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
- Realtime Prompt Pack is not currently sent. The UI says realtime does not send
  Prompt Pack text. This diverges from the PRD, which says the realtime session
  should open with the final Prompt Pack.
- Realtime `turn_detection` is currently `null`. The PRD says OpenAI server VAD
  should create internal Transcript Turns.
- Realtime latency presets currently map to OpenAI transcription `delay` rather
  than server VAD timing.
- `getOpenAiRealtimeVadConfig` still exists but is effectively legacy/stale for
  current realtime transcription sessions.
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
- Realtime Prompt Pack support or an explicit planning decision that realtime
  will not send Prompt Pack text.
- OCR 1-second startup budget for realtime and warning when OCR is slow/fails.
- Dictionary-only realtime startup fallback when OCR misses the budget.
- Realtime server VAD turn behavior aligned with the PRD.
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

Suggested order:

1. Verify which Windows helper binary the running app resolves.
2. Add or inspect metadata-only recording diagnostics from
   `WindowsHelperService.startRecording`, including helper path, capture mode,
   stdout event counts, realtime chunk counts, recording level counts, and
   final WAV metadata.
3. Reproduce a realtime recording from the app and confirm whether stdout
   contains `realtimePcm16Chunk` lines.
4. Once live chunks flow, remove or demote the WAV finalize fallback to a
   clearly marked recovery path.
5. Verify live preview turns and final insertion.
6. Mark the realtime smoke test only after a real hotkey-driven dictation
   succeeds end to end.

## Release Gate

Cloud Dictation should not be exposed in normal release UI until all three
OpenAI modes are functionally verified and the smoke-test checklist is complete.

