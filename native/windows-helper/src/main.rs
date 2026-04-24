use serde::Serialize;
use std::env;
use std::process;

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

fn main() {
    let command = env::args().nth(1).unwrap_or_else(|| "help".to_string());
    let result = match command.as_str() {
        "active-window" => active_window_json(),
        "help" | "--help" | "-h" => {
            println!("Usage: voxtype-windows-helper active-window");
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
mod windows_impl {
    use serde::Serialize;
    use std::mem::MaybeUninit;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HWND, MAX_PATH};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    };

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

