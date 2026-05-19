# Autoresearch: Cloud Dictation implementation

## Objective
Implement the opt-in Cloud Dictation PRD in `planning/cloud-dictation-prd.md` without weakening privacy/local-first guarantees. Optimize for functional acceptance coverage while keeping the app type-safe and preserving existing local dictation behavior.

## Metrics
- **Primary**: `cloud_acceptance_score` (unitless, higher is better) — static implementation coverage of core PRD acceptance markers, gated by TypeScript typecheck.
- **Secondary**: `typecheck_seconds`, `provider_files`, `cloud_privacy_markers` — tradeoff/diagnostic signals.

## How to Run
`./autoresearch.sh` — runs TypeScript typecheck, then a small static acceptance probe, and emits `METRIC name=value` lines.

## Files in Scope
- `src/shared/settings.ts` — persisted settings, app profile cloud/offline/mode flags.
- `src/shared/models.ts`, new shared ASR/domain files — Dictation Mode and provider-neutral types.
- `src/main/transcription-service.ts` — existing local file transcription orchestration.
- `src/main/index.ts` — hotkey/session orchestration, provider selection, IPC.
- `src/main/settings-store.ts`, `src/main/history-store.ts` — persistence migrations/metadata.
- `src/preload/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css` — setup/status UI.
- `planning/cloud-dictation*.md`, `docs/adr/0001-add-opt-in-cloud-dictation.md` — source requirements only; do not edit unless implementation reality changes.

## Off Limits
- Do not store OpenAI API keys in plain settings JSON.
- Do not send screenshots, transcript history, full dictionary, or full insertion target contents to cloud.
- Do not expose Cloud Dictation in release UI before all three OpenAI modes are functionally wired.
- Do not cheat the benchmark by adding unused strings solely to satisfy static probes; implement real domain code.
- Do not overwrite unrelated pre-existing user changes in this worktree.

## Constraints
- Local dictation remains default and must keep working.
- Cloud requires explicit consent and setup before recording.
- Offline Mode disables cloud; app profiles may forbid cloud.
- Logs must not contain API key, audio, Prompt Pack text, transcript text, screenshots, or provider responses.
- Use OpenAI API key/BYOK only; no ChatGPT/Codex auth.
- TypeScript typecheck must pass for a keep.

## What's Been Tried
- Session initialized from PRD. No implementation experiments yet.
