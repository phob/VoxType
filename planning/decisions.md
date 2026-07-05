# Decisions

Record important decisions here so future sessions do not reopen settled topics without a reason.

## 2026-07-05: Parakeet Engine Ships CPU-Default, Greedy, With Experimental Hotwords

Decision:

The local Parakeet engine (sherpa-onnx) ships with CPU as the default and only
auto-selected backend; CUDA is a strictly explicit opt-in via
`sherpaRuntimeBackend` and is never auto-promoted from a detected NVIDIA GPU the
way Whisper's runtime is. Decoding is greedy by default; decode-time hotword
biasing (`modified_beam_search`) is gated behind an experimental toggle that
stays disabled unless the downloaded bundle actually contains `bpe.vocab`.
Dictionary support for Parakeet flows through the existing `applyCorrections`
post-processing, not decode-time hotwords. Whisper (`local.balanced`) remains
the default engine.

Reason:

CUDA drags in the fragile CUDA 12.x + cuDNN 9.x DLL matrix and a ~300 MB runtime
download, while Parakeet INT8 on CPU is already ~10x faster than Whisper for
short push-to-talk utterances, so the CUDA win is marginal for most users.
Parakeet + `modified_beam_search` has a documented ~20% empty/hallucination bug
on Windows, and the published Parakeet v3 int8 bundle does not ship `bpe.vocab`,
so greedy decoding plus `applyCorrections` is the reliable dictionary path.

Decision:

VoxType should not send Prompt Pack text or OpenAI server VAD configuration to
`gpt-realtime-whisper` realtime transcription sessions. Realtime cloud should
use the known-good GA WebSocket session shape, stream 24 kHz PCM, and manually
commit the input audio buffer when the VoxType hotkey session stops. Prompt
Pack support and server-VAD turns remain known issues until OpenAI documents and
the app verifies a supported realtime transcription field or model.

Reason:

A live VoxType API run rejected the realtime transcription `prompt` parameter
for `gpt-realtime-whisper`, and current OpenAI realtime transcription docs say
to omit `audio.input.turn_detection` or set it to `null` for this model. The
user also cross-checked another `gpt-realtime-whisper` project that follows the
same model constraint. The remaining realtime implementation risk is local
audio flow, not changing the OpenAI session shape.

## 2026-05-15: Introduce Context Engine As A Separate Layer

Decision:

VoxType should introduce a distinct local Context Engine between raw context sources and transcription output. The Dictionary remains stored user vocabulary and learned corrections, OCR Context remains visible text extracted from the target window or screen, App Profiles remain app-scoped behavior, and the Context Engine ranks those signals into a compact Whisper prompt pack before ASR and applies confidence-scored corrections after ASR.

Reason:

The existing app already has dictionary entries, OCR terms, and per-app profiles, but they mostly coexist instead of cooperating. A named Context Engine gives the next implementation work a clear boundary without pretending Whisper can consume the full dictionary or OCR dump.

## 2026-05-15: Start Context Engine With Post-ASR Corrections

Decision:

The first Context Engine implementation slice should improve post-ASR correction quality before improving prompt ranking.

Reason:

Prompt ranking is useful but constrained by Whisper's small and unreliable prompt budget. Users will feel improvement sooner if VoxType reliably fixes obvious mishearings, spellings, abbreviations, and visible OCR terms after transcription, while recording explanations for why each correction happened.

## 2026-05-15: Auto-Apply Only High-Confidence Context Corrections

Decision:

The first Context Engine correction pass should auto-apply only high-confidence corrections. Medium-confidence candidates should be recorded for diagnostics and future review UI, and low-confidence candidates should be ignored.

Reason:

Wrong automatic replacements are more damaging to trust than missed smart corrections. VoxType should feel conservative and explainable while the correction model matures.

## 2026-05-09: Beginner-Friendly Windows Product Direction

Decision:

