# Phase 1 — Local Parakeet (NVIDIA) engine via sherpa-onnx

**Status:** Implemented (2026-07-05) — code complete and passing typecheck/lint.
Two Step 0 items still need on-device verification before release (see §7).
**Owner:** (unassigned — handoff doc)
**Created:** 2026-07-04
**Scope:** Add NVIDIA Parakeet TDT 0.6B v3 as a new *local, offline, batch* dictation
engine alongside Whisper. Default acceleration is CPU (INT8). CUDA is an
**explicit opt-in** backend for NVIDIA users. No streaming in this phase.

---

## 0. How to read this document

This is a self-contained handoff. It assumes **no prior context** from the
conversation that produced it. Read sections 1–3 for background and the shape of
the change, then execute section 8 (implementation order) top to bottom. Section
7 (Step 0 validation) **must be done first** — it can invalidate the hotwords and
CUDA sub-features before you write code against them.

All file paths are relative to the repo root `C:\Users\pho\Source\VoxType`.
Line numbers reference the state of the tree as of 2026-07-04 and may drift;
treat them as navigation hints, not exact anchors.

---

## 1. Background: how VoxType transcription works today

VoxType is an **Electron + Vite + React + TypeScript** desktop app (Windows) with
a **Rust native helper** (`native/windows-helper/`, exe name
`voxtype-windows-helper.exe`) that does audio capture, VAD, OCR, and input
injection. Transcription orchestration is TypeScript in `src/main/`.

There are two existing transcription paths:

- **Local (Whisper):** *batch only.* The Rust helper captures mic audio, runs
  Silero VAD, and writes a 16 kHz mono WAV. On push-to-talk release, the
  renderer calls into `src/main/transcription-service.ts`, which shells out to
  the **whisper.cpp CLI** (`whisper-cli.exe`) as an external process
  (`transcription-service.ts:123`, `execFileAsync(executable, args)`), reads the
  `.txt` output, applies dictionary corrections, and returns a transcript entry.
- **Cloud (OpenAI):** a file path (`gpt-4o-transcribe` etc.) and a realtime
  streaming path (`openai.realtime`). Not relevant to Phase 1 except as a
  reference for how a second provider is branched inside
  `transcription-service.ts`.

Key existing subsystems this plan reuses:

- **Runtime management** — `src/main/runtime-service.ts` +
  `src/shared/runtimes.ts`. Downloads a prebuilt whisper.cpp runtime archive
  (CPU / CUDA 11.8 / CUDA 12.4 / Vulkan) into
  `%userData%/runtimes/whisper.cpp/<version>/<id>/`, extracts it, and locates the
  executable. `selectRuntime()` (`runtime-service.ts:152`) auto-picks a backend
  from a `HardwareService` GPU report; for whisper, `auto` prefers CUDA when an
  NVIDIA GPU is present.
- **Model management** — `src/main/model-service.ts` + `src/shared/models.ts`.
  Downloads a single ggml `.bin` file per model from Hugging Face into
  `settings.modelDirectory` (default `%userData%/models`).
- **Hardware detection** — `src/main/hardware-service.ts` +
  `src/shared/hardware.ts`. `getAccelerationReport()` merges `nvidia-smi` and
  `Win32_VideoController` (PowerShell CIM) results into a report with
  `recommendedBackend` and `bestGpu` (name, VRAM, driverVersion, vendor).
- **Dictionary / prompt context** — `src/main/dictionary-store.ts` +
  `src/shared/prompt-context.ts`. `buildPromptContext(processName, ocrTerms)`
  returns a prompt string of "relevant terms" (used as Whisper `--prompt`).
  `applyCorrections(text, processName)` does post-transcription find/replace
  (`matches → preferred`). Stored at `%userData%/dictionary.json`.
- **Dictation modes** — `src/shared/asr.ts`. Maps user-facing modes
  (`local.fast`, `local.balanced` (default), `local.accuracy`, `local.custom`,
  `openai.*`) to concrete model ids. Each mode has `providerId`, `kind`
  (`"file" | "streaming"`), `modelId`, labels, and `requiresCloudConsent`.
