use ring::rand::{SecureRandom, SystemRandom};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Mutex, mpsc};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct LauncherRoutes {
    pending: Mutex<HashMap<String, mpsc::SyncSender<Option<String>>>>,
    endpoint: Mutex<Option<(u16, String)>>,
}

#[tauri::command]
pub fn launcher_reply(
    window: tauri::WebviewWindow,
    request_id: String,
    error: Option<String>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("无效的启动器响应来源。".into());
    }
    if let Some(sender) = window
        .state::<LauncherRoutes>()
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&request_id)
    {
        let _ = sender.send(error);
    }
    Ok(())
}

// One loopback endpoint per desktop process. Only a child with the inherited
// random token can dispatch a bounded, allowlisted route. No shell or file API.
fn bridge(app: &AppHandle) -> Result<(u16, String), String> {
    let state = app.state::<LauncherRoutes>();
    let mut endpoint = state.endpoint.lock().map_err(|e| e.to_string())?;
    if let Some(value) = endpoint.as_ref() {
        return Ok(value.clone());
    }
    let server = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server.local_addr().map_err(|e| e.to_string())?.port();
    let mut bytes = [0u8; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| "启动器连接初始化失败。")?;
    let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    *endpoint = Some((port, token.clone()));
    let app = app.clone();
    let secret = token.clone();
    std::thread::spawn(move || {
        for stream in server.incoming() {
            let Ok(mut stream) = stream else {
                break;
            };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
            let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
            let mut line = String::new();
            if BufReader::new((&mut stream).take(4097))
                .read_line(&mut line)
                .is_err()
                || line.len() > 4096
                || !line.ends_with('\n')
            {
                continue;
            }
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            if value["token"].as_str() != Some(&secret) {
                continue;
            }
            let Some(id) = value["requestId"]
                .as_str()
                .filter(|id| !id.is_empty() && id.len() <= 64)
            else {
                continue;
            };
            let Some(target) = value["target"]
                .as_str()
                .filter(|target| matches!(*target, "aaw" | "tools"))
            else {
                continue;
            };
            let (sender, receiver) = mpsc::sync_channel(1);
            if let Ok(mut pending) = app.state::<LauncherRoutes>().pending.lock() {
                pending.insert(id.to_owned(), sender);
            }
            let sent = app.emit_to(
                "main",
                "aaw://launcher-open",
                serde_json::json!({ "requestId": id, "target": target }),
            );
            let error = if sent.is_err() {
                Some("主窗口不可用。".to_owned())
            } else {
                receiver
                    .recv_timeout(Duration::from_secs(3))
                    .unwrap_or(Some("主窗口尚未就绪，请稍后重试。".to_owned()))
            };
            if let Ok(mut pending) = app.state::<LauncherRoutes>().pending.lock() {
                pending.remove(id);
            }
            if error.is_none() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            let _ = writeln!(
                stream,
                "{}",
                serde_json::json!({ "requestId": id, "error": error })
            );
        }
    });
    Ok((port, token))
}

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
        .map_err(|e| e.to_string())?
        .join("tools-runtime")
        .join(relative);
    if path.is_file() {
        return Ok(path);
    }
    Err("Electron 工具宿主尚未构建。开发版请先运行 npm run tools:build。".into())
}

fn launch(app: &AppHandle, option: Option<&str>) -> Result<(), String> {
    let mut command = Command::new(executable(app)?);
    let root = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let (port, token) = bridge(app)?;
    command.env("AAW_TOOLS_DATA_ROOT", &root);
    command.env("AAW_TOOLS_PARENT_PID", std::process::id().to_string());
    command.env("AAW_LAUNCHER_PORT", port.to_string());
    command.env("AAW_LAUNCHER_TOKEN", token);
    command.env("AAW_TOOLS_HOST_PROFILE", root.join("launcher-profile"));
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
        command.creation_flags(0x0800_0000);
    }
    let mut process = command.spawn().map_err(|error| error.to_string())?;
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
