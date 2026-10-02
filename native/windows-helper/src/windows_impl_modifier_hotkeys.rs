    // Global hotkeys made only of modifiers, such as Ctrl+Win. RegisterHotKey (and Electron's
    // globalShortcut on top of it) needs a non-modifier key, so a low-level keyboard hook watches key
    // transitions instead. Keys are never swallowed. One JSON line per event on stdout:
    //   {"event":"ready"}
    //   {"event":"pressed","accelerator":"..."}      the held modifiers became exactly this set
    //   {"event":"interrupted","accelerator":"..."}  another key went down while the set was held
    //                                               (Ctrl+Win+Right switches desktops); the app then
    //                                               discards the dictation this press started
    // The process exits when stdin closes, so it never outlives VoxType.
    // `--include-injected` also reacts to synthesized input; only the E2E test uses it, because
    // SendInput is the only way to press keys from a script.
    use std::sync::Mutex;
    use windows::Win32::Foundation::{HINSTANCE, LRESULT};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
        KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN,
        WM_SYSKEYUP,
    };

    const MODIFIER_CTRL: u8 = 1;
    const MODIFIER_ALT: u8 = 2;
    const MODIFIER_SHIFT: u8 = 4;
    const MODIFIER_WIN: u8 = 8;
    // Unassigned virtual key. Tapping it while Win or Alt is held keeps their release from opening
    // the Start menu or an app's menu bar (the same trick as AutoHotkey's MenuMaskKey).
    const MENU_MASK_KEY: VIRTUAL_KEY = VIRTUAL_KEY(0xE8);
    // dwExtraInfo of the mask key, so the hook never mistakes it for an interrupting key press.
    const MENU_MASK_MARKER: usize = 0x5658_4D4B;

    struct ModifierHotkey {
        mask: u8,
        accelerator: String,
    }

    struct ModifierHookState {
        hotkeys: Vec<ModifierHotkey>,
        /// Index of the hotkey whose modifiers are still held after it fired.
        active: Option<usize>,
        interrupted: bool,
        include_injected: bool,
        events: Option<mpsc::Sender<String>>,
    }

    static MODIFIER_HOOK: Mutex<ModifierHookState> = Mutex::new(ModifierHookState {
        hotkeys: Vec::new(),
        active: None,
        interrupted: false,
        include_injected: false,
        events: None,
    });

    #[derive(Serialize)]
    struct ModifierHotkeyEvent<'a> {
        event: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        accelerator: Option<&'a str>,
    }

    pub fn modifier_hotkeys(args: &[String]) -> Result<(), String> {
        let include_injected = args.iter().any(|arg| arg == "--include-injected");
        let mut hotkeys = Vec::new();
        for accelerator in args.iter().filter(|arg| !arg.starts_with("--")) {
            hotkeys.push(ModifierHotkey {
                mask: parse_modifier_only_hotkey(accelerator)?,
                accelerator: accelerator.clone(),
            });
        }
        if hotkeys.is_empty() {
            return Err("modifier-hotkeys requires at least one accelerator.".to_string());
        }

        // Stdout is written from its own thread: a hook callback must return quickly or Windows
        // drops the hook.
        let (sender, receiver) = mpsc::channel::<String>();
        thread::spawn(move || {
            let mut stdout = io::stdout().lock();
            for line in receiver {
                if writeln!(stdout, "{line}").and_then(|_| stdout.flush()).is_err() {
                    std::process::exit(0);
                }
            }
        });
        thread::spawn(|| {
            let mut sink = Vec::new();
            let _ = io::stdin().lock().read_until(0, &mut sink);
            std::process::exit(0);
        });

        {
            let mut state = lock_modifier_hook();
            state.hotkeys = hotkeys;
            state.include_injected = include_injected;
            state.events = Some(sender.clone());
        }

        unsafe {
            let module = GetModuleHandleW(None).map_err(|error| error.to_string())?;
            SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(modifier_hook_proc),
                Some(HINSTANCE(module.0)),
                0,
            )
            .map_err(|error| format!("Could not install the keyboard hook: {error}"))?;
        }

        let _ = sender.send(modifier_event_json("ready", None));

        // Low-level hooks are called on this thread while it pumps messages.
        let mut message = MSG::default();
        unsafe {
            while GetMessageW(&mut message, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }

        Ok(())
    }

    fn parse_modifier_only_hotkey(accelerator: &str) -> Result<u8, String> {
        let mut mask = 0u8;
        for part in accelerator.split('+').map(str::trim).filter(|part| !part.is_empty()) {
            mask |= match parse_hotkey_modifier(part) {
                Some(VK_CONTROL) => MODIFIER_CTRL,
                Some(VK_LMENU) => MODIFIER_ALT,
                Some(VK_LSHIFT) => MODIFIER_SHIFT,
                Some(VK_LWIN) => MODIFIER_WIN,
                _ => return Err(format!("{accelerator} is not a modifier-only hotkey.")),
            };
        }
        if mask.count_ones() < 2 {
            return Err(format!("A modifier-only hotkey needs at least two modifiers: {accelerator}"));
        }
        Ok(mask)
    }

    fn modifier_bit(vk: u32) -> u8 {
        match vk {
            0x10 | 0xA0 | 0xA1 => MODIFIER_SHIFT,
            0x11 | 0xA2 | 0xA3 => MODIFIER_CTRL,
            0x12 | 0xA4 | 0xA5 => MODIFIER_ALT,
            0x5B | 0x5C => MODIFIER_WIN,
            _ => 0,
        }
    }

    /// Modifiers held before the current hook event (the async state is updated after the hook chain).
    fn held_modifiers() -> u8 {
        let mut mask = 0;
        if virtual_key_is_down(VK_CONTROL) {
            mask |= MODIFIER_CTRL;
        }
        if virtual_key_is_down(VK_LMENU) {
            mask |= MODIFIER_ALT;
        }
        if virtual_key_is_down(VK_LSHIFT) {
            mask |= MODIFIER_SHIFT;
        }
        if virtual_key_is_down(VK_LWIN) {
            mask |= MODIFIER_WIN;
        }
        mask
    }

    unsafe extern "system" fn modifier_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            // For WH_KEYBOARD_LL, lparam points to a KBDLLHOOKSTRUCT that is valid for this call.
            let event = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            let message = wparam.0 as u32;
            let is_down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
            let is_up = message == WM_KEYUP || message == WM_SYSKEYUP;

            // Injected input is ours (the mask key, pasted text) or another tool's, not the user's.
            let injected = (event.flags & LLKHF_INJECTED).0 != 0;
            if (is_down || is_up) && event.dwExtraInfo != MENU_MASK_MARKER {
                handle_modifier_key(event.vkCode, is_down, injected);
            }
        }

        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    fn handle_modifier_key(vk: u32, is_down: bool, injected: bool) {
        let mut state = lock_modifier_hook();
        if injected && !state.include_injected {
            return;
        }
        let bit = modifier_bit(vk);
        let before = held_modifiers();
        let after = match (bit, is_down) {
            (0, _) => before,
            (_, true) => before | bit,
            (_, false) => before & !bit,
        };

        if let Some(index) = state.active {
            let mask = state.hotkeys[index].mask;
            if after & mask != mask {
                state.active = None;
            } else if is_down && bit == 0 && !state.interrupted {
                state.interrupted = true;
                let line = modifier_event_json("interrupted", Some(&state.hotkeys[index].accelerator));
                send_modifier_event(&state, line);
            }
        }

        // Only on the key-down that completes the set; auto-repeat leaves the set unchanged.
        if state.active.is_none() && is_down && bit != 0 && before != after {
            if let Some(index) = state.hotkeys.iter().position(|hotkey| hotkey.mask == after) {
                state.active = Some(index);
                state.interrupted = false;
                let line = modifier_event_json("pressed", Some(&state.hotkeys[index].accelerator));
                send_modifier_event(&state, line);
                if after & (MODIFIER_WIN | MODIFIER_ALT) != 0 {
                    let mut inputs = [menu_mask_input(false), menu_mask_input(true)];
                    unsafe {
                        SendInput(&mut inputs, std::mem::size_of::<INPUT>() as i32);
                    }
                }
            }
        }
    }

    fn menu_mask_input(key_up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: MENU_MASK_KEY,
                    wScan: 0,
                    dwFlags: if key_up {
                        KEYEVENTF_KEYUP
                    } else {
                        Default::default()
                    },
                    time: 0,
                    dwExtraInfo: MENU_MASK_MARKER,
                },
            },
        }
    }

    fn lock_modifier_hook() -> std::sync::MutexGuard<'static, ModifierHookState> {
        // The state stays consistent even if a holder panicked; keep using it.
        MODIFIER_HOOK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn send_modifier_event(state: &ModifierHookState, line: String) {
        if let Some(events) = &state.events {
            let _ = events.send(line);
        }
    }

    fn modifier_event_json(event: &str, accelerator: Option<&str>) -> String {
        serde_json::to_string(&ModifierHotkeyEvent { event, accelerator })
            .unwrap_or_else(|_| format!("{{\"event\":\"{event}\"}}"))
    }
