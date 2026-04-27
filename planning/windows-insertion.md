# Windows Insertion

## Goal

VoxType should type into real Windows apps, not only web text boxes.

Insertion reliability should be a core product advantage.

## Insertion Strategies

### Clipboard Paste

Fastest and usually most reliable.

Flow:

1. Save current clipboard if configured.
2. Set clipboard to transcript.
3. Send paste hotkey.
4. Optionally restore prior clipboard.

Tradeoffs:

- Very fast.
- Works in most text fields.
- Can fail in remote sessions if clipboard sync is disabled.
- Can be blocked by some apps.
- Must handle sensitive clipboard contents carefully.

Initial restore behavior:

- When `restoreClipboard` is enabled, VoxType snapshots clipboard contents before paste insertion.
- VoxType restores common clipboard data after paste: plain text, HTML, RTF, and images.
- Unusual Windows clipboard formats are restored on a best-effort basis through Electron raw buffers and may not always round-trip perfectly.

Focus behavior:

- Target-window insertion should not change the window's maximized state.
- The native helper should only call `SW_RESTORE` when a captured target window is minimized.

### Remote Clipboard Paste

Clipboard paste with timing tuned for remote-control tools.

Flow:

1. Save current clipboard if configured.
2. Set clipboard to transcript.
3. Wait briefly so TeamViewer/RDP/AnyDesk can synchronize the new clipboard content.
4. Send paste hotkey.
5. Wait longer before restoring the prior clipboard so the remote paste does not race clipboard restoration.

Initial implementation:

- VoxType exposes `remoteClipboard` as an insertion mode.
- TeamViewer, AnyDesk, and Remote Desktop profiles default to `remoteClipboard`.
- The native helper accepts `paste-text <delay-ms>` so paste can happen after a clipboard-settle delay.
- VoxType exposes `remoteClipboardPasteDelayMs` in the developer settings tab so TeamViewer/RDP clipboard synchronization can be tuned per machine.
- VoxType defaults to a 450 ms pre-paste delay and uses a 1500 ms post-paste restore delay for remote clipboard insertion.

Reason:

- Windows Messaging did not work reliably for TeamViewer remote text transfer.
- Plain clipboard paste can paste stale remote clipboard content when `Ctrl+V` is sent before TeamViewer has synchronized the local clipboard update.

### Keyboard Emulation

Use Windows keyboard injection, likely through `SendInput`.

Use cases:

- Apps where paste does not work.
- Remote Desktop.
- TeamViewer.
- Legacy apps.
- Fields that block clipboard input.

Tradeoffs:

- More compatible in difficult apps.
- Slower than paste.
- Needs careful Unicode handling.
- Target apps may drop characters if typing is too fast.

Initial implementation:

- The native helper exposes `type-text`.
- Text is sent as Unicode `SendInput` events with `KEYEVENTF_UNICODE` instead of virtual key codes.
- Direct typing should not depend on the currently selected Windows keyboard layout for normal Unicode text.
- Focusing a captured target window preserves maximized windows and only restores minimized windows.

### Chunked Typing

Keyboard emulation with configurable delays and chunks.

Useful for:

- RDP
- TeamViewer
- AnyDesk
- virtual machines
- admin tools
- slow web apps

Settings:

- characters per chunk
- delay between chunks
- delay after punctuation
- paste first, fallback to typing

Initial implementation:

- The `chunked` insertion mode sends Unicode text in chunks.
- Chunk size and delay are controlled by local settings.
- This is the first remote-safe mode for RDP, TeamViewer, and other targets that may drop very fast input.

Known limitation:

- TeamViewer and similar remote-control tools may treat injected Unicode input as keyboard activity instead of committed text. With layouts such as US-International, this can trigger dead-key or shortcut-like behavior on the remote side. Remote profiles may need a separate layout-safe scan-code typing mode, a companion receiver running on the remote machine, or a no-auto-insert review mode when clipboard and typing are both unsafe.

### Windows Messaging

Send text through Win32 window messages instead of the clipboard or simulated keyboard input.

Initial implementation:

- VoxType exposes `windowsMessaging` as an insertion mode in global settings, app profiles, and the insertion test panel.
- The native helper exposes `message-text focused-control`, which sends `EM_REPLACESEL` to the focused control.
- The native helper exposes `message-text character-messages`, which posts `WM_CHAR` messages to the focused foreground target.
- Windows Messaging remains experimental. TeamViewer, AnyDesk, and Remote Desktop now default to `remoteClipboard`; VoxType still uses character messages for these remote-control targets when `windowsMessaging` is selected manually.

