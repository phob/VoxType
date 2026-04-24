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

- Test paste into current app.
- Test keyboard typing into current app.
- Test Unicode typing.
- Test slow remote mode.
- Show detected app/process/window title.
- Show recommended insertion strategy.

This can turn messy Windows behavior into a visible, controllable feature.

