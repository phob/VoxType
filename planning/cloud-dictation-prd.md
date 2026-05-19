# PRD: Opt-in Cloud Dictation

## Purpose

Add opt-in Cloud Dictation to VoxType so users who want higher dictation accuracy or realtime transcript feedback can use OpenAI transcription models, while keeping VoxType local-first by default.

This document is intended as a fresh-context handoff for implementation planning. The detailed working design lives in [cloud-dictation.md](cloud-dictation.md), and the architectural decision is recorded in [../docs/adr/0001-add-opt-in-cloud-dictation.md](../docs/adr/0001-add-opt-in-cloud-dictation.md).

## Product Positioning

VoxType remains a Windows-first, local-first dictation app. Cloud Dictation is an explicit user-selected exception to the local-first default.

Cloud Dictation must never feel hidden or accidental. When active, VoxType should make the cloud boundary visible and understandable.

## Goals

- Support OpenAI Cloud Dictation as an opt-in ASR Provider.
- Expose beginner-friendly Dictation Modes rather than raw technical model choices.
- Support all three OpenAI modes before exposing Cloud Dictation in the normal release UI:
  - Realtime cloud — `gpt-realtime-whisper`
  - Cloud accuracy — `gpt-4o-transcribe`
  - Cloud economy — `gpt-4o-mini-transcribe`
- Preserve final-text insertion behavior. Realtime partials are preview-only and are not live-typed into target apps.
- Send only the minimum intended context to OpenAI: audio plus compact Prompt Pack.
- Keep local dictation as the default and as the safe option for sensitive profiles/offline mode.

## Non-goals

- Do not add arbitrary OpenAI model IDs or `openai.custom` in the first version.
- Do not implement VoxType-managed cloud billing/accounts.
- Do not use ChatGPT/Codex subscription authentication; OpenAI API key is required.
- Do not live-type partial realtime transcripts into target applications.
- Do not add style/rewriting instructions to the initial Cloud Prompt Pack.
- Do not require formal accuracy benchmarking before the first functional implementation.

## Key Domain Terms

- **ASR Provider**: selected transcription source for dictation, either local or cloud.
- **Dictation Mode**: user-facing transcription choice that combines provider, model, and behavior.
- **Cloud Dictation**: opt-in dictation where speech and Prompt Pack are sent to an online ASR provider.
- **Prompt Pack**: compact selected context sent to an ASR provider for one transcription.
- **Live Preview**: temporary transcript feedback shown during dictation before final insertion.
- **Transcript Turn**: one completed segment of dictated speech inside a dictation session.

## Dictation Modes

Use stable domain-level mode IDs:

### Local modes

- `local.fast`
- `local.balanced`
- `local.accuracy`
- `local.custom`

Beginner-facing labels:

- Local fast
- Local balanced
- Local accuracy

Exact Whisper model IDs remain visible as secondary text. Beginner local modes prefer multilingual models. `.en` variants belong in the advanced exact-model picker. `local.accuracy` should prefer `large-v3-turbo` when hardware/runtime fit. If a user picks an exact local Whisper model, selected mode becomes `local.custom` and stores the exact model separately.

### OpenAI modes

- `openai.realtime` — Realtime cloud — `gpt-realtime-whisper`
- `openai.accuracy` — Cloud accuracy — `gpt-4o-transcribe`
- `openai.economy` — Cloud economy — `gpt-4o-mini-transcribe`

OpenAI does not get `openai.custom` initially. Only tested modes are exposed.

## Defaults

- New users default to `local.balanced`.
- Cloud Dictation can be selected only after explicit one-time consent.
- Cloud modes may be selected before API key setup, but dictation is blocked before recording until setup is complete.
- Dictation Language remains provider-neutral. `auto` is allowed. Concrete language selections are passed as provider language hints when supported.

## Consent and Privacy Boundary

One-time consent should explain:

> When Cloud Dictation is enabled, VoxType sends your microphone audio and a compact Prompt Pack to OpenAI for transcription. The Prompt Pack may include selected words from your Dictionary and, if you enable it, visible text extracted from the target app. VoxType does not send your full Dictionary, transcript history, screenshots, or insertion target contents. Cloud Dictation is disabled in Offline Mode and can be blocked for specific App Profiles.

Cloud Dictation must show persistent provider/status UI whenever active.

Settings should link to OpenAI API pricing/privacy/data docs but should not require a separate OpenAI legal checkbox unless later required.