Likely implementation paths:

- Find the focused control or caret owner with foreground-window/thread inspection.
- For standard Win32 edit and rich edit controls, send `EM_REPLACESEL` to insert at the caret or replace the current selection.
- For full replacement in compatible controls, send `WM_SETTEXT`.
- For remote-control windows such as TeamViewer, test posting Unicode character messages such as `WM_CHAR` or `WM_UNICHAR` to the TeamViewer viewport, because the remote-control app may forward those as text without involving the local keyboard layout.

Benefits:

- Does not disturb clipboard contents or clipboard file transfers.
- Does not depend on the current keyboard layout in the same way as scan-code or virtual-key typing.
- Can be faster and cleaner than chunked keyboard simulation when the target accepts text messages.

Limitations:

- Works best with classic Windows controls; browser, Electron, Qt, WPF, UWP, terminal, and remote-control surfaces vary widely.
- Cannot send messages from a lower-integrity process into a higher-integrity/elevated target because of UIPI.
- `SendMessage` can block if the target thread hangs, so use timeout-based calls for reliability testing.
- It needs an insertion test panel because success is highly target-specific.

### Remote Companion Receiver

A future remote-safe insertion option is a small VoxType receiver running on the target machine, but this is not viable for customer systems where VoxType cannot install software.

Flow:

1. VoxType transcribes locally.
2. The local app sends the final text to the paired receiver over a local network, tunnel, or remote-session-accessible channel.
3. The receiver inserts text locally on the target machine using clipboard paste, UI Automation, or local keyboard input.

Benefits:

- Avoids disturbing the local clipboard during remote file transfers.
- Avoids TeamViewer keyboard layout translation problems.
- Lets the remote machine choose the safest local insertion method.

Tradeoffs:

- Requires installing and pairing a helper on the remote machine.
- Needs authentication and clear local-only/network privacy controls.
- Not useful when the user cannot run software on the remote system.

### UI Automation

Use Windows UI Automation where available to set or inspect text fields.

Useful for:

- standard Windows controls
- accessibility-friendly apps

Limitations:

- not reliable in all custom apps
- may fail across privilege boundaries
- likely not useful for all remote apps

## App Compatibility Profiles

VoxType should support per-app profiles:

- Default
- Word/Office
- Browser
- VS Code
- Terminal
- Remote Desktop
- TeamViewer
- AnyDesk
- Admin/elevated tools

Each profile can define:

- preferred insertion method
- typing speed
- punctuation style
- formatting mode
- dictionary categories
- whether to restore clipboard
- whether to show review before insertion

Initial implementation:

- Profiles are automatically created when VoxType detects a new target process.
- Profiles are stored in local settings and are visible/editable in the renderer.
- Each profile currently stores app display name, process name/path, insertion mode, and writing style.
- Browser defaults, including Chrome, use clipboard insertion and chat writing style.
- Remote Desktop, TeamViewer, and AnyDesk defaults use chunked typing.
- Terminal defaults, including Windows Terminal, Command Prompt, and PowerShell, use direct Unicode typing.
- Outlook defaults to clipboard insertion and professional writing style.
- Writing style is saved now so later formatting can use profile-specific behavior such as chat-style browser replies or professional Outlook grammar.

## Privilege Issues

Windows input automation can fail when the target app runs at a higher privilege level than VoxType.

VoxType should detect and explain:

- target app is elevated
- VoxType helper is not elevated
- insertion may fail

Possible solutions:

- prompt user to restart helper elevated
- run a separate elevated helper only when needed
- document limitations clearly

## Reliability Test Panel

Settings should include a test area:

- Test paste into a captured target app.
- Test keyboard typing into a captured target app.
- Test Unicode typing.
- Test slow remote mode.
- Show detected app/process/window title.
- Show recommended insertion strategy.

This can turn messy Windows behavior into a visible, controllable feature.

Initial implementation:

- The renderer includes an insertion test panel with editable test text.
- The panel can capture a target window after a short delay so the user can switch focus away from VoxType.
- Clipboard paste, Unicode direct typing, and chunked typing can be tested independently without changing the saved insertion mode.
