# Features

## Recording Overlay

- Always-on-top recording overlay near the bottom of the active screen.
- Shows recording state and live microphone input level while capturing audio.
- Uses a compact, slower canvas vertical-bar gain timeline that grows from a flat silent baseline and switches through green, yellow, and red peak zones.
- Switches to a transcribing state after recording stops.
- Hides automatically when transcription finishes or when recording startup/transcription fails.

## Core Features

- Local speech-to-text.
- Local model downloads and activation.
- Global hotkeys.
- Tray app.
- Start minimized option that launches VoxType as a tray icon without showing the main window; double-clicking the tray icon opens the main window.
- Push-to-talk and toggle dictation.
- Voice activity detection.
- Automatic silence trimming.
- Recording coordination for apps that also use the microphone.
- Clipboard paste insertion.
- Remote clipboard paste insertion with a TeamViewer/RDP synchronization delay.
- Direct keyboard typing insertion.
- Chunked remote-safe typing.
- Windows Messaging insertion for compatible fields and TeamViewer-like targets where clipboard and keyboard simulation are unsafe.
- Local OCR from screenshot.
- Custom dictionary.
- OCR-derived temporary dictionary.
- Dictation history with saved audio for the 10 latest transcriptions and cleanup for older entries.
- Per-app profiles.
- Offline mode.

## Main User Interface

The default release UI should stay intentionally small and focused on setup, not day-to-day recording controls.

Primary tabs:

- General: only essential user-facing behavior such as OCR context enablement, VAD enablement, microphone/capture mode, offline/privacy preferences, and insertion defaults.
- Hotkeys: dedicated configuration for global dictation and window/show hotkeys.
- Models: local model catalog, installed status, downloads, activation, hardware fit, and deletion.
- Profiles: detected app profiles with user-facing insertion method and writing style controls.
- History: latest transcriptions with saved audio playback and cleanup for older entries.

User-facing surfaces still worth promoting from developer mode:

- Dictionary: saved words, correction entries, and app-scoped vocabulary affect transcription quality directly and should become a simple user tab later.
- Setup/Status: runtime, model, hotkey, and helper health should be summarized in friendly language when something blocks dictation.
- Formatting/Dictation mode: once the transcript consistency layer exists, writing style should move beyond profiles into simple per-use or per-profile modes.

Developer-only surfaces that should remain hidden:

- Raw OCR text, rejected OCR terms, prompt previews, helper paths, runtime executable paths, detailed VAD thresholds, insertion test tools, and low-level logs.

UI principles:

- Do not show a record button in the main app. VoxType recording is driven from outside the app through global hotkeys and target-app workflows.
- Show developer builds with a `-dev` version suffix in the lower-left system card; installed builds use the plain release version and hide the Developer entry point.
- Keep the main window fixed-size with no maximize control, and fade the UI in on startup.
- Expose Start minimized as a simple General setting for users who want VoxType to launch as a tray icon; double-clicking that icon opens the main window.
- Do not expose advanced implementation settings in the default UI. Keep dense settings, diagnostics, raw OCR, runtime paths, prompt previews, and low-level tuning behind developer mode.
- Use the release component-system language for the default UI: compact cyan-accent buttons, icon buttons, inputs, chips, toggles, tabs, segmented controls, status badges, toast/tooltip styling, and card surfaces. The main user status summary stays in the lower-left sidebar rather than inside the primary status card.
- Keep release UI primitives reusable across pages: dropdowns should use the custom release select when the native menu cannot match the design language; icon buttons should expose tooltips; model/status metadata should use chips and badges rather than ad hoc inline text.
- Prefer safe, high-quality defaults. When a setting has an automatic fallback path, default to the strongest/highest-quality practical setting and let the app fall back internally when needed.
- Enable VAD by default because silence trimming is part of the expected dictation quality path.
- Use `exclusiveCapturePreferred` as the default recording coordination mode when exposing capture type, so VoxType tries exclusive microphone capture but can fall back clearly when Windows or the device does not allow it.
- Keep any user-facing General settings phrased as product behavior rather than implementation details.

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

Initial Phase 4 direction:

- Keep OCR context optional and user-controllable through a simple enable/disable setting in the final UI.
- Keep raw OCR text, rejected terms, prompt previews, and correction diagnostics in a developer/debug surface rather than the main user workflow.
- Accept that OCR will not perfectly fix every difficult visible word; the feature is valuable as a contextual assist, not a guaranteed correction system.

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

Current implementation direction:

- Use WASAPI exclusive capture as the preferred device-level strategy when the user wants other apps blocked from the microphone.
- Offer `exclusiveCapturePreferred` for best-effort exclusive capture with shared fallback.
- Offer `exclusiveCaptureRequired` for strict privacy behavior: if exclusive capture cannot open, VoxType should fail clearly instead of recording in shared mode.
- Keep app-native hotkey automation as a global compatibility fallback. When global `sendHotkey` coordination is enabled, VoxType sends the configured start hotkey after recording opens and sends the configured stop hotkey when recording cleanup runs.
- Use this for Discord when users prefer Discord's own mute state and UI to stay synchronized.

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
- Profiles appear as compact rows in the release UI; clicking a row opens a profile settings modal so future per-app settings can be added without making the list dense.
- Users can remove app profiles from the list or from the profile settings modal.
- Users can change a profile's insertion method, writing style, and language override in the profile settings modal.
- Users can configure a per-profile post-transcription hotkey that is sent after VoxType inserts text, useful for apps where Enter submits the composed text.
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

- Screenshot capture for the active window or full virtual screen. Initial implementation writes PNG screenshots through the native Windows helper and previews them in the renderer OCR panel.
- Active-window OCR for global-hotkey dictation.
- Captured-window OCR by hwnd so the intended target is used even if foreground focus changes.
- OCR term extraction with strict, balanced, and broad modes.
- Temporary OCR dictionary for a dictation session.
- Add OCR terms to permanent dictionary.
- Final UI enable/disable checkbox for OCR context.
- Developer/debug view for raw OCR result, rejected candidates, prompt preview, and copy tools.
- Region screenshot OCR later only if active-window OCR is not enough.
- Insert OCR result later only if it becomes a clear user workflow.

## Model Management Features

- Download local models.
- Pause/resume downloads.
- Delete models.
- Activate model.
- Verify model checksums.
- Show model size and requirements.
- Show source/license.
- Offline-ready status.
- Use a two-click destructive delete flow: the first click changes Delete to Confirm, and Confirm is visible for only three seconds.
