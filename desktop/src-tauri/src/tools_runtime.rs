use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Manager};

fn executable(app: &AppHandle) -> Result<PathBuf, String> {
    let relative = if cfg!(windows) {
        "electron.exe"
    } else if cfg!(target_os = "macos") {
        "Electron.app/Contents/MacOS/Electron"
    } else {
        "electron"
    };
    if cfg!(debug_assertions) {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tools-runtime/dist")
            .join(relative);
        if path.is_file() {
            return Ok(path);
        }
    }
    let path = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("tools-runtime")
        .join(relative);
    if path.is_file() {
        return Ok(path);
    }
    Err("Electron 工具宿主尚未构建。开发版请先运行 npm run tools:build。".into())
}

fn launch(app: &AppHandle, option: Option<&str>) -> Result<(), String> {
    let mut command = Command::new(executable(app)?);
    command.env(
        "AAW_TOOLS_DATA_ROOT",
        app.path()
            .app_local_data_dir()
            .map_err(|error| error.to_string())?,
    );
    command.env("AAW_TOOLS_PARENT_PID", std::process::id().to_string());
    if let Some(option) = option {
        command.arg(option);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut process = command.spawn().map_err(|error| error.to_string())?;
    // The tray host may outlive the main window. Reap short-lived launch requests.
    std::thread::spawn(move || {
        let _ = process.wait();
    });
    Ok(())
}

pub(crate) fn start(app: &AppHandle) {
    if executable(app).is_ok() {
        let _ = launch(app, Some("--aaw-background"));
    }
}

#[tauri::command]
pub fn tools_open_electron(
    window: tauri::WebviewWindow,
    tool_id: Option<String>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("当前窗口无法启动工具。".into());
    }
    let argument = if let Some(id) = tool_id {
        if id.is_empty()
            || id.len() > 64
            || !id.as_bytes()[0].is_ascii_alphanumeric()
            || !id.bytes().all(|ch| {
                ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == b'.' || ch == b'-'
            })
        {
            return Err("工具 ID 无效。".into());
        }
        Some(format!("--aaw-open={id}"))
    } else {
        None
    };
    launch(window.app_handle(), argument.as_deref())
}