## Credentials

- Use BYOK: one OpenAI API key per Windows user.
- Store the key in the OS credential store, e.g. keytar/Windows Credential Manager.
- Plain settings JSON is not acceptable for shipping API key storage.
- Developer environment variable override is acceptable.
- UI initially asks only for API key, not organization/project IDs.
- Codex/ChatGPT subscription is not supported for these API models.

## Prompt Pack Rules

Cloud Dictation sends audio plus Prompt Pack.

Prompt Pack contents:

- Dictionary terms: always included for Cloud Dictation, but only selected/ranked terms, never the full Dictionary.
- OCR Context: not sent by default. Controlled by a global setting with App Profile override.
- Screenshots: never sent.
- Transcript history: never sent.
- Insertion target contents beyond selected OCR terms: never sent.
- `whisperPromptOverride`: local Whisper only; do not send to OpenAI.

Cloud Prompt Pack caps:

- top 50 terms
- 1,000 character cap

Provider adapters may format Prompt Pack provider-specifically. OpenAI should use concise keyword-style context where supported.

Prompt Pack is frozen per dictation session. Do not update it mid-session.

Settings/debug surfaces should include an expandable Prompt Pack preview. Do not interrupt each dictation with a preview.

## App Profiles and Offline Mode

- ASR Provider/Dictation Mode has global default plus App Profile override.
- App Profiles can forbid Cloud Dictation.
- If global Cloud Dictation is active but focused profile forbids cloud:
  - use local dictation automatically if ready,
  - otherwise block with a clear message.
- Offline Mode disables Cloud Dictation completely:
  - cloud modes remain visible but disabled with explanation,
  - no OpenAI test connection,
  - no new cloud session,
  - active Cloud Dictation session terminates immediately if Offline Mode is enabled.

Offline Mode is the cloud kill switch; no separate kill switch initially.

## Realtime Cloud Behavior

`openai.realtime` uses `gpt-realtime-whisper`.

Architecture:

- Native helper streaming capture → Electron main → OpenAI WebSocket.
- OpenAI realtime should use provider-aware audio configuration; target 24 kHz PCM for OpenAI realtime.
- VoxType hotkey owns dictation session lifecycle.
- OpenAI server VAD creates internal Transcript Turns.
- Target apps receive final text only.

Startup:

- On hotkey press, capture target app/window immediately.
- Start native microphone capture immediately and buffer up to 5 seconds of pre-connection audio.
- Build Prompt Pack, including OCR Context if enabled.
- OCR gets a 1-second startup budget for realtime.
- If OCR is slow/fails, continue with Dictionary-only Prompt Pack and show a warning.
- Open OpenAI realtime session with final Prompt Pack.
- Flush buffered audio once session is ready.
- If the session cannot connect within the pre-connection buffer window, stop recording and show a clear error.

Realtime buffering:

- Do not keep a full-session audio buffer initially.
- Realtime Cloud Dictation does not save audio initially, even if audio history is enabled.

Realtime latency:

- Advanced presets: Fast, Balanced, Accurate.
- Default: Balanced.
- Presets tune both preview latency and server VAD turn timing within conservative bounds.
- Raw server VAD threshold is developer/debug-only.
- Existing local VAD settings do not configure OpenAI realtime VAD.

Duration:

- Cloud sessions warn at 5 minutes by default.
- Cloud sessions stop/finalize at 10 minutes by default.
- Advanced max duration setting can increase or remove the cap.
- If unlimited, show persistent elapsed time and cloud badge, not periodic interruptions.
- Do not show estimated cost live; show duration and link to OpenAI pricing.

## Non-realtime Cloud Behavior

`openai.accuracy` and `openai.economy` use the existing post-recording style flow:

1. Record locally.
2. Apply local VAD trimming.
3. Send processed WAV to OpenAI.
4. Receive final transcript.
5. Apply explicit local corrections.
6. Insert final text.

Use existing processed WAV bytes initially. Do not compress before upload in the first version.

Non-realtime cloud modes may save processed WAV locally if existing/global audio history settings allow it.

## Live Preview UI

Realtime Live Preview appears in the recording overlay.

Overlay behavior:

- rolling 3–5 line preview,
- completed turns plus current provisional turn,
- provisional text visually distinct from completed text,
- keep overlay visible in Finalizing state after hotkey stop until insertion succeeds/fails.

Main window/developer UI may show debug details, but release UI should stay concise.

