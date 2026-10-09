use serde::Serialize;
use std::env;
use std::io::{self, Read};
use std::process;

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

fn main() {
    #[cfg(windows)]
    windows_impl::enable_per_monitor_dpi_awareness();

    let command = env::args().nth(1).unwrap_or_else(|| "help".to_string());
    let result = match command.as_str() {
        "active-window" => active_window_json(),
        "focused-text" => focused_text_json(),
        "focus-window" => focus_window_from_arg(),
        "set-system-mute" => set_system_mute_from_arg(),
        "send-hotkey" => send_hotkey_from_arg(),
        "wait-hotkey-release" => wait_hotkey_release_from_arg(),
        "modifier-hotkeys" => modifier_hotkeys_from_args(),
        "capture-screenshot" => capture_screenshot_from_args(),
        "ocr-image" => ocr_image_from_args(),
        "message-targets" => message_targets_from_arg(),
        "mute-capture-session" => mute_capture_session_from_args(),
        "restore-capture-session" => restore_capture_session_from_stdin(),
        "input-devices" => input_devices_json(),
        "record-wav" => record_wav_from_args(),
        "record-wav-session" => record_wav_session_from_args(),
        "process-wav" => process_wav_from_args(),
        "paste-text" => paste_text_from_stdin(),
        "type-text" => type_text_from_stdin(),
        "message-text" => message_text_from_stdin(),
        "help" | "--help" | "-h" => {
            println!("Usage: voxtype-windows-helper active-window | focused-text [max-before] [max-after] | focus-window <hwnd> | set-system-mute <true|false> | send-hotkey <accelerator> | wait-hotkey-release <accelerator> | modifier-hotkeys [--include-injected] <accelerator>... | capture-screenshot <output.png> [--active-window | --hwnd <hwnd>] | ocr-image <input.png> | message-targets [hwnd] | mute-capture-session <process-id> [process-name] | restore-capture-session | input-devices | record-wav <output.wav> [--capture-mode shared|exclusive-preferred|exclusive-required] [--input-device <name>] [--emit-realtime-pcm16] [--vad-model <silero.onnx>] | record-wav-session [--capture-mode shared] [--input-device <name>] [--emit-realtime-pcm16] [--vad-model <silero.onnx>] | process-wav <input.wav> <output.wav> [--vad-model <silero.onnx>] | paste-text | type-text [delay-ms] | message-text [focused-control|character-messages] [hwnd]");
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
fn input_devices_json() -> Result<(), String> {
    let devices = windows_impl::list_input_devices()?;
    println!(
        "{}",
        serde_json::to_string(&devices)
            .map_err(|error| format!("Could not serialize input devices: {error}"))?
    );
    Ok(())
}

#[cfg(not(windows))]
fn input_devices_json() -> Result<(), String> {
    Err("input-devices is only supported on Windows.".to_string())
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
    let options = NativeRecordingConfig::from_args(3)?;
    windows_impl::record_wav_until_stdin_stop(&output_path, options)
}

#[cfg(not(windows))]
fn record_wav_from_args() -> Result<(), String> {
    Err("record-wav is only supported on Windows.".to_string())
}

#[cfg(windows)]
fn record_wav_session_from_args() -> Result<(), String> {
    let options = NativeRecordingConfig::from_args(2)?;
    windows_impl::record_wav_session(options)
}

#[cfg(not(windows))]
fn record_wav_session_from_args() -> Result<(), String> {
    Err("record-wav-session is only supported on Windows.".to_string())
}

#[cfg(windows)]
fn process_wav_from_args() -> Result<(), String> {
    let input_path = env::args()
        .nth(2)
        .ok_or_else(|| "process-wav requires an input path.".to_string())?;
    let output_path = env::args()
        .nth(3)
        .ok_or_else(|| "process-wav requires an output path.".to_string())?;
    let options = NativeRecordingConfig::from_args(4)?;
    windows_impl::process_wav_file(&input_path, &output_path, options.vad)
}

#[cfg(not(windows))]
fn process_wav_from_args() -> Result<(), String> {
    Err("process-wav is only supported on Windows.".to_string())
}

#[derive(Clone)]
struct NativeRecordingConfig {
    capture_mode: CaptureMode,
    input_device: Option<String>,
    emit_realtime_pcm16: bool,
    vad: NativeVadConfig,
}

impl NativeRecordingConfig {
    fn from_args(skip: usize) -> Result<Self, String> {
        let args = env::args().skip(skip).collect::<Vec<_>>();
        let mut capture_mode = CaptureMode::Shared;
        let mut input_device = None;
        let mut emit_realtime_pcm16 = false;
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
                "--input-device" => {
                    index += 1;
                    input_device = args.get(index).cloned();
                }
                "--emit-realtime-pcm16" => {
                    emit_realtime_pcm16 = true;
                }
                "--vad-model" => {
                    index += 1;
                    vad_config.enabled = true;
                    vad_config.model_path = args.get(index).cloned();
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
            input_device,
            emit_realtime_pcm16,
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

#[derive(Clone, Default)]
struct NativeVadConfig {
    enabled: bool,
    model_path: Option<String>,
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
fn focused_text_json() -> Result<(), String> {
    let max_before = env::args()
        .nth(2)
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(600);
    let max_after = env::args()
        .nth(3)
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(200);
    let text = windows_impl::focused_text(max_before, max_after)?;
    println!(
        "{}",
        serde_json::to_string(&text).map_err(|error| error.to_string())?
    );
    Ok(())
}

#[cfg(not(windows))]
fn focused_text_json() -> Result<(), String> {
    Err("focused-text is only supported on Windows.".to_string())
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
    let delay_ms = env::args()
        .nth(2)
        .map(|value| {
            value
                .parse::<u64>()
                .map_err(|error| format!("Invalid delay-ms '{value}': {error}"))
        })
        .transpose()?
        .unwrap_or(0);
    windows_impl::paste_text(delay_ms)
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
    let hwnd = env::args().nth(3);
    let mut text = String::new();
    io::stdin()
        .read_to_string(&mut text)
        .map_err(|error| error.to_string())?;
    windows_impl::message_text(&text, &strategy, hwnd.as_deref())
}

#[cfg(not(windows))]
fn message_text_from_stdin() -> Result<(), String> {
    Err("message-text is only supported on Windows.".to_string())
}

#[cfg(windows)]
fn message_targets_from_arg() -> Result<(), String> {
    let hwnd = env::args().nth(2);
    let targets = windows_impl::message_targets(hwnd.as_deref())?;
    println!(
        "{}",
        serde_json::to_string(&targets).map_err(|error| error.to_string())?
    );
    Ok(())
}

#[cfg(not(windows))]
fn message_targets_from_arg() -> Result<(), String> {
    Err("message-targets is only supported on Windows.".to_string())
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
fn wait_hotkey_release_from_arg() -> Result<(), String> {
    let accelerator = env::args()
        .nth(2)
        .ok_or_else(|| "wait-hotkey-release requires an accelerator.".to_string())?;
    windows_impl::wait_hotkey_release(&accelerator)
}

#[cfg(not(windows))]
fn wait_hotkey_release_from_arg() -> Result<(), String> {
    Err("wait-hotkey-release is only supported on Windows.".to_string())
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
#[cfg(windows)]
mod windows_impl;

#[cfg(windows)]
fn modifier_hotkeys_from_args() -> Result<(), String> {
    let args = env::args().skip(2).collect::<Vec<_>>();
    windows_impl::modifier_hotkeys(&args)
}

#[cfg(not(windows))]
fn modifier_hotkeys_from_args() -> Result<(), String> {
    Err("modifier-hotkeys is only supported on Windows.".to_string())
}