VoxType's default product experience should be beginner-friendly first, with a calm, secure, and capable personality. The UI should remain Windows-first and should not look or feel like a macOS clone.

Reason:

Release users should be able to set up and trust dictation without learning implementation details. VoxType can still expose expert diagnostics behind developer or advanced surfaces, but the primary product should feel approachable, private, and built for real Windows work.

## 2026-04-24: Windows-First Electron App

Decision:

VoxType will be planned as a Windows-first Electron app.

Reason:

The product needs a desktop UI, tray behavior, model management, and deep Windows integration.

## 2026-04-24: Local-First Core

Decision:

Core speech-to-text, OCR, dictionary, and insertion should work locally.

Reason:

Privacy and offline reliability are central to the product identity.

## 2026-04-24: Whisper As Main ASR Engine

Decision:

Use Whisper as the primary ASR direction, likely via `whisper.cpp`.

Reason:

Whisper is mature, broad, portable, and more suitable as the dependable first engine.

## 2026-04-24: Parakeet Later

Decision:

Parakeet V3 should be an optional later engine, not the primary implementation.

Reason:

Parakeet is promising but has runtime-dependent limitations around Windows packaging and dictionary/hotword support.

## 2026-04-24: Dictionary Is A VoxType Layer

Decision:

The dictionary should be implemented as a VoxType context/correction layer rather than relying on ASR model vocabulary modification.

Reason:

Whisper cannot simply learn new words at runtime. Prompt biasing, OCR context, and post-processing are more practical.

## 2026-04-24: OCR Context Is A Signature Feature

Decision:

Screenshot OCR should feed the speech-to-text dictionary/context system.

Reason:

This can make VoxType stand out from generic local Whisper dictation tools.

## 2026-04-24: Use Reviewable Release Automation

Decision:

Superseded by `2026-04-29: Use Manual Stable Releases With GitHub Generated Notes`.

Reason:

The initial Release Please direction was useful for bootstrapping release thinking, but it made commit-message discipline too central to release quality while the app is still changing quickly.

## 2026-04-29: Use Manual Stable Releases With GitHub Generated Notes

Decision:

Superseded in part by `2026-05-29: Generate Detailed Release Notes From PR Release Notes Sections`.

VoxType should use a stable-only manual GitHub Actions release workflow. The maintainer dispatches a release with an explicit version, CI synchronizes Electron and Rust helper versions, commits the version bump, tags that commit, builds the Windows installer, creates checksums, and publishes a draft GitHub Release. Release notes can be supplied manually for small patch releases or generated from PR labels when the history supports it.

Reason:

This keeps release publication intentional and avoids depending on Conventional Commits for changelog quality. Draft releases provide a review point before publication, and PR titles/labels describe product-level changes more cleanly than individual AI-assisted commits.

## 2026-05-29: Generate Detailed Release Notes From PR Release Notes Sections

Decision:

When the stable release workflow is dispatched without manual notes, VoxType should generate a draft `RELEASE_NOTES.md` from merged PR metadata. The generator should use GitHub's generated notes as a fallback, then prefer each PR's `## Release Notes` section for user-facing detail. Optional PR subsections such as `### Fixed` and `### Changed` become grouped release sections; PRs without detailed notes fall back to title/author/link bullets.

Reason:

GitHub's built-in generated release notes are reliable for grouping PR titles, but they are too terse for user-facing hotfix context. PR bodies already carry the right human-written detail, and using that section keeps release notes intentional without reintroducing commit-message discipline or requiring fully manual changelog editing for every release.

## 2026-04-24: Store Settings In The Main Process

Decision:

Persist initial app settings through a typed main-process settings store and expose them to the renderer through a preload IPC bridge.

Reason:

The renderer should not own filesystem access. Keeping settings in the Electron main process creates a cleaner boundary for future local model paths, privacy/offline settings, insertion defaults, and Windows helper configuration.

## 2026-04-24: Use Rust For The Windows Helper

Decision:

Build the native Windows helper in Rust.

