# VoxType Windows Helper

Native helper for Windows-specific desktop integration.

Current command:

```powershell
cargo run --manifest-path native/windows-helper/Cargo.toml -- active-window
```

It prints JSON describing the current foreground window.

Focus a previously captured window:

```powershell
cargo run --manifest-path native/windows-helper/Cargo.toml -- focus-window 0x123456
```

Mute or unmute default system playback:

```powershell
cargo run --manifest-path native/windows-helper/Cargo.toml -- set-system-mute true
cargo run --manifest-path native/windows-helper/Cargo.toml -- set-system-mute false
```

Paste text into the foreground app:

```powershell
"hello from VoxType" | cargo run --manifest-path native/windows-helper/Cargo.toml -- paste-text
```

Type Unicode text into the foreground app without depending on the active Windows keyboard layout:

```powershell
"hello from VoxType" | cargo run --manifest-path native/windows-helper/Cargo.toml -- type-text
"slow remote text" | cargo run --manifest-path native/windows-helper/Cargo.toml -- type-text 25
```

Send text through Win32 window messages without using the clipboard or keyboard input:

```powershell
"hello from VoxType" | cargo run --manifest-path native/windows-helper/Cargo.toml -- message-text focused-control
"remote text" | cargo run --manifest-path native/windows-helper/Cargo.toml -- message-text character-messages
"remote text" | cargo run --manifest-path native/windows-helper/Cargo.toml -- message-text character-messages 0x123456
```
