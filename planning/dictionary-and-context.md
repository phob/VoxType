# Dictionary And Context

## Goal

VoxType should let users add words to a local dictionary and should understand words visible on screen after OCR.

Because Whisper does not truly learn new words at runtime, VoxType should implement dictionary behavior as a layered context and correction system.

## Context Engine

The next major dictionary/context step should be a distinct local Context Engine.

The Context Engine is VoxType's local decision layer that ranks available context before ASR and applies confidence-scored corrections after ASR. It should keep the existing pieces separate:

- Dictionary: stored user vocabulary, preferred spellings, and learned correction entries.
- OCR context: visible text extracted locally from the target window or screen for the current dictation session.
- App profiles: saved behavior scoped to a target application.
- Prompt pack: the small, ranked set of terms sent to Whisper as prompt context for one transcription.

Initial responsibilities:

1. Collect candidates from enabled dictionary entries, OCR terms, app-scoped entries, correction memory, and recent session context.
2. Score candidates by current app/process match, OCR visibility, recency, source, term shape, and prior correction success.
3. Build a compact prompt pack that stays within Whisper's small prompt budget instead of sending every available term.
4. Apply post-ASR corrections with confidence reasons, keeping exact dictionary replacement, OCR spelling preference, and fuzzy correction as separate correction types.
5. Store raw ASR text, final inserted text, and correction explanations in transcript history.

The Context Engine should remain local-first. Cloud AI should not be required for vocabulary selection, OCR context, or conservative correction behavior.

First implementation slice:

- Improve post-ASR correction quality before prompt ranking.
- Generate correction candidates from dictionary entries, OCR terms, and app-scoped correction memory.
- Score candidates and auto-apply only safe corrections.
- Record correction explanations in transcript history so mistakes can be diagnosed and later surfaced in the UI.
- Reuse the same scoring model later for prompt-pack ranking.

Correction confidence bands:

- High confidence: auto-apply. Examples include exact dictionary matches, explicit correction-memory matches, and visible OCR terms where the transcript contains an obvious segmented/spoken form.
- Medium confidence: do not auto-apply in the first version. Record as a correction candidate for diagnostics and future review UI.
- Low confidence: ignore. Common-word replacements, very short terms, and noisy OCR-only terms should not become correction candidates unless another strong signal exists.

The first Context Engine version should prefer missing a clever correction over making an intrusive wrong replacement.

## Dictionary Layers

```text
Permanent user dictionary
  words, phrases, abbreviations, preferred spelling

Correction memory
  learned from user edits and accepted corrections

OCR temporary dictionary
  visible terms extracted from screenshots or active windows

App profile dictionary
  terms and style rules specific to apps like VS Code, Word, Outlook, RDP

Session context
  recent transcript text and active document context when available
```

## Permanent Dictionary

Users should be able to add:

- preferred words
- phrases
- names
- technical terms
- replacement rules
- pronunciation hints
- categories/tags

Example entries:

```json
{
  "preferred": "VoxType",
  "match": ["vox type", "voxtype", "vox tight"],
  "category": "product"
}
```

Initial implementation:

- Dictionary entries are stored locally in Electron `userData` as `dictionary.json`.
- Entries include preferred text, misheard phrases, category, source, enabled state, and optional app process scope.
- The renderer includes a dictionary panel for adding, editing by clicking entries, disabling, and deleting entries.
- The non-developer dictionary page keeps saved entries and latest OCR terms as the primary view; add/edit actions open a compact modal so the page fits the normal VoxType window without exposing large edit fields inline.
- The latest OCR terms panel should show every extracted term from the latest OCR context in a bounded, scrollable side panel instead of truncating the list or growing the card.
- Entries can be scoped to app profiles so corrections can be global or app-specific.

```json
{
  "preferred": "Kubernetes",
  "match": ["cube burnetties", "kubernetties", "k eight s"],
  "category": "technical"
}
```

## OCR Temporary Dictionary

The OCR dictionary is one of VoxType's signature features.

Flow:

