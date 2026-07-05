# Phase 2 — Local streaming / live transcription (notes)

**Status:** Not started — scoping notes only
**Prereq:** Phase 1 (`planning/parakeet-phase1-plan.md`) shipped and proven.
**Created:** 2026-07-05

Short, for-me notes on what Phase 2 tackles. Not a full plan yet.

---

## Goal

Local **live** transcription: words appear as you speak, instead of after
push-to-talk release. True low-latency streaming — not Whisper's chunk+re-decode
approximation.

## Why it's a bigger lift than Phase 1

- **Model-dependent.** Whisper isn't causal; good live UX needs a purpose-built
  streaming model: **Moonshine v2** (built for it, ~107 ms latency, tiny, CPU
  first) or a **Parakeet/Nemotron streaming transducer**. Batch Parakeet from
  Phase 1 does not stream.
- **Pipeline change.** VoxType's local flow is "capture WAV → stop → transcribe
  file." Streaming means: feed live PCM frames into a persistent recognizer
  session, emit partial results to the UI, commit on endpoint/release.
- **Good news:** the plumbing is half-built. The Rust helper already streams
  live PCM16 chunks for the `openai.realtime` path. Generalize that existing
  streaming session pattern to a local recognizer instead of OpenAI.

## Rough shape

- Pick the streaming model (Moonshine vs Parakeet/Nemotron streaming). Evaluate
  latency, accuracy, and licensing (Moonshine non-English is non-commercial).
- Add a local streaming provider modeled on the OpenAI realtime session
  (`openai-realtime-asr-provider.ts` / `realtime-cloud-session.ts`).
- Wire the helper's existing live PCM16 chunk stream to it.
- New dictation mode `local.streaming` (`kind: "streaming"`).
- UI for partial/provisional text (the `TranscriptTurn` provisional/final model
  in `asr.ts` already exists).

## Known constraint

Streaming transducers in sherpa-onnx are currently **greedy-only** → **no
decode-time hotwords** in streaming mode. Dictionary support in Phase 2 falls
back to `applyCorrections` post-processing only.

## Also worth folding in around here

- **DirectML** backend (GPU for AMD/Intel + NVIDIA without CUDA).
- **Whisper ↔ Parakeet auto-routing** by detected language.

## Reality check

For short push-to-talk, Phase 1's ~10× faster batch already feels near-instant.
Streaming's real payoff is long-form dictation and the feel of live text. Decide
if that's worth the pipeline rework before committing.
