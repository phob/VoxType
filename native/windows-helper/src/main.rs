use serde::Serialize;
use std::env;
use std::io::{self, Read};
use std::process;

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

fn main() {
    let command = env::args().nth(1).unwrap_or_else(|| "help".to_string());
    let result = match command.as_str() {
        "active-window" => active_window_json(),
        "focus-window" => focus_window_from_arg(),
        "set-system-mute" => set_system_mute_from_arg(),
        "send-hotkey" => send_hotkey_from_arg(),
        "capture-screenshot" => capture_screenshot_from_args(),
        "ocr-image" => ocr_image_from_args(),
        "mute-capture-session" => mute_capture_session_from_args(),
        "restore-capture-session" => restore_capture_session_from_stdin(),
        "record-wav" => record_wav_from_args(),
        "paste-text" => paste_text_from_stdin(),
        "type-text" => type_text_from_stdin(),
        "message-text" => message_text_from_stdin(),
        "help" | "--help" | "-h" => {
            println!("Usage: voxtype-windows-helper active-window | focus-window <hwnd> | set-system-mute <true|false> | send-hotkey <accelerator> | capture-screenshot <output.png> [--active-window | --hwnd <hwnd>] | ocr-image <input.png> | mute-capture-session <process-id> [process-name] | restore-capture-session | record-wav <output.wav> [--capture-mode shared|exclusive-preferred|exclusive-required] | paste-text | type-text [delay-ms] | message-text [focused-control|character-messages]");
            Ok(())
        }
        _ => Err(format!("Unknown command: {command}")),
    };

    if let Err(error) = result {
        println!(
            "{}",
            serde_json::to_string(&ErrorResponse { error }).expect("serialize error")
        );
        process::exit(1);
    }
}

#[cfg(windows)]
fn ocr_image_from_args() -> Result<(), String> {
    let input_path = env::args()
        .nth(2)
        .ok_or_else(|| "ocr-image requires an input image path.".to_string())?;
    let result = windows_impl::recognize_image_text(&input_path)?;
    println!(
        "{}",
        serde_json::to_string(&result)
            .map_err(|error| format!("Could not serialize OCR result: {error}"))?
    );
    Ok(())
}

#[cfg(not(windows))]
fn ocr_image_from_args() -> Result<(), String> {
    Err("ocr-image is only supported on Windows.".to_string())
}

#[cfg(windows)]
fn capture_screenshot_from_args() -> Result<(), String> {
    let output_path = env::args()
        .nth(2)
        .ok_or_else(|| "capture-screenshot requires an output path.".to_string())?;
    let args = env::args().skip(3).collect::<Vec<_>>();
    let active_window_only = args.iter().any(|arg| arg == "--active-window");
    let hwnd = args
        .windows(2)
        .find(|items| items[0] == "--hwnd")
        .map(|items| items[1].as_str());
    windows_impl::capture_screenshot(&output_path, active_window_only, hwnd)
}

#[cfg(not(windows))]
fn capture_screenshot_from_args() -> Result<(), String> {
    Err("capture-screenshot is only supported on Windows.".to_string())
}

#[cfg(windows)]
fn record_wav_from_args() -> Result<(), String> {
    let output_path = env::args()
        .nth(2)
        .ok_or_else(|| "record-wav requires an output path.".to_string())?;
    let options = NativeRecordingConfig::from_args()?;
    windows_impl::record_wav_until_stdin_stop(&output_path, options)
}

#[cfg(not(windows))]
fn record_wav_from_args() -> Result<(), String> {
    Err("record-wav is only supported on Windows.".to_string())
}

#[derive(Clone)]
struct NativeRecordingConfig {
    capture_mode: CaptureMode,
    vad: NativeVadConfig,
}