Reason:

Rust gives VoxType a small, memory-safe native executable with good Windows API access through the `windows` crate. It is a good fit for foreground-window detection, clipboard/paste helpers, keyboard injection, screenshot support, and future privilege-boundary handling.

## 2026-04-24: Make System Audio Muting Optional

Decision:

VoxType should offer an opt-in setting that mutes Windows system audio while microphone recording is active, then unmutes after recording stops.

Reason:

Muting playback during capture can prevent speaker audio from bleeding into dictation, but it changes global system state, so the behavior should be controlled by the user.

## 2026-04-24: Direct Typing Must Be Keyboard-Layout Independent

Decision:

VoxType's direct typing path should send Unicode text rather than layout-dependent virtual key presses.

Reason:

Users may dictate in one language while Windows is using another keyboard layout. Dictation insertion should preserve the transcript text instead of changing behavior based on the active keyboard layout.

## 2026-04-24: Add Local VAD Before OCR Polish

Decision:

Add voice activity detection and silence trimming as Phase 3.5, directly after the dictionary/correction-memory work and before the larger OCR phase.

Reason:

VAD materially improves the everyday dictation loop by avoiding silence/noise transcription and trimming audio before Whisper. It should not end recording automatically; the user remains in control through the hotkey or UI. It is foundational enough to plan immediately, but separate enough from dictionary and OCR to deserve its own roadmap slice.

## 2026-04-24: Prefer Silero VAD Through ONNX

Decision:

Use Silero VAD as the preferred first VAD candidate, deployed locally through ONNX Runtime rather than Python/Torch.

Reason:

Silero VAD is small, fast on CPU, supports the 16 kHz audio path VoxType already uses, has broad speech/noise training coverage, and can be packaged for a local Windows Electron app without requiring a Python environment.

## 2026-04-24: Use App Hotkey Automation For Microphone Coordination First

Decision:

Superseded by `2026-04-25: Layer Microphone Coordination Around Exclusive Capture`.

Reason:

Research and testing showed that WASAPI exclusive capture is a better first-class device-level strategy than hotkey automation when the user wants other apps blocked from the microphone. Hotkey automation remains useful as a global fallback for app-native state sync.

## 2026-04-25: Use Native CPAL Recording As Only Capture Path

Decision:

VoxType should use the Rust Windows helper as the microphone recorder, using CPAL for device capture and Rubato for 16 kHz resampling. The browser `AudioWorkletNode` recorder should not be used as a fallback.

Reason:

Long VoxType recordings started crackling around the 25-30 second mark even when Silero VAD was disabled, which points to the browser/WebAudio capture path rather than VAD trimming. Handy does not show the same problem and uses native CPAL capture plus Rubato resampling, so VoxType should follow that architecture for stable Windows dictation.

## 2026-04-25: Run Silero VAD In The Native Helper

Decision:

VoxType should run Silero VAD in the Rust Windows helper using Handy's approach: `vad-rs`, `silero_vad_v4.onnx`, 30 ms frames, and `SmoothedVad` prefill/hangover/onset smoothing.

Reason:

Keeping capture, resampling, and VAD in the same native pipeline avoids renderer/WebAudio timing issues, removes ONNX Runtime Web from the transcription path, and matches the Handy integration that behaved better during audio-quality testing.

## 2026-04-25: Layer Microphone Coordination Around Exclusive Capture

Decision:

VoxType should offer layered microphone coordination: shared capture as the default, WASAPI exclusive capture as the preferred device-level way to block other microphone consumers, and global app-native hotkey automation as a compatibility fallback.

Reason:

Testing confirmed that capture-session mute can prevent Discord from receiving audio but can also leave VoxType with no detected speech. WASAPI exclusive capture keeps VoxType as the recorder while preventing other shared-mode consumers when Windows allows exclusive access. Discord hotkey automation is still valuable because it updates Discord's own mute state and UI, but it does not need to be profile-bound for the first implementation.