Non-realtime cloud modes use normal Recording → Transcribing states with persistent Cloud badge/status.

## Transcript Turn Composition

- Accumulate realtime events by provider item ID.
- Each Transcript Turn tracks provider item ID, provisional text, final text, status, and first-seen sequence.
- Completion events may arrive out of order; compose final text in sequence order.
- Provider formatting wins.
- If adjacent turns contain structural formatting such as newlines/list markers, use newline boundaries.
- Otherwise use profile/mode separator, defaulting to space.
- Partial transcripts are never used for correction learning.

On hotkey stop:

- stop recording,
- commit/flush as needed,
- wait briefly for final completion,
- use bounded partial fallback only if needed and mark history/status accordingly.

## Corrections

- ASR Providers return provider output.
- Common VoxType post-processing applies explicit Dictionary correction memory.
- Heuristic OCR-term post-corrections are disabled for Cloud Dictation initially.
- `fix last dictation` works for Cloud Dictation and saves local correction memory as usual.

## History

- One history entry per hotkey Dictation Session.
- Store both `dictationModeId` and raw `modelId`.
- Store provider, mode, duration sent, turn count/status.
- `rawText` should be provider-final composed text before local corrections, stored only when it differs from final inserted text.
- Do not store normal turn-by-turn JSON or Prompt Pack by default.
- Realtime history should note audio playback is not saved.
- Cloud Dictation works regardless of transcript history settings.

## Logging and Errors

Errors:

- Show friendly summary plus expandable technical details.
- BYOK users need enough detail to fix invalid key, billing, rate limit, or model-access issues.

Logs:

- Metadata only: provider, model, duration, status/error code.
- Never log API key, audio, Prompt Pack, transcript text, screenshots, or full provider responses.

Validation:

- Setup includes Test connection.
- Default test validates API key plus currently selected OpenAI mode.
- Future advanced action may test all OpenAI modes.
- Unavailable modes stay visible but disabled with a reason.

## Architecture Direction

Implement ASR Provider architecture first.

Use provider family + capability interfaces:

- shared provider metadata/mode definitions,
- `FileAsrProvider` for local Whisper and OpenAI non-realtime modes,
- `StreamingAsrProvider` for OpenAI realtime.

Provider returns provider-neutral ASR artifacts, not history entries.

Conceptual shape:

```ts
type AsrResult = {
  providerId: "local-whisper" | "openai";
  modelId: string;
  modeId: string;
  providerText: string;
  turns?: TranscriptTurn[];
  durationMs: number;
};
```

Common orchestration builds Prompt Pack, calls provider, applies corrections, saves history, and inserts text.

Prompt Pack building remains outside providers. The Context Engine selects/ranks terms; provider adapters may format terms for specific APIs.

## Implementation Scope

Although implementation can be staged internally, the normal release UI should expose Cloud Dictation only once all three OpenAI modes are functional.

Suggested internal order:

1. Add Dictation Mode data model and ASR Provider abstractions.
2. Move existing local Whisper transcription behind `FileAsrProvider`.
3. Add credential storage and Cloud Dictation consent/setup surfaces.
4. Add OpenAI non-realtime `FileAsrProvider` modes.
5. Add Prompt Pack cloud caps and consent-aware OCR-to-cloud behavior.
6. Add native helper streaming capture capability.
7. Add OpenAI realtime `StreamingAsrProvider`.
8. Add Live Preview overlay and Transcript Turn accumulator.
9. Add history/logging/error polish.
10. Expose all three OpenAI modes in release UI.

Developer/debug UI may expose partial work during development for testing.

## Functional Acceptance Bar

First implementation is successful when:

- user can select Dictation Mode,
- OpenAI key is stored in OS credential store,
- one-time Cloud Dictation consent is enforced,
- Cloud modes block before recording if setup is incomplete,
- audio plus allowed Prompt Pack is sent to OpenAI,
- transcript returns from all three OpenAI modes,
- explicit local corrections apply,
- final text inserts into target app,
- cloud status is visible while active,
- Offline Mode and profile cloud-forbid behavior work,
- errors are clear,
- logs avoid sensitive content.

Formal accuracy benchmarking is not required before first implementation.

## Documentation Updates

Keep public README/Product language stable until implementation exists. During implementation PR, update public docs to say VoxType is local-first by default with opt-in Cloud Dictation.

Update `planning/open-questions.md` after implementation planning to remove stale questions and add only genuinely unresolved cloud questions.