impl NativeRecordingConfig {
    fn from_args() -> Result<Self, String> {
        let args = env::args().skip(3).collect::<Vec<_>>();
        let mut capture_mode = CaptureMode::Shared;
        let mut vad_config = NativeVadConfig::default();
        let mut index = 0;

        while index < args.len() {
            match args[index].as_str() {
                "--capture-mode" => {
                    index += 1;
                    capture_mode = CaptureMode::from_arg(
                        args.get(index)
                            .ok_or_else(|| "--capture-mode requires a value.".to_string())?,
                    )?;
                }
                "--vad-model" => {
                    index += 1;
                    vad_config.enabled = true;
                    vad_config.model_path = args.get(index).cloned();
                }
                "--vad-threshold" => {
                    index += 1;
                    vad_config.threshold = args
                        .get(index)
                        .ok_or_else(|| "--vad-threshold requires a value.".to_string())?
                        .parse::<f32>()
                        .map_err(|error| format!("Invalid --vad-threshold: {error}"))?;
                }
                "--vad-prefill-frames" => {
                    index += 1;
                    vad_config.prefill_frames =
                        parse_usize_arg(&args, index, "--vad-prefill-frames")?;
                }
                "--vad-hangover-frames" => {
                    index += 1;
                    vad_config.hangover_frames =
                        parse_usize_arg(&args, index, "--vad-hangover-frames")?;
                }
                "--vad-onset-frames" => {
                    index += 1;
                    vad_config.onset_frames = parse_usize_arg(&args, index, "--vad-onset-frames")?;
                }
                option => return Err(format!("Unknown record-wav option: {option}")),
            }
            index += 1;
        }

        if vad_config.enabled && vad_config.model_path.is_none() {
            return Err("--vad-model requires a model path.".to_string());
        }

        Ok(Self {
            capture_mode,
            vad: vad_config,
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CaptureMode {
    Shared,
    ExclusivePreferred,
    ExclusiveRequired,
}

impl CaptureMode {
    fn from_arg(value: &str) -> Result<Self, String> {
        match value {
            "shared" => Ok(Self::Shared),
            "exclusive-preferred" => Ok(Self::ExclusivePreferred),
            "exclusive-required" => Ok(Self::ExclusiveRequired),
            _ => Err(
                "capture mode must be shared, exclusive-preferred, or exclusive-required."
                    .to_string(),
            ),
        }
    }
}

#[derive(Clone)]
struct NativeVadConfig {
    enabled: bool,
    model_path: Option<String>,
    threshold: f32,
    prefill_frames: usize,
    hangover_frames: usize,
    onset_frames: usize,
}

impl Default for NativeVadConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            model_path: None,
            threshold: 0.3,
            prefill_frames: 15,
            hangover_frames: 15,
            onset_frames: 2,
        }
    }
}

fn parse_usize_arg(args: &[String], index: usize, name: &str) -> Result<usize, String> {
    args.get(index)
        .ok_or_else(|| format!("{name} requires a value."))?
        .parse::<usize>()
        .map_err(|error| format!("Invalid {name}: {error}"))
}

#[cfg(windows)]
fn active_window_json() -> Result<(), String> {
    let active_window = windows_impl::get_active_window()?;
    println!(
        "{}",
        serde_json::to_string(&active_window).map_err(|error| error.to_string())?
    );
    Ok(())
}

#[cfg(not(windows))]
fn active_window_json() -> Result<(), String> {
    Err("active-window is only supported on Windows.".to_string())
}

#[cfg(windows)]
fn focus_window_from_arg() -> Result<(), String> {
    let hwnd = env::args()
        .nth(2)
        .ok_or_else(|| "focus-window requires an hwnd argument.".to_string())?;
    windows_impl::focus_window(&hwnd)
}

#[cfg(not(windows))]
fn focus_window_from_arg() -> Result<(), String> {
    Err("focus-window is only supported on Windows.".to_string())
}

#[cfg(windows)]
fn paste_text_from_stdin() -> Result<(), String> {
    let mut text = String::new();
    io::stdin()
        .read_to_string(&mut text)
        .map_err(|error| error.to_string())?;
    windows_impl::paste_text(&text)
}

#[cfg(not(windows))]
fn paste_text_from_stdin() -> Result<(), String> {
    Err("paste-text is only supported on Windows.".to_string())
}

#[cfg(windows)]
fn type_text_from_stdin() -> Result<(), String> {
    let delay_ms = env::args()
        .nth(2)
        .map(|value| {
            value
                .parse::<u64>()
                .map_err(|error| format!("Invalid delay-ms '{value}': {error}"))
        })
        .transpose()?
        .unwrap_or(0);
    let mut text = String::new();
    io::stdin()
        .read_to_string(&mut text)
        .map_err(|error| error.to_string())?;
    windows_impl::type_text(&text, delay_ms)
}

#[cfg(not(windows))]
fn type_text_from_stdin() -> Result<(), String> {
    Err("type-text is only supported on Windows.".to_string())
}

#[cfg(windows)]
fn message_text_from_stdin() -> Result<(), String> {
    let strategy = env::args()
        .nth(2)
        .unwrap_or_else(|| "focused-control".to_string());
    let mut text = String::new();
    io::stdin()
        .read_to_string(&mut text)
        .map_err(|error| error.to_string())?;
    windows_impl::message_text(&text, &strategy)
}

#[cfg(not(windows))]
fn message_text_from_stdin() -> Result<(), String> {
    Err("message-text is only supported on Windows.".to_string())
}

#[cfg(windows)]
fn set_system_mute_from_arg() -> Result<(), String> {
    let muted = env::args()
        .nth(2)
        .ok_or_else(|| "set-system-mute requires true or false.".to_string())
        .and_then(|value| match value.as_str() {
            "true" => Ok(true),
            "false" => Ok(false),
            _ => Err("set-system-mute requires true or false.".to_string()),
        })?;
    windows_impl::set_system_mute(muted)
}

#[cfg(windows)]
fn send_hotkey_from_arg() -> Result<(), String> {
    let accelerator = env::args()
        .nth(2)
        .ok_or_else(|| "send-hotkey requires an accelerator.".to_string())?;
    windows_impl::send_hotkey(&accelerator)
}

#[cfg(not(windows))]
fn send_hotkey_from_arg() -> Result<(), String> {
    Err("send-hotkey is only supported on Windows.".to_string())
}

#[cfg(windows)]
fn mute_capture_session_from_args() -> Result<(), String> {
    let process_id = env::args()
        .nth(2)
        .ok_or_else(|| "mute-capture-session requires a process id.".to_string())?
        .parse::<u32>()
        .map_err(|error| format!("Invalid process id: {error}"))?;
    let process_name = env::args().nth(3);
    let state = windows_impl::mute_capture_sessions(process_id, process_name.as_deref())?;
    println!(
        "{}",
        serde_json::to_string(&state).map_err(|error| error.to_string())?
    );
    Ok(())
}

#[cfg(not(windows))]
fn mute_capture_session_from_args() -> Result<(), String> {
    Err("mute-capture-session is only supported on Windows.".to_string())
}

#[cfg(windows)]
fn restore_capture_session_from_stdin() -> Result<(), String> {
    let mut json = String::new();
    io::stdin()
        .read_to_string(&mut json)
        .map_err(|error| error.to_string())?;
    let state: windows_impl::CaptureSessionMuteState =
        serde_json::from_str(&json).map_err(|error| error.to_string())?;
    windows_impl::restore_capture_sessions(&state)
}

#[cfg(not(windows))]
fn restore_capture_session_from_stdin() -> Result<(), String> {
    Err("restore-capture-session is only supported on Windows.".to_string())
}

#[cfg(not(windows))]
fn set_system_mute_from_arg() -> Result<(), String> {
    Err("set-system-mute is only supported on Windows.".to_string())
}

#[cfg(windows)]
mod windows_impl {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::SizedSample;
    use image::{ImageBuffer, Rgba};
    use rubato::{FftFixedIn, Resampler};
    use serde::{Deserialize, Serialize};
    use std::collections::{HashSet, VecDeque};
    use std::fs::File;
    use std::io::{self, BufRead, BufReader, BufWriter, Write};
    use std::mem::MaybeUninit;
    use std::path::Path;
    use std::ptr;
    use std::sync::mpsc;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use std::thread;
    use std::time::Duration;
    use vad_rs::Vad;
    use windows::core::{Interface, GUID, PWSTR};
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, MAX_PATH, RECT, WPARAM};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        HBITMAP, HDC, HGDIOBJ, SRCCOPY,
    };
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eCapture, eConsole, eRender, IAudioCaptureClient, IAudioClient, IAudioSessionControl2,
        IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
        AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_EXCLUSIVE, WAVEFORMATEX,
        WAVEFORMATEXTENSIBLE, WAVE_FORMAT_PCM,
    };
    use windows::Win32::Media::KernelStreaming::WAVE_FORMAT_EXTENSIBLE;
    use windows::Win32::Media::Multimedia::WAVE_FORMAT_IEEE_FLOAT;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
        VIRTUAL_KEY, VK_CONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_V,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetGUIThreadInfo, GetSystemMetrics, GetWindowRect,
        GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsIconic, PostMessageW,
        SendMessageTimeoutW, SetForegroundWindow, ShowWindow, GUITHREADINFO, SMTO_ABORTIFHUNG,
        SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SW_RESTORE,
        WM_CHAR,
    };

    const CF_UNICODETEXT_FORMAT: u32 = 13;
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
    pub struct WindowsOcrLine {
        text: String,
        confidence: Option<f32>,
        box_: Option<[i32; 4]>,
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

        Ok(ActiveWindow {
            hwnd: format!("{:#x}", hwnd.0 as usize),
            title: get_window_title(hwnd),
            process_id,
            process_path,
            process_name,
        })
    }

    pub fn paste_text(text: &str) -> Result<(), String> {
        set_clipboard_text(text)?;
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

    pub fn message_text(text: &str, strategy: &str) -> Result<(), String> {
        match strategy {
            "focused-control" => replace_focused_selection(text),
            "character-messages" => post_character_messages(text),
            unknown => Err(format!(
                "message-text strategy must be focused-control or character-messages, got {unknown}."
            )),
        }
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

    pub fn record_wav_until_stdin_stop(
        output_path: &str,
        recording_config: super::NativeRecordingConfig,
    ) -> Result<(), String> {
        if recording_config.capture_mode != super::CaptureMode::Shared {
            match record_wav_wasapi_exclusive(output_path, recording_config.vad.clone()) {
                Ok(()) => return Ok(()),
                Err(error)
                    if recording_config.capture_mode == super::CaptureMode::ExclusiveRequired =>
                {
                    return Err(format!("Exclusive microphone capture failed: {error}"));
                }
                Err(error) => {
                    eprintln!("Exclusive microphone capture failed, falling back to shared capture: {error}");
                }
            }
        }

        record_wav_shared_until_stdin_stop(output_path, recording_config.vad)
    }

    fn record_wav_shared_until_stdin_stop(
        output_path: &str,
        vad_config: super::NativeVadConfig,
    ) -> Result<(), String> {
        let output_path = Path::new(output_path);
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "No input device found.".to_string())?;
        let config = get_preferred_input_config(&device)?;
        let sample_rate = config.sample_rate().0;
        let channels = config.channels() as usize;
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_reader_flag = Arc::clone(&stop_flag);
        let (sample_tx, sample_rx) = mpsc::channel::<Vec<f32>>();

        thread::spawn(move || {
            let mut line = String::new();
            let mut reader = BufReader::new(io::stdin());
            let _ = reader.read_line(&mut line);
            stop_reader_flag.store(true, Ordering::SeqCst);
        });

        let stream = match config.sample_format() {
            cpal::SampleFormat::U8 => {
                build_input_stream::<u8>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::U16 => {
                build_input_stream::<u16>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::U32 => {
                build_input_stream::<u32>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::U64 => {
                build_input_stream::<u64>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::I8 => {
                build_input_stream::<i8>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::I16 => {
                build_input_stream::<i16>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::I32 => {
                build_input_stream::<i32>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::I64 => {
                build_input_stream::<i64>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::F32 => {
                build_input_stream::<f32>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::F64 => {
                build_input_stream::<f64>(&device, &config, channels, sample_tx)?
            }
            sample_format => return Err(format!("Unsupported sample format: {sample_format:?}")),
        };

        stream.play().map_err(|error| error.to_string())?;

        let mut resampler = FrameResampler::new(sample_rate as usize, VOXTYPE_SAMPLE_RATE);
        let mut frame_emitter = FrameEmitter::new(VAD_FRAME_SAMPLES);
        let mut vad = if vad_config.enabled {
            Some(SmoothedVad::new(
                Box::new(SileroVad::new(
                    vad_config
                        .model_path
                        .as_deref()
                        .ok_or_else(|| "VAD model path is missing.".to_string())?,
                    vad_config.threshold,
                )?),
                vad_config.prefill_frames,
                vad_config.hangover_frames,
                vad_config.onset_frames,
            ))
        } else {
            None
        };
        let mut samples = Vec::<f32>::new();
        let mut raw_samples = 0usize;
        let mut speech_frames = 0usize;
        let mut level_meter = LevelMeter::new();

        while !stop_flag.load(Ordering::SeqCst) {
            match sample_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(chunk) => {
                    process_audio_chunk(
                        &chunk,
                        &mut resampler,
                        &mut frame_emitter,
                        vad.as_mut(),
                        &mut samples,
                        &mut raw_samples,
                        &mut speech_frames,
                        &mut level_meter,
                    );
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        drop(stream);

        while let Ok(chunk) = sample_rx.try_recv() {
            process_audio_chunk(
                &chunk,
                &mut resampler,
                &mut frame_emitter,
                vad.as_mut(),
                &mut samples,
                &mut raw_samples,
                &mut speech_frames,
                &mut level_meter,
            );
        }

        resampler.finish(&mut |resampled| {
            raw_samples += resampled.len();
            frame_emitter.push(resampled, &mut |frame| {
                process_vad_frame(frame, vad.as_mut(), &mut samples, &mut speech_frames);
            });
        });
        frame_emitter.finish(&mut |frame| {
            process_vad_frame(frame, vad.as_mut(), &mut samples, &mut speech_frames);
        });
        write_wav(output_path, &samples)?;
        println!(
            "{}",
            serde_json::to_string(&RecordingResponse {
                path: output_path.to_string_lossy().to_string(),
                sample_rate: VOXTYPE_SAMPLE_RATE as u32,
                samples: samples.len(),
                raw_samples,
                vad_enabled: vad_config.enabled,
                capture_mode: "sharedCapture".to_string(),
                speech_frames,
            })
            .map_err(|error| error.to_string())?
        );
        Ok(())
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RecordingResponse {
        path: String,
        sample_rate: u32,
        samples: usize,
        raw_samples: usize,
        vad_enabled: bool,
        capture_mode: String,
        speech_frames: usize,
    }

    fn record_wav_wasapi_exclusive(
        output_path: &str,
        vad_config: super::NativeVadConfig,
    ) -> Result<(), String> {
        let output_path = Path::new(output_path);
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_reader_flag = Arc::clone(&stop_flag);

        thread::spawn(move || {
            let mut line = String::new();
            let mut reader = BufReader::new(io::stdin());
            let _ = reader.read_line(&mut line);
            stop_reader_flag.store(true, Ordering::SeqCst);
        });

        let format_ptr: *mut WAVEFORMATEX;
        let mut samples = Vec::<f32>::new();
        let mut raw_samples = 0usize;
        let mut speech_frames = 0usize;
        let mut level_meter = LevelMeter::new();

        unsafe {
            let _com = ComGuard::new()?;
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|error| error.to_string())?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eCapture, eConsole)
                .map_err(|error| error.to_string())?;
            let audio_client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|error| error.to_string())?;

            format_ptr = audio_client
                .GetMixFormat()
                .map_err(|error| error.to_string())?;
            let selected_format = select_exclusive_capture_format(&audio_client, format_ptr)?;
            let format = selected_format.input;

            let mut default_period = 0i64;
            audio_client
                .GetDevicePeriod(Some(&mut default_period), None)
                .map_err(|error| error.to_string())?;
            let buffer_duration = if default_period > 0 {
                default_period
            } else {
                100_000
            };

            audio_client
                .Initialize(
                    AUDCLNT_SHAREMODE_EXCLUSIVE,
                    0,
                    buffer_duration,
                    buffer_duration,
                    selected_format.ptr,
                    None,
                )
                .map_err(|error| error.to_string())?;

            let capture_client: IAudioCaptureClient = audio_client
                .GetService()
                .map_err(|error| error.to_string())?;
            let mut resampler = FrameResampler::new(format.sample_rate, VOXTYPE_SAMPLE_RATE);
            let mut frame_emitter = FrameEmitter::new(VAD_FRAME_SAMPLES);
            let mut vad = if vad_config.enabled {
                Some(SmoothedVad::new(
                    Box::new(SileroVad::new(
                        vad_config
                            .model_path
                            .as_deref()
                            .ok_or_else(|| "VAD model path is missing.".to_string())?,
                        vad_config.threshold,
                    )?),
                    vad_config.prefill_frames,
                    vad_config.hangover_frames,
                    vad_config.onset_frames,
                ))
            } else {
                None
            };

            audio_client.Start().map_err(|error| error.to_string())?;

            while !stop_flag.load(Ordering::SeqCst) {
                drain_wasapi_capture(
                    &capture_client,
                    &format,
                    &mut resampler,
                    &mut frame_emitter,
                    vad.as_mut(),
                    &mut samples,
                    &mut raw_samples,
                    &mut speech_frames,
                    &mut level_meter,
                )?;
                thread::sleep(Duration::from_millis(10));
            }

            drain_wasapi_capture(
                &capture_client,
                &format,
                &mut resampler,
                &mut frame_emitter,
                vad.as_mut(),
                &mut samples,
                &mut raw_samples,
                &mut speech_frames,
                &mut level_meter,
            )?;
            audio_client.Stop().map_err(|error| error.to_string())?;

            resampler.finish(&mut |resampled| {
                raw_samples += resampled.len();
                frame_emitter.push(resampled, &mut |frame| {
                    process_vad_frame(frame, vad.as_mut(), &mut samples, &mut speech_frames);
                });
            });
            frame_emitter.finish(&mut |frame| {
                process_vad_frame(frame, vad.as_mut(), &mut samples, &mut speech_frames);
            });
        }

        if !format_ptr.is_null() {
            unsafe {
                CoTaskMemFree(Some(format_ptr.cast()));
            }
        }

        write_wav(output_path, &samples)?;
        println!(
            "{}",
            serde_json::to_string(&RecordingResponse {
                path: output_path.to_string_lossy().to_string(),
                sample_rate: VOXTYPE_SAMPLE_RATE as u32,
                samples: samples.len(),
                raw_samples,
                vad_enabled: vad_config.enabled,
                capture_mode: "exclusiveCapture".to_string(),
                speech_frames,
            })
            .map_err(|error| error.to_string())?
        );
        Ok(())
    }

    fn drain_wasapi_capture(
        capture_client: &IAudioCaptureClient,
        format: &WasapiInputFormat,
        resampler: &mut FrameResampler,
        frame_emitter: &mut FrameEmitter,
        mut vad: Option<&mut SmoothedVad>,
        samples: &mut Vec<f32>,
        raw_samples: &mut usize,
        speech_frames: &mut usize,
        level_meter: &mut LevelMeter,
    ) -> Result<(), String> {
        unsafe {
            let mut packet_size = capture_client
                .GetNextPacketSize()
                .map_err(|error| error.to_string())?;

            while packet_size > 0 {
                let mut data = std::ptr::null_mut::<u8>();
                let mut frames = 0u32;
                let mut flags = 0u32;

                capture_client
                    .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                    .map_err(|error| error.to_string())?;

                let chunk = convert_wasapi_buffer_to_mono(data, frames, flags, format)?;
                process_audio_chunk(
                    &chunk,
                    resampler,
                    frame_emitter,
                    vad.as_deref_mut(),
                    samples,
                    raw_samples,
                    speech_frames,
                    level_meter,
                );

                capture_client
                    .ReleaseBuffer(frames)
                    .map_err(|error| error.to_string())?;
                packet_size = capture_client
                    .GetNextPacketSize()
                    .map_err(|error| error.to_string())?;
            }
        }

        Ok(())
    }

    #[derive(Clone, Copy)]
    struct WasapiInputFormat {
        sample_rate: usize,
        channels: usize,
        bits_per_sample: u16,
        block_align: usize,
        sample_kind: WasapiSampleKind,
    }

    #[derive(Clone, Copy)]
    enum WasapiSampleKind {
        Float,
        Pcm,
    }

    pub fn capture_screenshot(
        output_path: &str,
        active_window_only: bool,
        hwnd: Option<&str>,
    ) -> Result<(), String> {
        let rect = screenshot_rect(active_window_only, hwnd)?;
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;

        if width <= 0 || height <= 0 {
            return Err("Screenshot target has no visible area.".to_string());
        }

        let screen_dc = unsafe { GetDC(None) };
        if screen_dc.0.is_null() {
            return Err("Could not get the screen device context.".to_string());
        }

        let result = capture_rect_to_png(screen_dc, rect, output_path);
        unsafe {
            ReleaseDC(None, screen_dc);
        }
        result
    }

    pub fn recognize_image_text(input_path: &str) -> Result<WindowsOcrResult, String> {
        let started = std::time::Instant::now();
        let path = std::fs::canonicalize(input_path)
            .map_err(|error| format!("Could not resolve OCR image path: {error}"))?;
        let path_string = path.to_string_lossy().to_string();
        let image = load_ocr_image(&path_string)?;
        let engine = OcrEngine::TryCreateFromUserProfileLanguages()
            .map_err(|error| format!("Could not create Windows OCR engine: {error}"))?;
        let mut lines = Vec::new();
        let mut text_lines = Vec::new();
        let mut seen_lines = HashSet::new();
        let max_dimension = OcrEngine::MaxImageDimension()
            .map_err(|error| format!("Could not read Windows OCR max image dimension: {error}"))?;

        for tile in ocr_tiles(image.width, image.height, max_dimension) {
            let bitmap = software_bitmap_for_tile(&image, tile)?;
            let tile_lines = recognize_software_bitmap_lines(&engine, &bitmap)?;

            for text in tile_lines {
                let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");

                if normalized.is_empty() || !seen_lines.insert(normalized.to_lowercase()) {
                    continue;
                }

                text_lines.push(normalized.clone());
                lines.push(WindowsOcrLine {
                    text: normalized,
                    confidence: None,
                    box_: None,
                });
            }
        }

        Ok(WindowsOcrResult {
            provider: "windowsMediaOcr".to_string(),
            engine: ocr_engine_label(&engine),
            image_path: path_string,
            text: text_lines.join("\n"),
            lines,
            duration_ms: started.elapsed().as_millis(),
        })
    }

    fn recognize_software_bitmap_lines(
        engine: &OcrEngine,
        bitmap: &SoftwareBitmap,
    ) -> Result<Vec<String>, String> {
        let result = engine
            .RecognizeAsync(bitmap)
            .map_err(|error| format!("Could not start Windows OCR: {error}"))?
            .join()
            .map_err(|error| format!("Windows OCR failed: {error}"))?;
        let ocr_lines = result
            .Lines()
            .map_err(|error| format!("Could not read Windows OCR lines: {error}"))?;
        let mut lines = Vec::new();

        for index in 0..ocr_lines
            .Size()
            .map_err(|error| format!("Could not count Windows OCR lines: {error}"))?
        {
            let line = ocr_lines
                .GetAt(index)
                .map_err(|error| format!("Could not read Windows OCR line: {error}"))?;
            let text = line
                .Text()
                .map_err(|error| format!("Could not read Windows OCR line text: {error}"))?
                .to_string_lossy();

            if text.trim().is_empty() {
                continue;
            }

            lines.push(text);
        }

        Ok(lines)
    }

    fn load_ocr_image(path: &str) -> Result<OcrImage, String> {
        let image = image::open(path)
            .map_err(|error| format!("Could not decode OCR image: {error}"))?
            .to_rgba8();
        let (width, height) = image.dimensions();
        let mut bgra = image.into_raw();

        for pixel in bgra.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }

        Ok(OcrImage {
            width,
            height,
            bgra,
        })
    }

    fn software_bitmap_for_tile(
        image: &OcrImage,
        tile: (u32, u32, u32, u32),
    ) -> Result<SoftwareBitmap, String> {
        let (x, y, width, height) = tile;
        let mut bgra = vec![0_u8; width as usize * height as usize * 4];
        let source_stride = image.width as usize * 4;
        let tile_stride = width as usize * 4;

        for row in 0..height as usize {
            let source_start = (y as usize + row) * source_stride + x as usize * 4;
            let source_end = source_start + tile_stride;
            let target_start = row * tile_stride;
            bgra[target_start..target_start + tile_stride]
                .copy_from_slice(&image.bgra[source_start..source_end]);
        }

        software_bitmap_from_bgra(width, height, &bgra)
    }

    fn software_bitmap_from_bgra(
        width: u32,
        height: u32,
        bgra: &[u8],
    ) -> Result<SoftwareBitmap, String> {
        let writer = DataWriter::new()
            .map_err(|error| format!("Could not create OCR image buffer writer: {error}"))?;
        writer
            .WriteBytes(bgra)
            .map_err(|error| format!("Could not write OCR image pixels: {error}"))?;
        let buffer = writer
            .DetachBuffer()
            .map_err(|error| format!("Could not detach OCR image buffer: {error}"))?;

        SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
            &buffer,
            BitmapPixelFormat::Bgra8,
            width as i32,
            height as i32,
            BitmapAlphaMode::Premultiplied,
        )
        .map_err(|error| format!("Could not create OCR software bitmap: {error}"))
    }

    fn ocr_tiles(width: u32, height: u32, max_dimension: u32) -> Vec<(u32, u32, u32, u32)> {
        let tile_size = max_dimension.max(1);

        if width <= tile_size && height <= tile_size {
            return vec![(0, 0, width, height)];
        }

        let overlap = OCR_TILE_OVERLAP.min(tile_size.saturating_sub(1));
        let step = tile_size.saturating_sub(overlap).max(1);
        let mut tiles = Vec::new();
        let mut y = 0;

        loop {
            let mut x = 0;
            let tile_height = tile_size.min(height - y);

            loop {
                let tile_width = tile_size.min(width - x);
                tiles.push((x, y, tile_width, tile_height));

                if x + tile_width >= width {
                    break;
                }

                x = (x + step).min(width - 1);
            }

            if y + tile_height >= height {
                break;
            }

            y = (y + step).min(height - 1);
        }

        tiles
    }

    fn ocr_engine_label(engine: &OcrEngine) -> String {
        engine
            .RecognizerLanguage()
            .ok()
            .and_then(|language: Language| language.LanguageTag().ok())
            .map(|tag| format!("Windows.Media.Ocr {tag}"))
            .unwrap_or_else(|| "Windows.Media.Ocr".to_string())
    }

    fn screenshot_rect(active_window_only: bool, hwnd: Option<&str>) -> Result<RECT, String> {
        if let Some(hwnd) = hwnd {
            return window_rect(parse_hwnd(hwnd)?, "target window");
        }

        if active_window_only {
            let hwnd = unsafe { GetForegroundWindow() };

            if hwnd.0.is_null() {
                return Err("No foreground window is currently available.".to_string());
            }

            return window_rect(hwnd, "foreground window");
        }

        Ok(RECT {
            left: unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) },
            top: unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) },
            right: unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) }
                + unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) },
            bottom: unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) }
                + unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) },
        })
    }

    fn window_rect(hwnd: HWND, label: &str) -> Result<RECT, String> {
        let mut rect = RECT::default();
        let dwm_result = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut rect as *mut RECT as *mut _,
                std::mem::size_of::<RECT>() as u32,
            )
        };

        if dwm_result.is_err() || rect.right <= rect.left || rect.bottom <= rect.top {
            unsafe { GetWindowRect(hwnd, &mut rect) }
                .map_err(|error| format!("Could not get {label} bounds: {error}"))?;
        }

        Ok(rect)
    }

    fn capture_rect_to_png(screen_dc: HDC, rect: RECT, output_path: &str) -> Result<(), String> {
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        let memory_dc = unsafe { CreateCompatibleDC(Some(screen_dc)) };

        if memory_dc.0.is_null() {
            return Err("Could not create a compatible screenshot device context.".to_string());
        }

        let bitmap = unsafe { CreateCompatibleBitmap(screen_dc, width, height) };
        if bitmap.0.is_null() {
            unsafe {
                let _ = DeleteDC(memory_dc);
            }
            return Err("Could not create a compatible screenshot bitmap.".to_string());
        }

        let result = copy_bitmap_to_png(screen_dc, memory_dc, bitmap, rect, output_path);

        unsafe {
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            let _ = DeleteDC(memory_dc);
        }

        result
    }

    fn copy_bitmap_to_png(
        screen_dc: HDC,
        memory_dc: HDC,
        bitmap: HBITMAP,
        rect: RECT,
        output_path: &str,
    ) -> Result<(), String> {
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        let old_object = unsafe { SelectObject(memory_dc, HGDIOBJ(bitmap.0)) };

        if old_object.0.is_null() {
            return Err("Could not select the screenshot bitmap.".to_string());
        }

        unsafe {
            BitBlt(
                memory_dc,
                0,
                0,
                width,
                height,
                Some(screen_dc),
                rect.left,
                rect.top,
                SRCCOPY,
            )
        }
        .map_err(|error| {
            format!("Could not copy the screen into the screenshot bitmap: {error}")
        })?;

        let mut bitmap_info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0_u8; width as usize * height as usize * 4];
        let scan_lines = unsafe {
            GetDIBits(
                memory_dc,
                bitmap,
                0,
                height as u32,
                Some(pixels.as_mut_ptr().cast()),
                &mut bitmap_info,
                DIB_RGB_COLORS,
            )
        };

        unsafe {
            SelectObject(memory_dc, old_object);
        }

        if scan_lines == 0 {
            return Err("Could not read screenshot bitmap pixels.".to_string());
        }

        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            pixel[3] = 255;
        }

        let image = ImageBuffer::<Rgba<u8>, _>::from_raw(width as u32, height as u32, pixels)
            .ok_or_else(|| "Could not build screenshot image buffer.".to_string())?;
        image
            .save(output_path)
            .map_err(|error| format!("Could not save screenshot PNG: {error}"))
    }

    struct SelectedWasapiFormat {
        ptr: *const WAVEFORMATEX,
        input: WasapiInputFormat,
        _owned: Option<Box<WAVEFORMATEX>>,
    }

    fn select_exclusive_capture_format(
        audio_client: &IAudioClient,
        mix_format: *const WAVEFORMATEX,
    ) -> Result<SelectedWasapiFormat, String> {
        unsafe {
            if audio_client
                .IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, mix_format, None)
                .is_ok()
            {
                return Ok(SelectedWasapiFormat {
                    ptr: mix_format,
                    input: WasapiInputFormat::from_wave_format(mix_format)?,
                    _owned: None,
                });
            }
        }

        let mix = unsafe { WasapiInputFormat::from_wave_format(mix_format)? };
        let mut candidates = exclusive_capture_format_candidates(mix.sample_rate, mix.channels);
        let mut failures = Vec::new();

        for candidate in candidates.drain(..) {
            let candidate_ptr = candidate.as_ref() as *const WAVEFORMATEX;
            let description = describe_wave_format(candidate.as_ref());
            let support = unsafe {
                audio_client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, candidate_ptr, None)
            };

            if support.is_ok() {
                return Ok(SelectedWasapiFormat {
                    ptr: candidate_ptr,
                    input: unsafe { WasapiInputFormat::from_wave_format(candidate_ptr)? },
                    _owned: Some(candidate),
                });
            }

            failures.push(format!("{description}: {support:?}"));
        }

        Err(format!(
            "No supported exclusive microphone format was found. Tried {}",
            failures.join("; ")
        ))
    }

    fn exclusive_capture_format_candidates(
        mix_sample_rate: usize,
        mix_channels: usize,
    ) -> Vec<Box<WAVEFORMATEX>> {
        let mut sample_rates = vec![mix_sample_rate as u32, 48_000, 44_100, 16_000];
        sample_rates.sort_unstable();
        sample_rates.dedup();
        sample_rates.reverse();

        let mut channels = vec![mix_channels.clamp(1, 2) as u16, 1, 2];
        channels.sort_unstable();
        channels.dedup();

        let mut candidates = Vec::new();

        for sample_rate in sample_rates {
            for channel_count in &channels {
                candidates.push(Box::new(wave_format_pcm(sample_rate, *channel_count, 16)));
                candidates.push(Box::new(wave_format_float(sample_rate, *channel_count)));
                candidates.push(Box::new(wave_format_pcm(sample_rate, *channel_count, 24)));
            }
        }

        candidates
    }

    fn wave_format_pcm(sample_rate: u32, channels: u16, bits_per_sample: u16) -> WAVEFORMATEX {
        let block_align = channels * (bits_per_sample / 8);

        WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_PCM as u16,
            nChannels: channels,
            nSamplesPerSec: sample_rate,
            nAvgBytesPerSec: sample_rate * u32::from(block_align),
            nBlockAlign: block_align,
            wBitsPerSample: bits_per_sample,
            cbSize: 0,
        }
    }

    fn wave_format_float(sample_rate: u32, channels: u16) -> WAVEFORMATEX {
        let bits_per_sample = 32;
        let block_align = channels * (bits_per_sample / 8);

        WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_IEEE_FLOAT as u16,
            nChannels: channels,
            nSamplesPerSec: sample_rate,
            nAvgBytesPerSec: sample_rate * u32::from(block_align),
            nBlockAlign: block_align,
            wBitsPerSample: bits_per_sample,
            cbSize: 0,
        }
    }

    fn describe_wave_format(format: &WAVEFORMATEX) -> String {
        let kind = match format.wFormatTag as u32 {
            WAVE_FORMAT_PCM => "pcm",
            WAVE_FORMAT_IEEE_FLOAT => "float",
            WAVE_FORMAT_EXTENSIBLE => "extensible",
            _ => "unknown",
        };
        let sample_rate = format.nSamplesPerSec;
        let channels = format.nChannels;
        let bits_per_sample = format.wBitsPerSample;

        format!(
            "{}Hz {}ch {}bit {}",
            sample_rate, channels, bits_per_sample, kind
        )
    }

    impl WasapiInputFormat {
        unsafe fn from_wave_format(format: *const WAVEFORMATEX) -> Result<Self, String> {
            if format.is_null() {
                return Err("WASAPI returned a null mix format.".to_string());
            }

            let wave = &*format;
            let mut sample_kind = match wave.wFormatTag as u32 {
                WAVE_FORMAT_PCM => WasapiSampleKind::Pcm,
                WAVE_FORMAT_IEEE_FLOAT => WasapiSampleKind::Float,
                WAVE_FORMAT_EXTENSIBLE => {
                    let extensible = format.cast::<WAVEFORMATEXTENSIBLE>();
                    let sub_format = ptr::addr_of!((*extensible).SubFormat).read_unaligned();

                    if sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {
                        WasapiSampleKind::Float
                    } else if sub_format == KSDATAFORMAT_SUBTYPE_PCM {
                        WasapiSampleKind::Pcm
                    } else {
                        return Err("Unsupported WASAPI extensible sample subtype.".to_string());
                    }
                }
                tag => return Err(format!("Unsupported WASAPI sample format tag: {tag}")),
            };

            if wave.wBitsPerSample == 32 && matches!(sample_kind, WasapiSampleKind::Pcm) {
                sample_kind = WasapiSampleKind::Pcm;
            }

            Ok(Self {
                sample_rate: wave.nSamplesPerSec as usize,
                channels: wave.nChannels as usize,
                bits_per_sample: wave.wBitsPerSample,
                block_align: wave.nBlockAlign as usize,
                sample_kind,
            })
        }
    }

    const KSDATAFORMAT_SUBTYPE_PCM: GUID = GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
    const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID =
        GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

    fn convert_wasapi_buffer_to_mono(
        data: *const u8,
        frames: u32,
        flags: u32,
        format: &WasapiInputFormat,
    ) -> Result<Vec<f32>, String> {
        if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
            return Ok(vec![0.0; frames as usize]);
        }

        if data.is_null() {
            return Err("WASAPI returned a null capture buffer.".to_string());
        }

        let bytes_per_sample = usize::from(format.bits_per_sample / 8);

        if bytes_per_sample == 0 || format.channels == 0 || format.block_align == 0 {
            return Err("WASAPI returned an invalid capture format.".to_string());
        }

        let mut output = Vec::with_capacity(frames as usize);

        for frame in 0..frames as usize {
            let frame_offset = frame * format.block_align;
            let mut mono = 0.0f32;

            for channel in 0..format.channels {
                let sample_offset = frame_offset + channel * bytes_per_sample;
                let sample_ptr = unsafe { data.add(sample_offset) };
                mono += read_wasapi_sample(sample_ptr, format.sample_kind, format.bits_per_sample)?;
            }

            output.push(mono / format.channels as f32);
        }

        Ok(output)
    }

    fn read_wasapi_sample(
        sample_ptr: *const u8,
        sample_kind: WasapiSampleKind,
        bits_per_sample: u16,
    ) -> Result<f32, String> {
        match (sample_kind, bits_per_sample) {
            (WasapiSampleKind::Float, 32) => {
                let bytes = unsafe { std::slice::from_raw_parts(sample_ptr, 4) };
                Ok(f32::from_le_bytes(bytes.try_into().unwrap()).clamp(-1.0, 1.0))
            }
            (WasapiSampleKind::Pcm, 8) => {
                let value = unsafe { *sample_ptr } as f32;
                Ok((value - 128.0) / 128.0)
            }
            (WasapiSampleKind::Pcm, 16) => {
                let bytes = unsafe { std::slice::from_raw_parts(sample_ptr, 2) };
                Ok(i16::from_le_bytes(bytes.try_into().unwrap()) as f32 / 32768.0)
            }
            (WasapiSampleKind::Pcm, 24) => {
                let bytes = unsafe { std::slice::from_raw_parts(sample_ptr, 3) };
                let raw = ((bytes[2] as i32) << 24)
                    | ((bytes[1] as i32) << 16)
                    | ((bytes[0] as i32) << 8);
                Ok((raw >> 8) as f32 / 8_388_608.0)
            }
            (WasapiSampleKind::Pcm, 32) => {
                let bytes = unsafe { std::slice::from_raw_parts(sample_ptr, 4) };
                Ok(i32::from_le_bytes(bytes.try_into().unwrap()) as f32 / 2_147_483_648.0)
            }
            _ => Err(format!(
                "Unsupported WASAPI sample width: {bits_per_sample} bits"
            )),
        }
    }

    fn process_audio_chunk(
        chunk: &[f32],
        resampler: &mut FrameResampler,
        frame_emitter: &mut FrameEmitter,
        mut vad: Option<&mut SmoothedVad>,
        samples: &mut Vec<f32>,
        raw_samples: &mut usize,
        speech_frames: &mut usize,
        level_meter: &mut LevelMeter,
    ) {
        level_meter.push(chunk);
        resampler.push(chunk, &mut |resampled| {
            *raw_samples += resampled.len();
            frame_emitter.push(resampled, &mut |frame| {
                process_vad_frame(frame, vad.as_deref_mut(), samples, speech_frames);
            });
        });
    }

    struct LevelMeter {
        last_emit: std::time::Instant,
    }

    impl LevelMeter {
        fn new() -> Self {
            Self {
                last_emit: std::time::Instant::now() - Duration::from_millis(100),
            }
        }

        fn push(&mut self, chunk: &[f32]) {
            if chunk.is_empty() || self.last_emit.elapsed() < Duration::from_millis(80) {
                return;
            }

            self.last_emit = std::time::Instant::now();
            let rms = (chunk.iter().map(|sample| sample * sample).sum::<f32>()
                / chunk.len() as f32)
                .sqrt()
                .clamp(0.0, 1.0);
            let peak = chunk
                .iter()
                .map(|sample| sample.abs())
                .fold(0.0_f32, f32::max)
                .clamp(0.0, 1.0);

            if let Ok(payload) = serde_json::to_string(&RecordingLevelResponse {
                type_: "recordingLevel",
                rms,
                peak,
            }) {
                println!("{payload}");
                let _ = io::stdout().flush();
            }
        }
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RecordingLevelResponse {
        #[serde(rename = "type")]
        type_: &'static str,
        rms: f32,
        peak: f32,
    }

    fn process_vad_frame(
        frame: &[f32],
        vad: Option<&mut SmoothedVad>,
        samples: &mut Vec<f32>,
        speech_frames: &mut usize,
    ) {
        if let Some(vad) = vad {
            if let Ok(Some(speech)) = vad.push_frame(frame) {
                *speech_frames += speech.len() / VAD_FRAME_SAMPLES;
                samples.extend_from_slice(&speech);
            }
        } else {
            samples.extend_from_slice(frame);
        }
    }

    fn get_preferred_input_config(
        device: &cpal::Device,
    ) -> Result<cpal::SupportedStreamConfig, String> {
        let default_config = device
            .default_input_config()
            .map_err(|error| error.to_string())?;
        let target_rate = default_config.sample_rate();
        let mut best_config: Option<cpal::SupportedStreamConfigRange> = None;

        if let Ok(configs) = device.supported_input_configs() {
            for config in configs {
                if config.min_sample_rate() <= target_rate
                    && config.max_sample_rate() >= target_rate
                {
                    match &best_config {
                        None => best_config = Some(config),
                        Some(current) => {
                            if sample_format_score(config.sample_format())
                                > sample_format_score(current.sample_format())
                            {
                                best_config = Some(config);
                            }
                        }
                    }
                }
            }
        }

        Ok(best_config
            .map(|config| config.with_sample_rate(target_rate))
            .unwrap_or(default_config))
    }

    fn sample_format_score(format: cpal::SampleFormat) -> u8 {
        match format {
            cpal::SampleFormat::F32 => 4,
            cpal::SampleFormat::I16 => 3,
            cpal::SampleFormat::I32 => 2,
            _ => 1,
        }
    }

    fn build_input_stream<T>(
        device: &cpal::Device,
        config: &cpal::SupportedStreamConfig,
        channels: usize,
        sample_tx: mpsc::Sender<Vec<f32>>,
    ) -> Result<cpal::Stream, String>
    where
        T: PcmSample + SizedSample + Send + 'static,
    {
        device
            .build_input_stream(
                &config.clone().into(),
                move |data: &[T], _| {
                    let mut output = Vec::with_capacity(data.len() / channels.max(1));

                    if channels == 1 {
                        output.extend(data.iter().map(PcmSample::to_f32));
                    } else {
                        for frame in data.chunks_exact(channels) {
                            output.push(
                                frame.iter().map(PcmSample::to_f32).sum::<f32>() / channels as f32,
                            );
                        }
                    }

                    let _ = sample_tx.send(output);
                },
                move |error| eprintln!("Audio stream error: {error}"),
                None,
            )
            .map_err(|error| error.to_string())
    }

    trait PcmSample {
        fn to_f32(&self) -> f32;
    }

    impl PcmSample for u8 {
        fn to_f32(&self) -> f32 {
            (*self as f32 - 128.0) / 128.0
        }
    }

    impl PcmSample for u16 {
        fn to_f32(&self) -> f32 {
            (*self as f32 - 32768.0) / 32768.0
        }
    }

    impl PcmSample for u32 {
        fn to_f32(&self) -> f32 {
            (*self as f32 - 2_147_483_648.0) / 2_147_483_648.0
        }
    }

    impl PcmSample for u64 {
        fn to_f32(&self) -> f32 {
            (*self as f64 - 9_223_372_036_854_775_808.0) as f32 / 9_223_372_036_854_775_808.0_f32
        }
    }

    impl PcmSample for i8 {
        fn to_f32(&self) -> f32 {
            *self as f32 / 128.0
        }
    }

    impl PcmSample for i16 {
        fn to_f32(&self) -> f32 {
            *self as f32 / 32768.0
        }
    }

    impl PcmSample for i32 {
        fn to_f32(&self) -> f32 {
            *self as f32 / 2_147_483_648.0
        }
    }

    impl PcmSample for i64 {
        fn to_f32(&self) -> f32 {
            (*self as f64 / 9_223_372_036_854_775_808.0) as f32
        }
    }

    impl PcmSample for f32 {
        fn to_f32(&self) -> f32 {
            *self
        }
    }

    impl PcmSample for f64 {
        fn to_f32(&self) -> f32 {
            *self as f32
        }
    }

    struct FrameResampler {
        resampler: Option<FftFixedIn<f32>>,
        chunk_in: usize,
        in_buf: Vec<f32>,
    }

    impl FrameResampler {
        fn new(input_rate: usize, output_rate: usize) -> Self {
            let resampler = (input_rate != output_rate).then(|| {
                FftFixedIn::<f32>::new(input_rate, output_rate, RESAMPLER_CHUNK_SIZE, 1, 1)
                    .expect("create resampler")
            });

            Self {
                resampler,
                chunk_in: RESAMPLER_CHUNK_SIZE,
                in_buf: Vec::with_capacity(RESAMPLER_CHUNK_SIZE),
            }
        }

        fn push(&mut self, mut input: &[f32], emit: &mut impl FnMut(&[f32])) {
            if self.resampler.is_none() {
                emit(input);
                return;
            }

            while !input.is_empty() {
                let available = self.chunk_in - self.in_buf.len();
                let count = available.min(input.len());
                self.in_buf.extend_from_slice(&input[..count]);
                input = &input[count..];

                if self.in_buf.len() == self.chunk_in {
                    if let Ok(output) = self
                        .resampler
                        .as_mut()
                        .unwrap()
                        .process(&[&self.in_buf], None)
                    {
                        emit(&output[0]);
                    }
                    self.in_buf.clear();
                }
            }
        }

        fn finish(&mut self, emit: &mut impl FnMut(&[f32])) {
            if let Some(resampler) = self.resampler.as_mut() {
                if !self.in_buf.is_empty() {
                    self.in_buf.resize(self.chunk_in, 0.0);
                    if let Ok(output) = resampler.process(&[&self.in_buf], None) {
                        emit(&output[0]);
                    }
                    self.in_buf.clear();
                }
            }
        }
    }

    struct FrameEmitter {
        frame_samples: usize,
        pending: Vec<f32>,
    }

    impl FrameEmitter {
        fn new(frame_samples: usize) -> Self {
            Self {
                frame_samples,
                pending: Vec::with_capacity(frame_samples),
            }
        }

        fn push(&mut self, mut input: &[f32], emit: &mut impl FnMut(&[f32])) {
            while !input.is_empty() {
                let available = self.frame_samples - self.pending.len();
                let count = available.min(input.len());
                self.pending.extend_from_slice(&input[..count]);
                input = &input[count..];

                if self.pending.len() == self.frame_samples {
                    emit(&self.pending);
                    self.pending.clear();
                }
            }
        }

        fn finish(&mut self, emit: &mut impl FnMut(&[f32])) {
            if !self.pending.is_empty() {
                self.pending.resize(self.frame_samples, 0.0);
                emit(&self.pending);
                self.pending.clear();
            }
        }
    }

    trait VoiceActivityDetector {
        fn is_voice(&mut self, frame: &[f32]) -> Result<bool, String>;
    }

    struct SileroVad {
        engine: Vad,
        threshold: f32,
    }

    impl SileroVad {
        fn new(model_path: &str, threshold: f32) -> Result<Self, String> {
            if !(0.0..=1.0).contains(&threshold) {
                return Err("VAD threshold must be between 0.0 and 1.0.".to_string());
            }

            Ok(Self {
                engine: Vad::new(model_path, VOXTYPE_SAMPLE_RATE)
                    .map_err(|error| format!("Failed to create Silero VAD: {error}"))?,
                threshold,
            })
        }
    }

    impl VoiceActivityDetector for SileroVad {
        fn is_voice(&mut self, frame: &[f32]) -> Result<bool, String> {
            if frame.len() != VAD_FRAME_SAMPLES {
                return Err(format!(
                    "Expected {VAD_FRAME_SAMPLES} VAD samples, got {}.",
                    frame.len()
                ));
            }

            let result = self
                .engine
                .compute(frame)
                .map_err(|error| format!("Silero VAD error: {error}"))?;

            Ok(result.prob > self.threshold)
        }
    }

    struct SmoothedVad {
        inner_vad: Box<dyn VoiceActivityDetector>,
        prefill_frames: usize,
        hangover_frames: usize,
        onset_frames: usize,
        frame_buffer: VecDeque<Vec<f32>>,
        hangover_counter: usize,
        onset_counter: usize,
        in_speech: bool,
        temp_out: Vec<f32>,
    }

    impl SmoothedVad {
        fn new(
            inner_vad: Box<dyn VoiceActivityDetector>,
            prefill_frames: usize,
            hangover_frames: usize,
            onset_frames: usize,
        ) -> Self {
            Self {
                inner_vad,
                prefill_frames,
                hangover_frames,
                onset_frames,
                frame_buffer: VecDeque::new(),
                hangover_counter: 0,
                onset_counter: 0,
                in_speech: false,
                temp_out: Vec::new(),
            }
        }

        fn push_frame(&mut self, frame: &[f32]) -> Result<Option<Vec<f32>>, String> {
            self.frame_buffer.push_back(frame.to_vec());
            while self.frame_buffer.len() > self.prefill_frames + 1 {
                self.frame_buffer.pop_front();
            }

            let is_voice = self.inner_vad.is_voice(frame)?;

            match (self.in_speech, is_voice) {
                (false, true) => {
                    self.onset_counter += 1;
                    if self.onset_counter >= self.onset_frames {
                        self.in_speech = true;
                        self.hangover_counter = self.hangover_frames;
                        self.onset_counter = 0;
                        self.temp_out.clear();
                        for buffered in &self.frame_buffer {
                            self.temp_out.extend_from_slice(buffered);
                        }
                        Ok(Some(self.temp_out.clone()))
                    } else {
                        Ok(None)
                    }
                }
                (true, true) => {
                    self.hangover_counter = self.hangover_frames;
                    Ok(Some(frame.to_vec()))
                }
                (true, false) => {
                    if self.hangover_counter > 0 {
                        self.hangover_counter -= 1;
                        Ok(Some(frame.to_vec()))
                    } else {
                        self.in_speech = false;
                        Ok(None)
                    }
                }
                (false, false) => {
                    self.onset_counter = 0;
                    Ok(None)
                }
            }
        }
    }

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

    fn set_clipboard_text(text: &str) -> Result<(), String> {
        let mut utf16: Vec<u16> = text.encode_utf16().collect();
        utf16.push(0);
        let byte_len = utf16.len() * std::mem::size_of::<u16>();

        unsafe {
            OpenClipboard(Some(HWND::default())).map_err(|error| error.to_string())?;
            let clipboard = ClipboardGuard;

            EmptyClipboard().map_err(|error| error.to_string())?;

            let memory = GlobalAlloc(GMEM_MOVEABLE, byte_len).map_err(|error| error.to_string())?;
            let locked = GlobalLock(memory);

            if locked.is_null() {
                return Err("Failed to lock clipboard memory.".to_string());
            }

            ptr::copy_nonoverlapping(utf16.as_ptr().cast::<u8>(), locked.cast::<u8>(), byte_len);

            let _ = GlobalUnlock(memory);

            if SetClipboardData(CF_UNICODETEXT_FORMAT, Some(HANDLE(memory.0))).is_err() {
                return Err("Failed to set clipboard text.".to_string());
            }

            std::mem::forget(clipboard);
            CloseClipboard().map_err(|error| error.to_string())?;
        }

        Ok(())
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

    fn post_character_messages(text: &str) -> Result<(), String> {
        let hwnd = focused_message_window()?;

        for unit in text.encode_utf16() {
            let normalized = if unit == b'\n' as u16 {
                b'\r' as u16
            } else {
                unit
            };
            unsafe {
                PostMessageW(Some(hwnd), WM_CHAR, WPARAM(normalized as usize), LPARAM(0))
                    .map_err(|error| format!("WM_CHAR failed: {error}"))?;
            }
        }

        Ok(())
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

    struct ClipboardGuard;

    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
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
}