## 2026-04-25: Prefer Windows Media OCR For Phase 4

Decision:

VoxType should target Windows Media OCR as the preferred first OCR engine for Phase 4.

Reason:

VoxType works with Windows screenshots, and local testing showed the native Windows OCR path is fast enough for the screen-aware dictation loop without introducing a managed Python runtime, large model downloads, or slow warm-up costs.

## 2026-04-26: Treat Phase 4 OCR As Good Enough For Now

Decision:

Phase 4 OCR context is sufficient to move on after the initial Windows Media OCR, target-window screenshot, term extraction, prompt-context, post-processing, diagnostics, and dictionary-promotion work. The final user-facing OCR control should be a simple enable/disable setting, while raw OCR text, rejected terms, prompt previews, and correction diagnostics stay in the Debug view.

Reason:

OCR is tricky and will not perfectly fix every difficult visible word even when the word appears in the screenshot. The current rejection/filtering behavior is useful, and the feature now provides enough screen-aware context to keep, but higher-priority VoxType work should take precedence over deeper OCR tuning.

## 2026-04-26: Make GPU Acceleration The First Phase 5 Priority

Decision:

Phase 5 should start with Whisper GPU acceleration planning and implementation. VoxType should first detect GPU capability and VRAM, then recommend or select CUDA/Vulkan-capable Whisper runtimes only when the user's hardware and selected model are suitable.

Reason:

Whisper can use GPUs when the runtime supports it, and `whisper.cpp` has practical CUDA and Vulkan paths. VoxType currently installs a CPU-only managed runtime, so the safe next step is hardware/VRAM detection and model compatibility reporting before adding automatic GPU runtime acquisition.

## 2026-04-27: Use Managed CUDA And Custom Vulkan Runtime Selection

Decision:

VoxType should support GPU transcription through a runtime backend preference: `auto`, `cpu`, `cuda`, and `vulkan`. CUDA uses managed official `ggml-org/whisper.cpp` v1.8.4 Windows archives for CUDA 12.4 and CUDA 11.8. Vulkan is exposed as a selectable/custom runtime backend until VoxType ships a Vulkan build or upstream publishes a Windows Vulkan zip.

Reason:

The official `whisper.cpp` v1.8.4 release publishes CPU and CUDA Windows binaries, but no Windows Vulkan archive. This lets NVIDIA users get managed GPU acceleration now while preserving the cross-vendor Vulkan path without pretending there is an official downloadable runtime that does not exist.

## 2026-04-27: Move Dense UI Behind Debug View

Decision:

Superseded by `2026-05-29: Separate Debug View From Developer Build Mode`.

The current dense VoxType interface should be treated as a debug UI and hidden behind a persisted Debug view setting. The default app surface should become a simpler end-user dictation home.

Reason:

The current UI is useful for building and diagnosing models, OCR, insertion, and runtime behavior, but it exposes too many implementation details for release users. Hiding it preserves engineering velocity while making room for a calmer product UI.

## 2026-04-27: Keep The Main UI Setup-Focused

Decision:

The default VoxType UI should be organized around General, Hotkeys, and Models tabs. It should not include an in-app record button because recording is triggered from outside the app through global hotkeys and target-app workflows. Advanced settings and diagnostics should remain in the Debug view.

Reason:

Release users need to set up models, hotkeys, and a small number of product-level preferences, but they should not have to understand runtime internals or press buttons inside VoxType during normal dictation.

## 2026-04-27: Default To Capable Behavior With Internal Fallbacks

Decision:

User-facing defaults should choose the strongest practical behavior when a fallback exists. VAD should be enabled by default, recording coordination should prefer `exclusiveCapturePreferred`, and model/runtime selection should prefer the highest-quality compatible option before falling back automatically.

Reason:

VoxType should feel like it chooses the best local dictation path for the user instead of asking them to tune implementation settings up front. Fallbacks are still important, but they should make the product more resilient rather than adding setup burden.

