# VoxType

VoxType is a Windows-first, local-first dictation product. This glossary names the product concepts that should stay stable across planning, code, and user-facing design.

## Language

**Context Engine**:
VoxType's local decision layer that ranks available context before ASR and applies confidence-scored corrections after ASR.
_Avoid_: Dictionary engine, OCR engine, smart dictionary

**Dictionary**:
Stored user vocabulary, preferred spellings, and learned correction entries.
_Avoid_: Context engine

**OCR Context**:
Visible text extracted locally from the target window or screen for the current dictation session.
_Avoid_: Screen intelligence, screen reading

**App Profile**:
Saved behavior scoped to a target application.
_Avoid_: App dictionary

**Prompt Pack**:
The small, ranked set of terms sent to an ASR provider as prompt context for one transcription.
_Avoid_: Full dictionary, OCR dump

**ASR Provider**:
The selected transcription source for dictation, either local or cloud.
_Avoid_: Engine, backend

**Dictation Mode**:
A user-facing transcription choice that combines an ASR Provider, model, and behavior such as realtime preview, accuracy, speed, or cost.
_Avoid_: Raw model, backend

**Cloud Dictation**:
Opt-in dictation where speech and the Prompt Pack are sent to an online ASR provider instead of transcribed by a local model.
_Avoid_: Cloud features, online mode

**Live Preview**:
Temporary transcript feedback shown while dictation is still in progress, before final text is inserted into the target app.
_Avoid_: Live typing, realtime insertion

**Transcript Turn**:
One completed segment of dictated speech inside a dictation session.
_Avoid_: Chunk, partial

## Relationships

- The **Context Engine** consumes **Dictionary**, **OCR Context**, **App Profile**, and session signals.
- The **Context Engine** produces one **Prompt Pack** for each transcription.
- A **Prompt Pack** contains only a selected subset of the **Dictionary** and **OCR Context**.
- An **ASR Provider** may be local or cloud.
- A **Dictation Mode** presents provider and model choices in beginner-friendly language while keeping the underlying model identifier visible.
- **Cloud Dictation** uses an online **ASR Provider**; local dictation uses a local **ASR Provider**.
- **Cloud Dictation** is visible to the user whenever it is active.
- **Live Preview** may show provisional text during **Cloud Dictation**, but target apps receive final text only.
- A dictation session may contain one or more **Transcript Turns**.
- **Transcript Turns** are composed into final text without disturbing formatting already produced by the ASR provider.
- The **Context Engine** applies post-ASR corrections without changing the stored **Dictionary** unless the user saves a correction.

## Example Dialogue

> **Dev:** "Should we send every dictionary word to Whisper?"
> **Domain expert:** "No. The **Context Engine** should rank the **Dictionary** and **OCR Context**, then build a small **Prompt Pack**."

## Flagged Ambiguities

- "Dictionary" was being used to mean both stored vocabulary and the runtime intelligence layer. Resolved: **Dictionary** is stored vocabulary; **Context Engine** is the runtime ranking and correction layer.
