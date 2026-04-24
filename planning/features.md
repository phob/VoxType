# Features

## Core Features

- Local speech-to-text.
- Local model downloads and activation.
- Global hotkeys.
- Tray app.
- Push-to-talk and toggle dictation.
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
