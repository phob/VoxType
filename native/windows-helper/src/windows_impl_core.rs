    use base64::{prelude::BASE64_STANDARD, Engine as _};
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::SizedSample;
    use image::{ImageBuffer, Rgba};
    use rubato::{FftFixedIn, Resampler};
    use serde::{Deserialize, Serialize};
    use std::collections::{HashSet, VecDeque};
    use std::ffi::OsString;
    use std::fs::File;
    use std::io::{self, BufRead, BufReader, BufWriter, Write};
    use std::mem::MaybeUninit;
    use std::os::windows::ffi::OsStringExt;
    use std::path::Path;
    use std::ptr;
    use std::slice;
    use std::sync::mpsc;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use std::thread;
    use std::time::Duration;
    use vad_rs::Vad;
    use windows::core::{Interface, BOOL, GUID, PWSTR};
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    use windows::Win32::Devices::Properties;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, MAX_PATH, RECT, WPARAM};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, GetMonitorInfoW, MonitorFromWindow, ReleaseDC, SelectObject, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ, MONITORINFO,
        MONITOR_DEFAULTTONEAREST, SRCCOPY,
    };
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eCapture, eConsole, eRender, IAudioCaptureClient, IAudioClient, IAudioSessionControl2,
        IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, ISimpleAudioVolume,
        MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_EXCLUSIVE,
        DEVICE_STATE_ACTIVE, WAVEFORMATEX, WAVEFORMATEXTENSIBLE, WAVE_FORMAT_PCM,
    };
    use windows::Win32::Media::KernelStreaming::WAVE_FORMAT_EXTENSIBLE;
    use windows::Win32::Media::Multimedia::WAVE_FORMAT_IEEE_FLOAT;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, StructuredStorage,
        CLSCTX_ALL, COINIT_APARTMENTTHREADED, STGM_READ,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        KEYEVENTF_UNICODE, VIRTUAL_KEY, VK_CONTROL, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN,
        VK_RCONTROL, VK_RMENU, VK_RSHIFT, VK_RWIN, VK_V,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, GetClassNameW, GetForegroundWindow, GetGUIThreadInfo, GetSystemMetrics,
        GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsChild,
        IsIconic, IsWindowVisible, SendMessageTimeoutW, SetForegroundWindow, ShowWindow,
        GUITHREADINFO, SMTO_ABORTIFHUNG, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN, SW_RESTORE, WM_CHAR,
    };

    const EM_REPLACESEL: u32 = 0x00C2;
    const SEND_MESSAGE_TIMEOUT_MS: u32 = 250;
    const VOXTYPE_SAMPLE_RATE: usize = 16_000;
    const RESAMPLER_CHUNK_SIZE: usize = 1024;
    const VAD_FRAME_MS: usize = 30;
    const VAD_FRAME_SAMPLES: usize = VOXTYPE_SAMPLE_RATE * VAD_FRAME_MS / 1000;
    const OCR_TILE_OVERLAP: u32 = 96;

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ActiveWindow {
        hwnd: String,
        title: String,
        process_id: u32,
        process_path: Option<String>,
        process_name: Option<String>,
        bounds: Option<WindowBounds>,
        fullscreen: bool,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct WindowBounds {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
        width: i32,
        height: i32,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct WindowsOcrResult {
        provider: String,
        engine: String,
        image_path: String,
        text: String,
        lines: Vec<WindowsOcrLine>,
        duration_ms: u128,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct InputDevice {
        id: String,
        name: String,
        is_default: bool,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct WindowsOcrLine {
        text: String,
        confidence: Option<f32>,
        box_: Option<[i32; 4]>,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MessageTarget {
        hwnd: String,
        role: String,
        class_name: String,
        title: String,
        process_id: u32,
        visible: bool,
    }

    struct OcrImage {
        width: u32,
        height: u32,
        bgra: Vec<u8>,
    }

    pub fn get_active_window() -> Result<ActiveWindow, String> {
        let hwnd = unsafe { GetForegroundWindow() };

        if hwnd.0.is_null() {
            return Err("No foreground window is currently available.".to_string());
        }

        let process_id = get_process_id(hwnd);
        let process_path = get_process_path(process_id);
        let process_name = process_path
            .as_deref()
            .and_then(|path| path.rsplit(['\\', '/']).next())
            .filter(|name| !name.is_empty())
            .map(ToOwned::to_owned);
        let rect = window_rect(hwnd, "foreground window").ok();
        let bounds = rect.map(window_bounds);
        let fullscreen = rect
            .map(|value| window_covers_monitor(hwnd, value))
            .unwrap_or(false);

        Ok(ActiveWindow {
            hwnd: format!("{:#x}", hwnd.0 as usize),
            title: get_window_title(hwnd),
            process_id,
            process_path,
            process_name,
            bounds,
            fullscreen,
        })
    }

    pub fn paste_text(delay_ms: u64) -> Result<(), String> {
        if delay_ms > 0 {
            thread::sleep(Duration::from_millis(delay_ms));
        }
        send_ctrl_v()
    }

    pub fn type_text(text: &str, delay_ms: u64) -> Result<(), String> {
        let delay = if delay_ms > 0 {
            Some(Duration::from_millis(delay_ms))
        } else {
            None
        };

        for unit in text.encode_utf16() {
            send_unicode_unit(unit)?;

            if let Some(delay) = delay {
                thread::sleep(delay);
            }
        }

        Ok(())
    }

    pub fn message_text(
        text: &str,
        strategy: &str,
        target_hwnd: Option<&str>,
    ) -> Result<(), String> {
        match strategy {
            "focused-control" => replace_focused_selection(text),
            "character-messages" => post_character_messages(text, target_hwnd),
            unknown => Err(format!(
                "message-text strategy must be focused-control or character-messages, got {unknown}."
            )),
        }
    }

    pub fn message_targets(target_hwnd: Option<&str>) -> Result<Vec<MessageTarget>, String> {
        let foreground = unsafe { GetForegroundWindow() };
        let focus = focused_message_window().ok();
        let target = target_hwnd.map(parse_hwnd).transpose()?;
        let mut targets = Vec::new();

        if !foreground.0.is_null() {
            push_message_target(&mut targets, foreground, "foreground");
        }

        if let Some(focus) = focus {
            push_message_target(&mut targets, focus, "focus");
        }

        if let Some(target) = target {
            push_message_target(&mut targets, target, "target");

            for child in child_windows(target) {
                push_message_target(&mut targets, child, "targetChild");
            }
        }

        Ok(targets)
    }

    pub fn focus_window(hwnd: &str) -> Result<(), String> {
        let hwnd = parse_hwnd(hwnd)?;

        unsafe {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }

            if SetForegroundWindow(hwnd).as_bool() == false {
                return Err("Failed to focus target window.".to_string());
            }
        }

        Ok(())
    }

    pub fn set_system_mute(muted: bool) -> Result<(), String> {
        unsafe {
            let _com = ComGuard::new()?;
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|error| error.to_string())?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|error| error.to_string())?;
            let endpoint: IAudioEndpointVolume = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|error| error.to_string())?;

            endpoint
                .SetMute(muted, std::ptr::null())
                .map_err(|error| error.to_string())?;
        }

        Ok(())
    }

    pub fn send_hotkey(accelerator: &str) -> Result<(), String> {
        let hotkey = parse_hotkey(accelerator)?;
        let mut inputs = Vec::with_capacity((hotkey.modifiers.len() * 2) + 2);

        for modifier in &hotkey.modifiers {
            inputs.push(keyboard_input(*modifier, false));
        }

        inputs.push(keyboard_input(hotkey.key, false));
        inputs.push(keyboard_input(hotkey.key, true));

        for modifier in hotkey.modifiers.iter().rev() {
            inputs.push(keyboard_input(*modifier, true));
        }

        let sent = unsafe { SendInput(&mut inputs, std::mem::size_of::<INPUT>() as i32) };

        if sent != inputs.len() as u32 {
            return Err(format!("SendInput sent {sent} of {} events.", inputs.len()));
        }

        Ok(())
    }

    pub fn wait_hotkey_release(accelerator: &str) -> Result<(), String> {
        let hotkey = parse_hotkey(accelerator)?;

        while hotkey_is_pressed(&hotkey) {
            thread::sleep(Duration::from_millis(20));
        }

        Ok(())
    }

    #[derive(Deserialize, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct CaptureSessionMuteState {
        sessions: Vec<CaptureSessionMuteEntry>,
    }

    #[derive(Deserialize, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct CaptureSessionMuteEntry {
        session_instance_identifier: String,
        process_id: u32,
        process_name: Option<String>,
        muted_before: bool,
    }

    pub fn mute_capture_sessions(
        target_process_id: u32,
        target_process_name: Option<&str>,
    ) -> Result<CaptureSessionMuteState, String> {
        let target_process_name = target_process_name.map(|name| name.to_ascii_lowercase());
        let mut muted_sessions = Vec::new();

        unsafe {
            let _com = ComGuard::new()?;
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|error| error.to_string())?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eCapture, eConsole)
                .map_err(|error| error.to_string())?;
            let manager: IAudioSessionManager2 = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|error| error.to_string())?;
            let sessions = manager
                .GetSessionEnumerator()
                .map_err(|error| error.to_string())?;
            let count = sessions.GetCount().map_err(|error| error.to_string())?;

            for index in 0..count {
                let session = sessions
                    .GetSession(index)
                    .map_err(|error| error.to_string())?;
                let session2: IAudioSessionControl2 =
                    session.cast().map_err(|error| error.to_string())?;
                let process_id = session2.GetProcessId().map_err(|error| error.to_string())?;
                let process_name = get_process_path(process_id)
                    .as_deref()
                    .and_then(|path| path.rsplit(['\\', '/']).next())
                    .map(|name| name.to_ascii_lowercase());

                if process_id != target_process_id
                    && process_name.as_deref() != target_process_name.as_deref()
                {
                    continue;
                }

                let volume: ISimpleAudioVolume =
                    session.cast().map_err(|error| error.to_string())?;
                let muted_before = volume
                    .GetMute()
                    .map_err(|error| error.to_string())?
                    .as_bool();

                if muted_before {
                    continue;
                }

                volume
                    .SetMute(true, std::ptr::null())
                    .map_err(|error| error.to_string())?;

                muted_sessions.push(CaptureSessionMuteEntry {
                    session_instance_identifier: pwstr_to_string_and_free(
                        session2
                            .GetSessionInstanceIdentifier()
                            .map_err(|error| error.to_string())?,
                    ),
                    process_id,
                    process_name,
                    muted_before,
                });
            }
        }

        Ok(CaptureSessionMuteState {
            sessions: muted_sessions,
        })
    }

    pub fn restore_capture_sessions(state: &CaptureSessionMuteState) -> Result<(), String> {
        if state.sessions.is_empty() {
            return Ok(());
        }

        unsafe {
            let _com = ComGuard::new()?;
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|error| error.to_string())?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eCapture, eConsole)
                .map_err(|error| error.to_string())?;
            let manager: IAudioSessionManager2 = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|error| error.to_string())?;
            let sessions = manager
                .GetSessionEnumerator()
                .map_err(|error| error.to_string())?;
            let count = sessions.GetCount().map_err(|error| error.to_string())?;

            for index in 0..count {
                let session = sessions
                    .GetSession(index)
                    .map_err(|error| error.to_string())?;
                let session2: IAudioSessionControl2 =
                    session.cast().map_err(|error| error.to_string())?;
                let process_id = session2.GetProcessId().map_err(|error| error.to_string())?;
                let session_instance_identifier = pwstr_to_string_and_free(
                    session2
                        .GetSessionInstanceIdentifier()
                        .map_err(|error| error.to_string())?,
                );

                if let Some(entry) = state.sessions.iter().find(|entry| {
                    entry.process_id == process_id
                        && entry.session_instance_identifier == session_instance_identifier
                }) {
                    let volume: ISimpleAudioVolume =
                        session.cast().map_err(|error| error.to_string())?;
                    volume
                        .SetMute(entry.muted_before, std::ptr::null())
                        .map_err(|error| error.to_string())?;
                }
            }
        }

        Ok(())
    }

