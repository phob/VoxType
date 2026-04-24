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
        "record-wav" => record_wav_from_arg(),
        "paste-text" => paste_text_from_stdin(),
        "type-text" => type_text_from_stdin(),
        "help" | "--help" | "-h" => {
            println!("Usage: voxtype-windows-helper active-window | focus-window <hwnd> | set-system-mute <true|false> | record-wav <output.wav> | paste-text | type-text [delay-ms]");
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
fn record_wav_from_arg() -> Result<(), String> {
    let output_path = env::args()
        .nth(2)
        .ok_or_else(|| "record-wav requires an output path.".to_string())?;
    windows_impl::record_wav_until_stdin_stop(&output_path)
}

#[cfg(not(windows))]
fn record_wav_from_arg() -> Result<(), String> {
    Err("record-wav is only supported on Windows.".to_string())
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

#[cfg(not(windows))]
fn set_system_mute_from_arg() -> Result<(), String> {
    Err("set-system-mute is only supported on Windows.".to_string())
}

#[cfg(windows)]
mod windows_impl {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{Sample, SizedSample};
    use rubato::{FftFixedIn, Resampler};
    use serde::Serialize;
    use std::fs::File;
    use std::io::{self, BufRead, BufReader, BufWriter};
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
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, MAX_PATH};
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        KEYEVENTF_UNICODE, VIRTUAL_KEY, VK_CONTROL, VK_V,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    const CF_UNICODETEXT_FORMAT: u32 = 13;
    const VOXTYPE_SAMPLE_RATE: usize = 16_000;
    const RESAMPLER_CHUNK_SIZE: usize = 1024;

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ActiveWindow {
        hwnd: String,
        title: String,
        process_id: u32,
        process_path: Option<String>,
        process_name: Option<String>,
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

    pub fn record_wav_until_stdin_stop(output_path: &str) -> Result<(), String> {
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
            cpal::SampleFormat::I8 => {
                build_input_stream::<i8>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::I16 => {
                build_input_stream::<i16>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::I32 => {
                build_input_stream::<i32>(&device, &config, channels, sample_tx)?
            }
            cpal::SampleFormat::F32 => {
                build_input_stream::<f32>(&device, &config, channels, sample_tx)?
            }
            sample_format => return Err(format!("Unsupported sample format: {sample_format:?}")),
        };

        stream.play().map_err(|error| error.to_string())?;

        let mut resampler = FrameResampler::new(sample_rate as usize, VOXTYPE_SAMPLE_RATE);
        let mut samples = Vec::<f32>::new();

        while !stop_flag.load(Ordering::SeqCst) {
            match sample_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(chunk) => {
                    resampler.push(&chunk, &mut |frame| samples.extend_from_slice(frame));
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        drop(stream);

        while let Ok(chunk) = sample_rx.try_recv() {
            resampler.push(&chunk, &mut |frame| samples.extend_from_slice(frame));
        }

        resampler.finish(&mut |frame| samples.extend_from_slice(frame));
        write_wav(output_path, &samples)?;
        println!(
            "{}",
            serde_json::to_string(&RecordingResponse {
                path: output_path.to_string_lossy().to_string(),
                sample_rate: VOXTYPE_SAMPLE_RATE as u32,
                samples: samples.len()
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
    }

    fn get_preferred_input_config(
        device: &cpal::Device,
    ) -> Result<cpal::SupportedStreamConfig, String> {
        let default_config = device.default_input_config().map_err(|error| error.to_string())?;
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
        T: Sample + SizedSample + Send + 'static,
        f32: cpal::FromSample<T>,
    {
        device
            .build_input_stream(
                &config.clone().into(),
                move |data: &[T], _| {
                    let mut output = Vec::with_capacity(data.len() / channels.max(1));

                    if channels == 1 {
                        output.extend(data.iter().map(|sample| sample.to_sample::<f32>()));
                    } else {
                        for frame in data.chunks_exact(channels) {
                            output.push(
                                frame
                                    .iter()
                                    .map(|sample| sample.to_sample::<f32>())
                                    .sum::<f32>()
                                    / channels as f32,
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
                    if let Ok(output) = self.resampler.as_mut().unwrap().process(&[&self.in_buf], None)
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
                (clamped * i16::MIN as f32) as i16
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

            let memory = GlobalAlloc(GMEM_MOVEABLE, byte_len)
                .map_err(|error| error.to_string())?;
            let locked = GlobalLock(memory);

            if locked.is_null() {
                return Err("Failed to lock clipboard memory.".to_string());
            }

            ptr::copy_nonoverlapping(
                utf16.as_ptr().cast::<u8>(),
                locked.cast::<u8>(),
                byte_len,
            );

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
        let sent = unsafe {
            SendInput(
                &mut inputs,
                std::mem::size_of::<INPUT>() as i32,
            )
        };

        if sent != inputs.len() as u32 {
            return Err(format!("SendInput sent {sent} of {} events.", inputs.len()));
        }

        Ok(())
    }

    fn send_unicode_unit(unit: u16) -> Result<(), String> {
        let mut inputs = [
            unicode_input(unit, false),
            unicode_input(unit, true),
        ];
        let sent = unsafe {
            SendInput(
                &mut inputs,
                std::mem::size_of::<INPUT>() as i32,
            )
        };

        if sent != inputs.len() as u32 {
            return Err(format!("SendInput sent {sent} of {} unicode events.", inputs.len()));
        }

        Ok(())
    }

    fn keyboard_input(key: VIRTUAL_KEY, key_up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    wScan: 0,
                    dwFlags: if key_up { KEYEVENTF_KEYUP } else { Default::default() },
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
        let process = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION,
                false,
                process_id,
            )
        }
        .ok()?;

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

        let initialized = unsafe {
            std::slice::from_raw_parts(buffer.as_ptr().cast::<u16>(), size as usize)
        };

        Some(String::from_utf16_lossy(initialized))
    }
}