## 2026-04-29: Separate Home Startup Controls From Settings

Decision:

The release UI should keep common startup controls on Home, including Start with Windows and Start minimized, while moving lower-frequency behavior toggles such as offline mode, clipboard restoration, and system-audio muting to a dedicated Settings page.

Reason:

Automatic startup affects whether VoxType is ready for daily dictation and belongs in the main setup flow. Offline mode, clipboard restoration, and audio muting are important but less frequently changed, so they fit better behind the existing Settings entry point.

## 2026-04-29: Use Native Helper For Hold Hotkey Release

Decision:

Hold-to-dictate should use Electron's global shortcut only for the initial activation and delegate release detection to the native Windows helper.

Reason:

Electron global shortcuts do not expose global key-up events. The native helper can poll the physical key state with Windows APIs and tell the main process when the held combination has been released.

## 2026-05-01: Suspend Dictation Hotkeys For Fullscreen Apps

Decision:

VoxType should offer an optional setting that suspends dictation hotkeys while the foreground window covers its monitor. The global toggle belongs in Settings, while each app's Never suspend override belongs inside that app's profile and should only appear when fullscreen suspension is enabled.

Reason:

Windows does not expose a reliable general-purpose "game is active" signal for normal desktop utilities. Fullscreen foreground detection is a practical, privacy-preserving proxy for gaming and other latency-sensitive contexts, while per-app overrides handle false positives such as presentations, browsers, video players, and remote sessions.

## 2026-05-05: Use Electron Single-Instance Lock Only

Decision:

VoxType should use Electron's single-instance lock to prevent duplicate app instances between builds that include the guard. A second guarded launch should restore/focus the existing main window. For now, VoxType should not add a Windows process-name scan or other compatibility fallback to detect older releases that do not request the lock.

Reason:

The maintainer is currently the only person running development builds, so the practical risk is duplicate guarded builds rather than mixed public/dev version enforcement. Process-name scanning would add startup complexity and could introduce false positives, while older unguarded releases cannot be made fully cooperative when launched second without shipping a patched release.

## 2026-05-09: Use One Dictation Key For Tap And Hold

Decision:

The main dictation key should support both modes by press duration: a quick press toggles dictation, while holding the same key longer than 700 ms records only until release. A separate hold hotkey can still be configured, but the default should share the dictation key.

Reason:

This keeps the everyday dictation workflow simpler while preserving push-to-talk behavior. VoxType already uses the native helper to detect release for hold-to-dictate, so the same release detection can classify a press without adding a second required shortcut.

## 2026-05-10: Main Process Owns Automatic Update Checks

Decision:

VoxType should make automatic update checks configurable. When enabled, Electron main checks at startup and then about hourly. A startup update should reveal the main window even when Start minimized is enabled, but later periodic checks should only update the in-app status silently.

Reason:

Startup is the moment when a user most needs to notice an available update, especially if the app launched into the tray. Keeping periodic checks quiet avoids interrupting dictation work, and running checks from main lets startup visibility be handled reliably even while the renderer window is hidden.

## 2026-05-10: Ignore Start Minimized In Dev Builds

Decision:

Unpackaged development builds, including preview runs, should ignore the Start minimized setting for startup visibility and login-item hidden-launch behavior, while preserving the saved user preference for packaged release builds.

Reason:

During local iteration, a hidden main window makes startup look broken and can hide renderer or DevTools feedback. Preview is part of that local workflow even though it does not use the dev renderer URL. Packaged release builds should still honor the user-facing setting.

## 2026-05-27: Keep WASAPI Exclusive Separate From Handy VAD Parity

Decision:

The default local VAD recorder path should follow Handy's shared CPAL integration: a warmed native helper session, explicit ready/start/stop/shutdown commands, exact `SmoothedVad` prefill/hangover/onset behavior, VAD-error frame pass-through, and stop draining with an end-of-stream sentinel.