1. User triggers screenshot context capture or VoxType captures active window context.
2. OCR extracts text locally.
3. Text is parsed into likely important terms.
4. Terms are added to a temporary context pack.
5. Whisper receives a short prompt containing the most relevant terms.
6. Post-processing prefers OCR spellings when speech resembles those terms.

Useful extracted term types:

- product names
- customer names
- UI labels
- error messages
- error codes
- stack trace names
- hostnames
- IP addresses
- file names
- class/function names
- ticket IDs
- order numbers

## Prompt Biasing

Whisper can be nudged with an initial prompt.

The prompt should be short and focused. It should not include an entire OCR dump. Instead, VoxType should extract important words and phrases.

Example prompt content:

```text
Relevant terms: VoxType, TeamViewer, OpenVPN, HRESULT, InitializeComponent, Kundenauftrag.
Use these spellings when they are spoken.
```

Prompt context should be:

- limited in length
- ranked by relevance
- cleared or decayed after use
- separated by app/session

The prompt should be treated as a Context Engine output, not as the dictionary itself.

Initial implementation:

- Before invoking `whisper.cpp`, VoxType builds a compact prompt from enabled relevant dictionary entries.
- Global-hotkey dictation now captures active-window OCR context before VoxType takes focus, extracts a conservative ranked term list, and passes those terms into the same compact Whisper prompt path as dictionary entries.
- The OCR context keeps raw recognized text, filtered relevant terms, and rejected candidate tokens so missed words can be diagnosed as OCR capture issues versus term-extraction filtering.
- OCR term extraction has `strict`, `balanced`, and `broad` modes. `balanced` is the default so normal capitalized UI words can enter context without making the prompt as noisy as broad mode.
- The dictation UI shows the generated/effective Whisper prompt, allows a custom prompt override, and has a Default button that clears the override and returns to the generated dictionary/OCR prompt.
- The prompt is passed to `whisper.cpp` with `--prompt`.
- App-scoped entries are included when their process matches the current dictation target.

## Post-Processing Corrections

Post-processing should apply after ASR:

- direct replacements
- fuzzy matching against dictionary terms
- capitalization fixes
- abbreviation fixes
- OCR term preference
- punctuation cleanup

The correction engine should be conservative. It should avoid replacing common words incorrectly.

Initial implementation:

- VoxType applies exact phrase replacements from enabled dictionary entries after ASR completes.
- VoxType applies a narrow OCR-term correction pass after dictionary corrections, preferring visible spellings only when the transcript contains an obvious spoken or segmented form of an OCR term.
- Corrections run before transcript history and insertion, so the user sees and inserts the corrected text.
- Transcript history can retain raw text, dictionary correction notes, and OCR correction notes when a correction changes the output.
- The dictation UI exposes OCR terms as buttons so useful screen-derived terms can be promoted into the permanent dictionary with source `ocr`.

## Correction Memory

When the user edits or fixes a transcript, VoxType should remember useful corrections locally.

Possible flow:

1. User dictates.
2. VoxType inserts text.
3. User invokes "fix last dictation" or edits in review.
4. VoxType detects changed terms.
5. VoxType suggests saving a correction rule.

Examples:

- `dock her compose` -> `Docker Compose`
- `team viewer` -> `TeamViewer`
- `h result` -> `HRESULT`

Initial implementation:

- The dictionary panel includes a "Correct latest transcript" box.
- Saving a correction creates a local correction entry whose match phrase is the latest transcript and preferred text is the corrected version.
- This is intentionally simple; smarter diff-based correction suggestions remain future work.

## Dictionary UI Ideas

- The non-developer frontend includes a Dictionary tab for adding, editing, disabling, and deleting local dictionary entries.
- The Dictionary tab shows the latest OCR terms as clickable chips so visible terms can be promoted into the permanent dictionary without entering the Debug view.
- Add and edit forms should stay in modal dialogs on the non-developer page; the page itself should focus on scanning saved entries and recent OCR terms.
- Add word manually.
- Add selected text to dictionary.
- Add all OCR terms from screenshot.
- Review learned corrections.
- Disable a bad correction.
- Per-app dictionary categories.
- Import/export dictionary JSON.
