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

Paste text into the foreground app:

```powershell
"hello from VoxType" | cargo run --manifest-path native/windows-helper/Cargo.toml -- paste-text
```