WASAPI exclusive capture should remain available as a separate Windows recording-coordination feature rather than defining the default Handy-parity VAD path.

Reason:

Handy's observed quality comes from the native CPAL lifecycle, frame smoothing, and stop-drain behavior, not just Silero thresholds. Exclusive capture solves a different problem: coordinating microphone ownership with other Windows apps. Keeping those concerns separate lets VoxType match Handy's dictation audio path while still offering stronger coordination when the user explicitly wants it.

## 2026-05-27: Ignore Developer Recording Knobs In Release Mode

Decision:

Superseded by `2026-05-29: Separate Debug View From Developer Build Mode`.

When VoxType is not running as a developer build, normal dictation should force local VAD enabled. Persisted developer-only values such as `vadEnabled: false` should only affect recording in a developer build.

Reason:

These controls are diagnostic escape hatches, not release-mode product behavior. A stale hidden `vadEnabled: false` setting allowed a mostly silent 280-second recording to reach Whisper, causing repeated hallucinated phrases after long pauses. Release-mode dictation should protect users from that kind of stale debug state.

## 2026-05-29: Separate Debug View From Developer Build Mode

Decision:

The old dense interface is the Debug view, controlled by a persisted `debugViewEnabled` setting and only reachable in developer builds. Developer mode is the runtime launch/build state (`isDeveloperBuild`, such as local dev or preview), not a view toggle. Changing between Release and Debug views must not change whether VoxType treats the app as a developer build.

Recording capture mode is a product/coordination setting and should be honored regardless of Release or Debug view. Disabling local VAD remains a developer-build diagnostic escape hatch; packaged release builds force VAD on.

Reason:

The previous `developerModeEnabled` setting conflated two concepts: selecting the old diagnostic UI and enabling developer-only recording behavior. That caused release-vs-debug view changes to affect recording behavior, including `exclusiveCapturePreferred`. Separating `debugViewEnabled` from `isDeveloperBuild` keeps the UI vocabulary honest and preserves VAD protection while allowing exclusive capture to work when recording starts.

## 2026-05-27: Compact Sparse Local Whisper Audio Before Decoding

Decision:

Local Whisper transcription should apply a final PCM16 WAV preparation step before invoking `whisper-cli`: trim leading/trailing silence, cap long internal silent spans, save that prepared audio to history, and pass `--language auto` when the user-facing language setting is `auto`.

Reason:

Re-transcribing the same 280-second saved WAV showed that VAD parity alone does not protect old or otherwise sparse audio once it reaches Whisper. The captured file contained roughly 50 seconds of active audio and about 230 seconds of low-energy audio, with silent spans up to 26.6 seconds. Capping silence before decoding removed the repetition loop on the captured sample, while the separate language fix makes VoxType's `auto` setting match `whisper-cli` behavior instead of silently defaulting to English.

## 2026-07-04: Preserve Bounded Pauses In The Native VAD Again

Decision:

`SmoothedVad` must honor `--vad-preserved-pause-frames` (`vadPreservedPauseMs`, default 2000 ms): silence frames after detected speech are buffered up to that cap and flushed only when speech resumes, and sub-onset voice frames are buffered so speech onsets are never clipped. Trailing silence at the end of a recording is still dropped. This amends the strict-Handy-parity part of `2026-05-27: Keep WASAPI Exclusive Separate From Handy VAD Parity`; the sparse-file guard from `2026-05-27: Compact Sparse Local Whisper Audio Before Decoding` stays in place.

Reason:

The Handy-parity rewrite silently ignored the preserved-pause setting, so every pause longer than the ~450 ms hangover was butt-spliced out of the WAV. Local Whisper then decoded long recordings as dense, unnaturally joined speech, producing weird cuts and dropped or merged words around pauses. Bounded preserved pauses give Whisper natural segmentation cues without recreating the sparse-file repetition loop, because preserved silence is capped at 2 s in the VAD and at 1 s again by the local Whisper compaction step.
