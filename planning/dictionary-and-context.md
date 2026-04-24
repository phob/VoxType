# Dictionary And Context

## Goal

VoxType should let users add words to a local dictionary and should understand words visible on screen after OCR.

Because Whisper does not truly learn new words at runtime, VoxType should implement dictionary behavior as a layered context and correction system.

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

## Post-Processing Corrections

Post-processing should apply after ASR:

- direct replacements
- fuzzy matching against dictionary terms
- capitalization fixes
- abbreviation fixes
- OCR term preference
- punctuation cleanup

The correction engine should be conservative. It should avoid replacing common words incorrectly.

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

## Dictionary UI Ideas

- Add word manually.
- Add selected text to dictionary.
- Add all OCR terms from screenshot.
- Review learned corrections.
- Disable a bad correction.
- Per-app dictionary categories.
- Import/export dictionary JSON.

