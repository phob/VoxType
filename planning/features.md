# Features

## Core Features

- Local speech-to-text.
- Local model downloads and activation.
- Global hotkeys.
- Tray app.
- Push-to-talk and toggle dictation.
- Voice activity detection.
- Automatic silence trimming.
- Recording coordination for apps that also use the microphone.
- Clipboard paste insertion.
- Direct keyboard typing insertion.
- Chunked remote-safe typing.
- Local OCR from screenshot.
- Custom dictionary.
- OCR-derived temporary dictionary.
- Dictation history.
- Per-app profiles.
- Offline mode.

## Standout Features

### Screen-Aware Dictation

VoxType uses local OCR to extract visible text from the screen and improves dictation using that context.

This helps with:

- technical terms
- names
- UI labels
- error codes
- remote-session content
- code identifiers
- ticket/order/customer numbers

### Fix Last Dictation

After insertion, VoxType remembers what it inserted.

The user can:

- undo it
- replace it
- reformat it
- correct terms
- save corrections to the dictionary

### Correction Memory

VoxType learns from user corrections locally.

This should not require model training. It can be implemented as a local correction database and dictionary rule system.

### Smart Recording Gate

VoxType should know when the user is actually speaking.

The recording pipeline should use local VAD to:

- avoid sending silence and background noise to Whisper
- trim dead air before and after speech
- cut out silent parts without stopping the recording automatically
- keep a short pre-roll so words are not clipped
- show clear states such as listening, speech detected, and transcribing
- let users play the processed audio from history to debug bad trimming

Silero VAD is the preferred first candidate because it is fast, local, and practical to run through ONNX.

### Recording Coordination

VoxType should reduce conflicts with apps that are already using the microphone.

Important use case:

- When the user is in Discord and starts VoxType dictation, VoxType should be able to mute the user's Discord microphone automatically, then unmute it when VoxType recording finishes.

Preferred first implementation:

- Add per-app recording actions to app profiles.
- Let a profile define a "mute before recording" shortcut and an "unmute after recording" shortcut.
- Trigger those shortcuts through the native Windows helper before and after VoxType recording.
- Use this for Discord first, because Discord already supports user-configurable mute/deafen keybinds.

What VoxType should not promise initially:

- A universal Windows per-app microphone mute switch for every application.
- Muting the physical input endpoint globally, because that can also mute VoxType's own recording path.
- A virtual microphone driver in the early product, because that adds driver packaging, signing, and trust complexity.

### Per-App Intelligence

VoxType changes behavior based on the active app.

Examples:

- Outlook: clean email paragraphs.
- Word: polished writing.
- VS Code: code-aware terms and literal mode.
- Terminal: avoid smart punctuation.
- RDP/TeamViewer: slow typing mode.
- Browser chat: conversational style.

Initial profile behavior:

- Profiles are created automatically from detected target apps.
- Users can change a profile's insertion method and writing style directly in the UI.
- Saved writing styles are ready for later local formatting/post-processing.

### Confidence-Aware Review

Before insertion, VoxType can highlight uncertain words or likely corrections.

The user can accept quickly or edit before sending text into the target app.

### Local Formatting Engine

Optional local post-processing can transform raw speech into:

- clean paragraphs
- bullet lists
- ticket comments
- concise replies
- formal emails
- raw literal transcript

This should be optional and local-first.

### Transcript Consistency Layer

VoxType should produce a predictable final text level even when the ASR model output varies from one recording to the next.

The app should keep raw ASR output for debugging, then apply a local consistency pass before insertion:

- punctuation normalization
- casing normalization
- spacing cleanup
- repeated-word cleanup
- app/profile-specific style rules
- optional strict "literal transcript" mode that avoids rewriting

This is important because even strong speech-to-text systems can alternate between nearly perfect punctuation and almost no punctuation depending on audio quality, pauses, model decoding state, prompt context, and chunk boundaries.

### Insertion Reliability Dashboard

VoxType should tell the user what it sees:

- active app
- detected privilege level
- recommended insertion method
- whether clipboard paste works
- whether keyboard emulation works
- whether target is likely remote

## Dictation Modes

- Raw transcript.
- Clean dictation.
- Spelling mode.
- Code mode.
- Command-safe mode.
- Remote mode.
- Review-before-insert mode.

## OCR Features

- Region screenshot OCR.
- Active-window OCR.
- Full-screen OCR.
- Copy OCR result.
- Insert OCR result.
- Add OCR terms to temporary dictionary.
- Add OCR terms to permanent dictionary.

## Model Management Features

- Download local models.
- Pause/resume downloads.
- Delete models.
- Activate model.
- Verify model checksums.
- Show model size and requirements.
- Show source/license.
- Offline-ready status.
