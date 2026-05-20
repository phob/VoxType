    fn write_wav(output_path: &Path, samples: &[f32]) -> Result<(), String> {
        let file = File::create(output_path).map_err(|error| error.to_string())?;
        let writer = BufWriter::new(file);
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: VOXTYPE_SAMPLE_RATE as u32,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut wav = hound::WavWriter::new(writer, spec).map_err(|error| error.to_string())?;

        for sample in samples {
            let clamped = sample.clamp(-1.0, 1.0);
            let value = if clamped < 0.0 {
                (clamped * 32768.0) as i16
            } else {
                (clamped * i16::MAX as f32) as i16
            };
            wav.write_sample(value).map_err(|error| error.to_string())?;
        }

        wav.finalize().map_err(|error| error.to_string())
    }

    fn parse_hwnd(value: &str) -> Result<HWND, String> {
        let normalized = value.trim().trim_start_matches("0x");
        let raw = usize::from_str_radix(normalized, 16)
            .map_err(|error| format!("Invalid hwnd '{value}': {error}"))?;

        Ok(HWND(raw as *mut _))
    }

    fn send_ctrl_v() -> Result<(), String> {
        let mut inputs = [
            keyboard_input(VK_CONTROL, false),
            keyboard_input(VK_V, false),
            keyboard_input(VK_V, true),
            keyboard_input(VK_CONTROL, true),
        ];
        let sent = unsafe { SendInput(&mut inputs, std::mem::size_of::<INPUT>() as i32) };

        if sent != inputs.len() as u32 {
            return Err(format!("SendInput sent {sent} of {} events.", inputs.len()));
        }

        Ok(())
    }

    fn send_unicode_unit(unit: u16) -> Result<(), String> {
        let mut inputs = [unicode_input(unit, false), unicode_input(unit, true)];
        let sent = unsafe { SendInput(&mut inputs, std::mem::size_of::<INPUT>() as i32) };

        if sent != inputs.len() as u32 {
            return Err(format!(
                "SendInput sent {sent} of {} unicode events.",
                inputs.len()
            ));
        }

        Ok(())
    }

    fn replace_focused_selection(text: &str) -> Result<(), String> {
        let hwnd = focused_message_window()?;
        let mut utf16: Vec<u16> = text.encode_utf16().collect();
        utf16.push(0);
        send_message_timeout(
            hwnd,
            EM_REPLACESEL,
            WPARAM(1),
            LPARAM(utf16.as_ptr() as isize),
            "EM_REPLACESEL",
        )
    }

    fn post_character_messages(text: &str, target_hwnd: Option<&str>) -> Result<(), String> {
        let hwnd = character_message_target(target_hwnd)?;

        for unit in text.encode_utf16() {
            let normalized = if unit == b'\n' as u16 {
                b'\r' as u16
            } else {
                unit
            };
            send_message_timeout(
                hwnd,
                WM_CHAR,
                WPARAM(normalized as usize),
                LPARAM(0),
                "WM_CHAR",
            )?;
        }

        Ok(())
    }

    fn character_message_target(target_hwnd: Option<&str>) -> Result<HWND, String> {
        let focus = focused_message_window().ok();
        let target = target_hwnd.map(parse_hwnd).transpose()?;

        if let Some(focus) = focus {
            if target
                .map(|target| hwnd_matches_or_is_child(target, focus))
                .unwrap_or(true)
            {
                return Ok(focus);
            }
        }

        if let Some(target) = target {
            return deepest_visible_child(target).unwrap_or(Ok(target));
        }

        focused_message_window()
    }

    fn focused_message_window() -> Result<HWND, String> {
        unsafe {
            let foreground = GetForegroundWindow();

            if foreground.0.is_null() {
                return Err("No foreground window is currently available.".to_string());
            }

            let mut info = GUITHREADINFO::default();
            info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;

            if GetGUIThreadInfo(0, &mut info).is_ok() && !info.hwndFocus.0.is_null() {
                return Ok(info.hwndFocus);
            }

            Ok(foreground)
        }
    }

    fn send_message_timeout(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        label: &str,
    ) -> Result<(), String> {
        let mut result = 0usize;
        let status = unsafe {
            SendMessageTimeoutW(
                hwnd,
                message,
                wparam,
                lparam,
                SMTO_ABORTIFHUNG,
                SEND_MESSAGE_TIMEOUT_MS,
                Some(&mut result),
            )
        };

        if status.0 == 0 {
            return Err(format!("{label} failed or timed out."));
        }

        Ok(())
    }

    fn hwnd_matches_or_is_child(parent: HWND, candidate: HWND) -> bool {
        parent == candidate || unsafe { IsChild(parent, candidate).as_bool() }
    }

    fn deepest_visible_child(hwnd: HWND) -> Option<Result<HWND, String>> {
        child_windows(hwnd)
            .into_iter()
            .rev()
            .find(|child| unsafe { IsWindowVisible(*child).as_bool() })
            .map(Ok)
    }

    fn child_windows(hwnd: HWND) -> Vec<HWND> {
        unsafe extern "system" fn enum_child(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let children = &mut *(lparam.0 as *mut Vec<HWND>);
            children.push(hwnd);
            BOOL(1)
        }

        let mut children = Vec::new();
        unsafe {
            let _ = EnumChildWindows(
                Some(hwnd),
                Some(enum_child),
                LPARAM((&mut children as *mut Vec<HWND>) as isize),
            );
        }
        children
    }

    fn push_message_target(targets: &mut Vec<MessageTarget>, hwnd: HWND, role: &str) {
        if targets
            .iter()
            .any(|target| target.hwnd == format_hwnd(hwnd))
        {
            return;
        }

        targets.push(MessageTarget {
            hwnd: format_hwnd(hwnd),
            role: role.to_string(),
            class_name: get_class_name(hwnd),
            title: get_window_title(hwnd),
            process_id: get_process_id(hwnd),
            visible: unsafe { IsWindowVisible(hwnd).as_bool() },
        });
    }

    fn format_hwnd(hwnd: HWND) -> String {
        format!("{:#x}", hwnd.0 as usize)
    }

    struct ParsedHotkey {
        modifiers: Vec<VIRTUAL_KEY>,
        key: VIRTUAL_KEY,
    }

    fn parse_hotkey(accelerator: &str) -> Result<ParsedHotkey, String> {
        let parts = accelerator
            .split('+')
            .map(|part| part.trim())
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        let key_name = parts
            .last()
            .ok_or_else(|| "Hotkey cannot be empty.".to_string())?;
        let mut modifiers = Vec::new();

        for part in &parts[..parts.len().saturating_sub(1)] {
            match part.to_ascii_lowercase().as_str() {
                "commandorcontrol" | "control" | "ctrl" => push_unique(&mut modifiers, VK_CONTROL),
                "alt" | "option" => push_unique(&mut modifiers, VK_LMENU),
                "shift" => push_unique(&mut modifiers, VK_LSHIFT),
                "super" | "meta" | "win" | "windows" | "command" => {
                    push_unique(&mut modifiers, VK_LWIN)
                }
                unknown => return Err(format!("Unsupported hotkey modifier: {unknown}")),
            }
        }

        Ok(ParsedHotkey {
            modifiers,
            key: parse_hotkey_key(key_name)?,
        })
    }

    fn push_unique(values: &mut Vec<VIRTUAL_KEY>, value: VIRTUAL_KEY) {
        if !values.contains(&value) {
            values.push(value);
        }
    }

    fn hotkey_is_pressed(hotkey: &ParsedHotkey) -> bool {
        hotkey.modifiers.iter().all(|key| virtual_key_is_down(*key))
            && virtual_key_is_down(hotkey.key)
    }

    fn virtual_key_is_down(key: VIRTUAL_KEY) -> bool {
        match key {
            VK_CONTROL => {
                virtual_key_state(VK_CONTROL)
                    || virtual_key_state(VK_LCONTROL)
                    || virtual_key_state(VK_RCONTROL)
            }
            VK_LMENU => virtual_key_state(VK_LMENU) || virtual_key_state(VK_RMENU),
            VK_LSHIFT => virtual_key_state(VK_LSHIFT) || virtual_key_state(VK_RSHIFT),
            VK_LWIN => virtual_key_state(VK_LWIN) || virtual_key_state(VK_RWIN),
            _ => virtual_key_state(key),
        }
    }

    fn virtual_key_state(key: VIRTUAL_KEY) -> bool {
        unsafe { (GetAsyncKeyState(key.0 as i32) & 0x8000u16 as i16) != 0 }
    }

    fn parse_hotkey_key(key: &str) -> Result<VIRTUAL_KEY, String> {
        let normalized = key.to_ascii_uppercase();

        if normalized.len() == 1 {
            let byte = normalized.as_bytes()[0];
            if byte.is_ascii_alphanumeric() {
                return Ok(VIRTUAL_KEY(byte as u16));
            }
        }

        let value = match normalized.as_str() {
            "SPACE" => 0x20,
            "ENTER" | "RETURN" => 0x0D,
            "TAB" => 0x09,
            "ESC" | "ESCAPE" => 0x1B,
            "BACKSPACE" => 0x08,
            "DELETE" => 0x2E,
            "INSERT" => 0x2D,
            "HOME" => 0x24,
            "END" => 0x23,
            "PAGEUP" => 0x21,
            "PAGEDOWN" => 0x22,
            "CAPSLOCK" | "CAPS" => 0x14,
            "NUMLOCK" | "NUM" => 0x90,
            "SCROLLLOCK" | "SCROLL" => 0x91,
            "PRINTSCREEN" | "PRINTSCRN" | "PRTSC" | "PRTSCN" => 0x2C,
            "PAUSE" | "BREAK" => 0x13,
            "UP" => 0x26,
            "DOWN" => 0x28,
            "LEFT" => 0x25,
            "RIGHT" => 0x27,
            "F1" => 0x70,
            "F2" => 0x71,
            "F3" => 0x72,
            "F4" => 0x73,
            "F5" => 0x74,
            "F6" => 0x75,
            "F7" => 0x76,
            "F8" => 0x77,
            "F9" => 0x78,
            "F10" => 0x79,
            "F11" => 0x7A,
            "F12" => 0x7B,
            _ => return Err(format!("Unsupported hotkey key: {key}")),
        };

        Ok(VIRTUAL_KEY(value))
    }

    fn keyboard_input(key: VIRTUAL_KEY, key_up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    wScan: 0,
                    dwFlags: if key_up {
                        KEYEVENTF_KEYUP
                    } else {
                        Default::default()
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn unicode_input(unit: u16, key_up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: unit,
                    dwFlags: if key_up {
                        KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
                    } else {
                        KEYEVENTF_UNICODE
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    struct ComGuard;

    impl ComGuard {
        unsafe fn new() -> Result<Self, String> {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                .ok()
                .map_err(|error| error.to_string())?;
            Ok(Self)
        }
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }

    fn get_window_title(hwnd: HWND) -> String {
        let length = unsafe { GetWindowTextLengthW(hwnd) };

        if length <= 0 {
            return String::new();
        }

        let mut buffer = vec![0u16; length as usize + 1];
        let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };

        String::from_utf16_lossy(&buffer[..copied as usize])
    }

    fn get_class_name(hwnd: HWND) -> String {
        let mut buffer = vec![0u16; 256];
        let copied = unsafe { GetClassNameW(hwnd, &mut buffer) };

        if copied <= 0 {
            return String::new();
        }

        String::from_utf16_lossy(&buffer[..copied as usize])
    }

    fn get_process_id(hwnd: HWND) -> u32 {
        let mut process_id = 0u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        }
        process_id
    }

    fn get_process_path(process_id: u32) -> Option<String> {
        let process =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }.ok()?;

        let mut buffer = [MaybeUninit::<u16>::uninit(); MAX_PATH as usize];
        let mut size = buffer.len() as u32;
        let result = unsafe {
            QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr().cast()),
                &mut size,
            )
        };

        unsafe {
            let _ = CloseHandle(process);
        }

        if result.is_err() || size == 0 {
            return None;
        }

        let initialized =
            unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast::<u16>(), size as usize) };

        Some(String::from_utf16_lossy(initialized))
    }

    fn pwstr_to_string_and_free(value: PWSTR) -> String {
        if value.is_null() {
            return String::new();
        }

        let mut len = 0usize;
        unsafe {
            while *value.0.add(len) != 0 {
                len += 1;
            }
        }

        let text = unsafe { String::from_utf16_lossy(std::slice::from_raw_parts(value.0, len)) };
        unsafe {
            CoTaskMemFree(Some(value.0.cast()));
        }
        text
    }