- **Settings** — `src/shared/settings.ts` (schema/types) +
  `src/main/settings-store.ts` (defaults + persistence + version migration).

---

## 2. Why Parakeet, and why sherpa-onnx (research summary)

As of mid-2026, **NVIDIA Parakeet TDT 0.6B v3** is a strong upgrade over Whisper
for this app's use case (Windows, local, English/European dictation):

- More accurate than Whisper large-v3 on the Open ASR Leaderboard
  (~6.3% vs ~7.4% avg WER) at less than half the size, and roughly **10× faster**
  for English.
- **No silence hallucination** — its non-autoregressive transducer decoder does
  not invent text on quiet audio (Whisper's "Subtitles by Amara.org" problem).
  A real UX win for push-to-talk dictation.
- Runs on **CPU on Windows without CUDA/NeMo** via **sherpa-onnx** (the k2-fsa
  ONNX runtime) using pre-converted INT8 ONNX bundles. GPU acceleration is
  available via ONNX Runtime execution providers (CUDA for NVIDIA; DirectML for
  any DX12 GPU — DirectML deferred to Phase 2).
- Covers ~25 European languages. **Whisper stays** as the fallback for languages
  outside that set (Asian / Middle-Eastern / low-resource).

**Dictionary/vocabulary:** sherpa-onnx transducer models support real
decode-time **hotwords / contextual biasing** (prefix-tree ContextGraph) via
`modified_beam_search` — a genuine upgrade over Whisper's soft `--prompt`.
**But** there is a documented reliability bug: Parakeet + `modified_beam_search`
returns hallucinated or empty text ~20% of the time on Windows (sherpa-onnx
≤ v1.12.25). Therefore hotwords are treated as **experimental/opt-in**, and the
default path uses greedy decoding with the existing `applyCorrections`
post-processing as the reliable dictionary mechanism.

> **Update 2026-07-05 (post-plan):** Early sherpa-onnx builds rejected any
> non-greedy decoding method for **NeMo TDT** transducers outright (issue #2541),
> so this hedge was uncertain whether Parakeet supported hotwords at all.
> **PR #3077** (merged 2026-02-05) added `modified_beam_search` + `ContextGraph`
> hotwords for NeMo TDT, plus a `bpe.vocab` generator — and it ships in the
> pinned runtime **v1.13.3** (released 2026-06-15). So the capability now exists
> in the runtime we bundle. The remaining blocker is purely the **missing
> `bpe.vocab` artifact** (see Step 0.3). The ~20% Windows MBS instability has
> **not** been re-verified on v1.13.3 (Step 0.5 still open) — keep it opt-in.

Reference links (for the implementer):
- Model + CLI usage: <https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html>
- Hotwords: <https://k2-fsa.github.io/sherpa/onnx/hotwords/index.html>
- MBS reliability bug: <https://github.com/k2-fsa/sherpa-onnx/issues/3267>
- GPU/provider support: <https://deepwiki.com/k2-fsa/sherpa-onnx/7.1-gpu-support-(cuda-and-directml)>
- ONNX Runtime CUDA EP (deps/pitfalls): <https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html>
- Releases (runtime binaries): <https://github.com/k2-fsa/sherpa-onnx/releases>

---

## 3. Design decisions (with rationale)

1. **Integration mechanism = external CLI (`sherpa-onnx-offline.exe`), not
   in-process.** Drive it via `execFile` and parse stdout — structurally
   identical to the existing whisper.cpp invocation
   (`transcription-service.ts:123`). Keeps inference out of the Rust hot path and
   reuses the download/extract/runtime-selection machinery. Lower risk than a
   Rust FFI/C-API integration.

2. **CUDA is opt-in and decoupled from Whisper's backend logic.** Whisper's
   `selectRuntime()` auto-prefers CUDA when an NVIDIA GPU is present. For sherpa
   we deliberately do **not** replicate that. `auto`/default → **CPU always**.
   CUDA is used only when the user explicitly sets `sherpaRuntimeBackend: "cuda"`.
   Rationale: CUDA drags in the fragile CUDA 12.x + cuDNN 9.x DLL matrix and a
   much larger download; Parakeet INT8 on CPU is already ~10× faster than
   Whisper, so for short push-to-talk utterances the CUDA win is marginal.
   NVIDIA users who want max throughput opt in explicitly.

3. **Greedy decoding by default; hotwords are experimental.** Default argv uses
   greedy search (omit `--decoding-method`). Dictionary biasing continues to flow
   through `applyCorrections` post-processing. Decode-time hotwords
   (`modified_beam_search`) sit behind an experimental toggle with a Windows
   instability warning.

4. **Separate model + runtime catalogs.** Parakeet is a multi-file ONNX bundle
   (encoder/decoder/joiner/tokens) shipped as `.tar.bz2`, not a single ggml
   `.bin`. It does not fit `whisperModelCatalog`/`ModelService` (single-file, HF
   URL, Zip-free). New parallel modules are cleaner and lower-risk than
   generalizing the Whisper-shaped code.

5. **Defaults (confirmed with product owner):**
   - The new `local.parakeet` mode ships **off**; Whisper (`local.balanced`)
     remains the default engine.
   - Parakeet's model + runtime live under the **same settings / model-manager
     surface** as Whisper, not a new screen.

---

## 4. Concrete artifacts (verified 2026-07-04)

**CLI executable:** `sherpa-onnx-offline.exe`

Greedy (default) invocation:
```
sherpa-onnx-offline.exe \
  --encoder=<bundle>/encoder.int8.onnx \
  --decoder=<bundle>/decoder.int8.onnx \
  --joiner=<bundle>/joiner.int8.onnx \
  --tokens=<bundle>/tokens.txt \
  --model-type=nemo_transducer \
  <input.wav>
```
- Add `--provider=cuda --num-threads=1` when the CUDA backend is selected. On
  CPU, `--provider=cpu` (default).
- **Do NOT pass `--language`.** Parakeet v3 auto-detects across its 25 languages;
  the Whisper language mapping (`whisperLanguage`) does not apply here.
- Input must be single-channel 16-bit WAV. The Rust helper already emits 16 kHz
  mono (constant `VOXTYPE_SAMPLE_RATE = 16000`), which is fine.
- Transcript is printed to stdout; parse it out (the CLI prints a block that
  includes the recognized text — verify exact stdout format during Step 0 and
  write the parser accordingly).

Hotwords (experimental) additional flags:
```
  --decoding-method=modified_beam_search \
  --hotwords-file=<temp>/hotwords.txt \
  --hotwords-score=1.5 \
  --modeling-unit=bpe \
  --bpe-vocab=<bundle>/bpe.vocab
```

**Model bundle (~640 MB):**
`https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`
Extracted files:
- `encoder.int8.onnx` (~622 MB)
- `decoder.int8.onnx` (~12 MB)
- `joiner.int8.onnx` (~6.1 MB)
- `tokens.txt` (~92 KB)
- `test_wavs/` (ignore)
- ⚠️ `bpe.vocab` is **not** listed in the bundle contents — see Step 0.3.

**Runtime binaries (pin an exact version, e.g. mirror whisper's approach):**
- CPU: `sherpa-onnx-v<VER>-win-x64-shared.tar.bz2`
- CUDA: `sherpa-onnx-v<VER>-cuda-12.x-cudnn-9.x-win-x64-cuda.tar.bz2`
Both from <https://github.com/k2-fsa/sherpa-onnx/releases>. Choose a specific
recent version at implementation time and hard-code it in the catalog (like
`whisperRuntimeCatalog` pins `v1.8.4`).

**Note:** these archives are `.tar.bz2`, **not** `.zip`. The existing
`runtime-service.ts:expandArchive` uses PowerShell `Expand-Archive` (Zip only).
A new extraction routine is required (see Step 0.2).

---

## 5. New files to create

### `src/shared/sherpa-models.ts`
Parakeet bundle catalog + types. Mirror the *shape* of `src/shared/models.ts`
but for a multi-file bundle:
```ts
export type SherpaModelStatus = "not-downloaded" | "downloaded";

export interface SherpaModelCatalogItem {
  id: string;                 // e.g. "parakeet-tdt-0.6b-v3-int8"
  name: string;               // "Parakeet TDT 0.6B v3 (INT8)"
  archiveUrl: string;         // github releases .tar.bz2
  archiveName: string;        // "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2"
  bundleDirName: string;      // extracted dir "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"
  files: {                    // relative to bundleDirName
    encoder: string;          // "encoder.int8.onnx"
    decoder: string;          // "decoder.int8.onnx"
    joiner: string;           // "joiner.int8.onnx"
    tokens: string;           // "tokens.txt"
    bpeVocab?: string;        // "bpe.vocab" if present (Step 0.3)
  };
  modelType: "nemo_transducer";
  sizeLabel: string;          // "~640 MB"
  language: string;           // "25 European languages"
  description: string;
}

export const sherpaModelCatalog: SherpaModelCatalogItem[] = [ /* the one bundle */ ];
export function getSherpaModelById(id: string): SherpaModelCatalogItem | undefined;
```

### `src/shared/sherpa-runtimes.ts`
sherpa-onnx runtime catalog. Mirror `src/shared/runtimes.ts`:
```ts
export type SherpaRuntimeBackend = "cpu" | "cuda";
// NOTE: no "auto" that resolves to cuda. Preference is literally "cpu" | "cuda".

export interface SherpaRuntimeCatalogItem {
  id: string;                 // "sherpa-cpu-x64" | "sherpa-cuda-12.x-x64"
  name: string;
  version: string;            // pinned, e.g. "v1.12.x"
  backend: SherpaRuntimeBackend;
  archiveName: string;        // .tar.bz2
  url: string;
  notes: string;
}

export const sherpaRuntimeCatalog: SherpaRuntimeCatalogItem[] = [ /* cpu + cuda */ ];
export function getSherpaRuntimeById(id: string): SherpaRuntimeCatalogItem | undefined;
```

### `src/main/sherpa-runtime-service.ts`
Download/extract/locate `sherpa-onnx-offline.exe`. Model on
`src/main/runtime-service.ts`, with these differences:
- Runtime root: `%userData%/runtimes/sherpa-onnx/<version>/<id>/`.
- Executable candidate: `["sherpa-onnx-offline.exe"]`.
- **`.tar.bz2` extraction** (see Step 0.2) instead of `Expand-Archive`.
- **Backend selection is explicit, not hardware-auto:** given a
  `SherpaRuntimeBackend` preference, return that backend's runtime (install on
  demand if `!offlineMode`). No `HardwareService` auto-promotion to CUDA.
- Expose `getExecutablePath({ allowInstall, backend })`.

### `src/main/sherpa-model-service.ts`
Download the `.tar.bz2` bundle into a subfolder under `settings.modelDirectory`
(e.g. `<modelDirectory>/sherpa/<bundleDirName>/`), extract, verify the required
files exist, and report `downloaded | not-downloaded`. Provide `list()`,
`download(id)`, `delete(id)`, and a `resolveBundlePaths(id)` helper that returns
absolute paths to encoder/decoder/joiner/tokens (+ bpeVocab).

### `src/main/parakeet-asr-provider.ts`
Builds the argv, runs `sherpa-onnx-offline.exe`, parses transcript from stdout.
```ts
export interface ParakeetTranscribeInput {
  audioBytes: Uint8Array;
  executablePath: string;
  bundle: ResolvedParakeetBundle;      // absolute file paths
  backend: SherpaRuntimeBackend;       // adds --provider=cuda --num-threads=1 when "cuda"
  hotwords?: { filePath: string; score: number; bpeVocabPath: string } | null;
}
export class ParakeetAsrProvider {
  async transcribe(input: ParakeetTranscribeInput): Promise<{ text: string }>;
}
```
- Write the WAV to a temp path (reuse the `app.getPath("temp")/voxtype` pattern
  from `transcription-service.ts:88`).
- Greedy by default; add the hotwords flags only when `hotwords` is provided.
- Clean up temp files in `finally`.
- On failure, throw a clear error naming the executable (mirror
  `formatWhisperError`).

---

## 6. Edits to existing files

### `src/shared/asr.ts`
- Add `"local-parakeet"` to `AsrProviderId`.
- Add a mode to `dictationModes`:
  ```ts
  {
    id: "local.parakeet",
    providerId: "local-parakeet",
    kind: "file",
    label: "Local Parakeet",
    modelId: "parakeet-tdt-0.6b-v3-int8",
    secondaryText: "NVIDIA Parakeet TDT v3 (INT8)",
    requiresCloudConsent: false
  }
  ```
- Add `"local.parakeet"` to the `DictationModeId` union.
- `isCloudDictationMode` stays correct (providerId !== "openai" ⇒ false).

### `src/main/transcription-service.ts`
- In `transcribeWav`, after `const mode = ...` and before the Whisper block,
  branch:
  ```ts
  if (mode.providerId === "local-parakeet") {
    return this.transcribeParakeetFile(audioBytes, mode, settings, profile, context, startedAt);
  }
  ```
- New private method `transcribeParakeetFile(...)`:
  - Resolve bundle paths via `SherpaModelService.resolveBundlePaths(mode.modelId)`;
    if missing and `offlineMode`, throw a clear "download the Parakeet model"
    error.
  - Resolve executable via `SherpaRuntimeService.getExecutablePath({
    allowInstall: !settings.offlineMode, backend: settings.sherpaRuntimeBackend })`.
  - Build hotwords file **only if** `settings.parakeetHotwordsEnabled` **and**
    a `bpe.vocab` path is available: take `dictionaryStore.buildPromptContext(...)`
    terms, write one per line to a temp `hotwords.txt`.
  - Call `ParakeetAsrProvider.transcribe(...)`.
  - Post-process with the **same** `normalizeTranscriptText`,
    `dictionaryStore.applyCorrections`, and `applyOcrTermCorrections` used by the
    Whisper path.
  - Build a `TranscriptEntry` with `providerId: "local-parakeet"`,
    `dictationModeId: mode.id`, `modelId: mode.modelId`. Reuse
    `historyStore.saveAudio` / `historyStore.add`.
  - `languageHint`: leave undefined (no language flag passed).
- Inject `SherpaModelService`, `SherpaRuntimeService`, and `ParakeetAsrProvider`
  into the `TranscriptionService` constructor (follow the existing DI pattern —
  see how `RuntimeService` / `DictionaryStore` are passed in from
  `src/main/index.ts` or wherever the service is constructed).

### `src/shared/settings.ts` + `src/main/settings-store.ts`
Add to the settings schema/types and defaults:
- `sherpaRuntimeBackend: "cpu" | "cuda"` — default `"cpu"`.
- `parakeetHotwordsEnabled: boolean` — default `false`.
- `parakeetHotwordsScore: number` — default `1.5`.
Add a settings-version migration bump so existing installs get the new defaults.
(Find the current version constant + migration switch in `settings-store.ts` and
add a case.)

### Renderer settings UI (`src/renderer/...`)
Locate the existing model-manager / dictation-settings components (search for
where `whisperModelCatalog`, `listModels`, or `whisperRuntimeBackend` are
consumed) and add:
- A **Parakeet model** row: download / delete / size / status (wired to the new
  IPC for `SherpaModelService`).
- A **Parakeet backend** selector: `CPU (recommended)` vs `CUDA — NVIDIA only`,
  with an inline note: *"CUDA requires an NVIDIA GPU with CUDA 12.x + cuDNN 9.x
  runtime libraries. If unavailable, transcription will fail to start — use
  CPU."* Bind to `sherpaRuntimeBackend`.
- An **experimental** toggle: *"Decode-time hotword biasing (experimental —
  may occasionally produce empty or wrong results on Windows)."* Bind to
  `parakeetHotwordsEnabled`. Only meaningful if `bpe.vocab` is available
  (Step 0.3); if not, hide/disable it.
- Surface `local.parakeet` as a selectable dictation mode wherever the other
  `local.*` modes are listed.

### IPC / preload
Extend the preload bridge + main-process IPC handlers to expose:
- list / download / delete the Parakeet bundle (parallel to the whisper model
  channels),
- install / status the sherpa runtime (parallel to whisper runtime channels).
Follow the exact naming/registration pattern of the existing whisper model and
runtime IPC (search for the whisper model channel names in `src/main` and
`src/preload`).

---

## 7. Step 0 — validation BEFORE writing feature code

**Outcomes recorded 2026-07-05** (verified without downloading/running the large
binaries where possible; two items still require an on-device pass):

- **Asset names / URLs (was implicit in 0.1/0.2):** Verified against the GitHub
  releases API. Pinned **sherpa-onnx v1.13.3**. CPU runtime
  `sherpa-onnx-v1.13.3-win-x64-shared-MT-Release.tar.bz2` (~24 MB; MT = static
  MSVC runtime, no VC++ redist needed). CUDA runtime
  `sherpa-onnx-v1.13.3-cuda-12.x-cudnn-9.x-win-x64-cuda.tar.bz2` (~296 MB). Model
  bundle `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2` (~487 MB compressed)
  exists on the `asr-models` release. All hard-coded in the catalogs.
- **0.2 `.tar.bz2` extraction — RESOLVED.** Use the Windows built-in `tar.exe`
  (bsdtar/libarchive, Win10 1803+/Win11), which extracts bzip2 natively:
  `tar -xf <archive> -C <dest>`. Implemented in `src/main/tar-archive.ts`.
- **0.3 `bpe.vocab` — RESOLVED (absent, handled) + follow-up path added
  2026-07-05.** Treated as **not shipped** by the published bundle.
  `SherpaModelService.list()` sets `hotwordsAvailable` by probing for `bpe.vocab`
  on disk, and `resolveBundlePaths` returns `bpeVocab: null` when missing. The
  renderer hotwords toggle is **disabled** unless `hotwordsAvailable`, and
  `transcribeParakeetFile` only builds a hotwords file when the vocab is present.
  Phase 1 ships relying on `applyCorrections`.
  **Follow-up:** the vocab is not derivable from `tokens.txt` (needs SentencePiece
  scores; sherpa-onnx's `ssentencepiece` reader can't take `tokens.txt`). To make
  the toggle available without re-deriving it in-app (no Python at runtime), we
  now support fetching a **pre-generated** `bpe.vocab`:
  - `scripts/generate-parakeet-bpe-vocab.py` — offline generator (mirrors sherpa
    PR #3077; reads the SentencePiece model from a `.nemo`/`.model`, writes
    `piece<TAB>score`). Run once.
  - `SherpaModelCatalogItem.bpeVocabUrl` (`src/shared/sherpa-models.ts`) — optional
    hosted-vocab URL. `SherpaModelService.downloadBpeVocab` fetches it into the
    bundle on download (best-effort; never fails the model download). When set and
    fetched, `hotwordsAvailable` flips true and the existing
    `buildParakeetArgs` hotwords path (already wired) takes over.
  - **DONE 2026-07-05:** vocab generated, hosted as a static asset on the
    `sherpa-assets` GitHub release, and `bpeVocabUrl` wired in the catalog. New
    downloads now fetch it automatically → `hotwordsAvailable` is true and the
    toggle is live. Step 0.5 (Windows MBS + hotwords reliability) verified on
    v1.13.3 — see below. Feature stays experimental/opt-in (default off).
- **0.1 CUDA self-containment — RESOLVED (NOT self-contained).** Verified on an
  NVIDIA machine 2026-07-05: the CUDA archive ships
  `onnxruntime_providers_cuda.dll` but **not** NVIDIA's CUDA/cuDNN runtime DLLs,
  so without the CUDA Toolkit 12.x + cuDNN 9.x on PATH it fails at "Creating
  recognizer" with `LoadLibrary`/Error 126 —
  `onnxruntime_providers_cuda.dll ... depends on "cublasLt64_12.dll" which is
  missing`. `formatParakeetError` now detects the missing-dependency pattern in
  stderr and returns a short, actionable message ("install CUDA Toolkit 12.x +
  cuDNN 9.x on PATH, or switch to CPU") instead of the full sherpa dump. CUDA
  therefore remains an advanced opt-in that requires the user to install the
  NVIDIA runtime themselves; CPU stays the recommended default.
- **0.4 stdout format — RESOLVED 2026-07-05.** Ran the greedy CLI against
  `test_wavs/en.wav` on v1.13.3. The recognized text is emitted as a single JSON
  line `{"lang":..., "text": "...", "timestamps":[...], "tokens":[...], ...}`
  after the input-path line and a `----` separator. `parseSherpaTranscript`'s
  JSON-line branch matches this exactly; the plain-text-block fallback is now
  belt-and-suspenders.
- **0.5 MBS + hotwords reliability on v1.13.3 — VERIFIED 2026-07-05 (works; no
  catastrophic bug; usable with tuning caveats).** Ran `greedy_search` vs
  `modified_beam_search` vs `modified_beam_search`+hotwords on 8 clips: the 4
  bundled `test_wavs` (en/de/es/fr), **3 real push-to-talk history recordings**,
  and a generated 2 s silence clip. Used a **real `bpe.vocab`** (see method
  below), so the actual `ContextGraph` hotwords path was exercised, not just MBS.
  - **No empty output, no hallucination, no crashes** on any clip (silence
    correctly returned `""` in all three modes). The ~20% empty/garbage MBS bug
    (#3267) did **not** reproduce — the v1.13.3 pin (post-PR-#3077) holds up.
  - **False alarm caught:** an initial run showed an "empty" on one real clip;
    it turned out the running app had **pruned that history WAV mid-test**
    ("Failed to read"), not a decode failure. Re-ran on stable copies — clean.
  - **Biasing genuinely works:** with a hotword at score ~2, `MediaFlic →
    MediaFlick` and `jellyfin → Jellyfin` (rare terms the un-hinted decode got
    wrong). At the default score 1.5 the hotwords output was **identical to plain
    MBS** on all 8 clips (no distortion).
  - **Tuning caveats (real, not blockers):** (a) MBS is comparable to greedy, not
    strictly better — it reflows punctuation/casing and can drop a clause; it's
    also slower. (b) **Over-biasing corrupts:** at score 5 a Spanish clip mangled
    to "pays Punta"; the MediaFlick fix also cost surrounding punctuation. Keep
    the score modest (~1.5–2) and the toggle experimental/opt-in.
  - **How the `bpe.vocab` was produced (0.5 MB, no 2.5 GB download):** the model's
    SentencePiece tokenizer is not in NVIDIA's sherpa bundle, but the HF repo's
    `parakeet-tdt-0.6b-v3.nemo` is a tar whose `*_tokenizer.vocab` (already
    `piece\tscore`, sherpa's exact format) sits *before* the weights. Stream the
    tar and stop at that member → ~0.5 MB. `scripts/generate-parakeet-bpe-vocab.py`
    covers the `.model`/`.nemo`→vocab path for hosting.

These three checks can change the design; do them first, ideally by hand.

1. **CUDA self-containment.** Download the sherpa CUDA `.tar.bz2`, extract, and
   run `sherpa-onnx-offline.exe --provider=cuda ...` on a clean NVIDIA machine.
   Determine whether the archive bundles the ONNX Runtime CUDA provider DLLs and
   whether the machine additionally needs system CUDA 12.x + cuDNN 9.x on `PATH`.
   Expect possible `LoadLibrary failed with error 126` on
   `onnxruntime_providers_cuda.dll` when a dep is missing. **Outcome:** finalize
   the exact wording of the CUDA UI caveat and decide whether to preflight-check
   for the DLLs and surface a friendly error.

2. **`.tar.bz2` extraction on Windows.** Confirm the target Windows baseline's
   built-in `tar.exe` (bsdtar/libarchive) extracts bzip2:
   `tar -xf archive.tar.bz2 -C dest`. If it works on the supported OS floor, use
   it in `sherpa-runtime-service.ts` and `sherpa-model-service.ts`. If not,
   bundle a small extractor. **Outcome:** the extraction routine.

3. **`bpe.vocab` presence.** Extract the Parakeet v3 int8 bundle and check
   whether `bpe.vocab` exists (the published file listing shows only
   `tokens.txt`). Decode-time hotwords need `bpe.vocab` + `--modeling-unit=bpe`.
   **Outcome:** if absent and not trivially derivable, **ship Phase 1 with the
   hotwords toggle disabled/hidden** and rely solely on `applyCorrections` for
   dictionary support. Document the decision here when known.

4. **stdout format.** Run the greedy CLI once and capture stdout to write the
   transcript parser in `ParakeetAsrProvider` correctly.

5. **MBS reliability (only if pursuing hotwords).** Against the pinned
   sherpa-onnx version, sanity-check whether the ~20% MBS hallucination/empty bug
   still reproduces before exposing the toggle.

---

## 8. Implementation order

1. **Step 0 validation** (section 7). Record outcomes inline in this file.
2. `src/shared/sherpa-models.ts` + `src/shared/sherpa-runtimes.ts` (catalogs,
   pin runtime version).
3. `src/main/sherpa-runtime-service.ts` (download/extract/locate exe; explicit
   backend selection).
4. `src/main/sherpa-model-service.ts` (bundle download/extract/verify/resolve).
5. `src/main/parakeet-asr-provider.ts` (argv builder + run + stdout parse).
6. Settings: `settings.ts` + `settings-store.ts` (three new fields + migration).
7. `src/shared/asr.ts` (provider id + `local.parakeet` mode).
8. `src/main/transcription-service.ts` (branch + `transcribeParakeetFile` + DI).
9. IPC/preload channels for sherpa model + runtime.
10. Renderer settings UI (model row, backend selector, experimental toggle, mode
    selection).
11. Tests (section 9).
12. Update `planning/changelog.md` and `planning/decisions.md` per repo
    conventions.

---

## 9. Test plan

**Unit tests:**
- `parakeet-asr-provider` argv builder: greedy vs hotwords; cpu vs cuda
  (`--provider`/`--num-threads` only on cuda); correct file flags and
  `--model-type=nemo_transducer`.
- stdout → transcript parser.
- `sherpa-model-service` file verification (missing file ⇒ `not-downloaded`).
- Backend selection: default/`"cpu"` never yields a CUDA runtime.

**Manual / `/verify` or `/run`:**
- Download bundle + CPU runtime → select `local.parakeet` → dictate → confirm
  transcript text.
- Speak nothing / silence → confirm **empty output, no hallucination** (contrast
  with Whisper).
- Confirm dictionary `applyCorrections` still rewrites terms.
- Switch `sherpaRuntimeBackend` to `cuda` on an NVIDIA box → confirm it runs, or
  fails with the clear CUDA-dependency message on a machine without the CUDA/cuDNN
  runtime.
- Confirm Whisper modes are unaffected and remain the default.

---

## 10. Risks

- **CUDA DLL matrix** (CUDA 12.x + cuDNN 9.x on PATH). Mitigated by opt-in +
  explicit UI caveat + (optionally) a preflight DLL check with a friendly error.
- **MBS hotword instability on Windows** (~20% empty/hallucination). Mitigated by
  greedy default + experimental gating + `applyCorrections` fallback.
- **`.tar.bz2` extraction** portability across the Windows baseline. Resolved in
  Step 0.2.
- **`bpe.vocab` is absent** from NVIDIA's bundle, disabling decode-time hotwords
  for Phase 1. Acceptable — `applyCorrections` covers dictionary needs. Path to
  enable is now plumbed (host a pre-generated vocab, set `bpeVocabUrl`); the
  runtime support landed in v1.13.3 via sherpa PR #3077 (see §2 update / Step 0.3).
- **Large model download (~640 MB)** + large CUDA runtime archive. Reuse the
  streamed-download-with-temp-file pattern from `model-service.ts` /
  `runtime-service.ts`; show progress in the UI.

---

## 11. Explicitly out of scope (Phase 2+)

- Local **streaming / live** transcription (partial results as you speak). Would
  generalize the existing `openai.realtime` session pattern to a local streaming
  transducer (Moonshine or a Parakeet/Nemotron streaming model) fed by the PCM16
  chunks the Rust helper already emits. Note: streaming transducers are currently
  greedy-only in sherpa-onnx ⇒ no decode-time hotwords in streaming mode.
- **DirectML** backend (GPU acceleration for AMD/Intel and NVIDIA without CUDA).
- **Whisper ↔ Parakeet auto-routing** by detected language (Parakeet for its 25
  languages, Whisper fallback otherwise).
