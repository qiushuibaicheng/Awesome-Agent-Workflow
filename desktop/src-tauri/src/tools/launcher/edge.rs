//! Windows 贴边触发与停留计时。边缘命中和面板展示各自独立。

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preference {
    pub enabled: bool,
    pub delay_ms: u64,
}

impl Default for Preference {
    fn default() -> Self {
        Self {
            enabled: false,
            delay_ms: 350,
        }
    }
}

impl Preference {
    pub fn normalized(self) -> Self {
        Self {
            delay_ms: self.delay_ms.clamp(200, 1000),
            ..self
        }
    }
}

#[cfg(windows)]
use tauri::{AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize};

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::RECT,
    UI::WindowsAndMessaging::{
        GetForegroundWindow, GetGUIThreadInfo, GetShellWindow, GetWindowRect, ShowWindow,
        GUITHREADINFO, GUI_INMENUMODE, GUI_INMOVESIZE, SW_HIDE, SW_SHOWNOACTIVATE,
    },
};

#[cfg(windows)]
use super::{LauncherState, LABEL};

#[cfg(windows)]
pub(super) struct Placement {
    pub position: PhysicalPosition<i32>,
    pub size: PhysicalSize<u32>,
    work_position: PhysicalPosition<i32>,
    work_size: PhysicalSize<u32>,
}

#[cfg(windows)]
impl Placement {
    pub fn fit_outer(&self, outer: PhysicalSize<u32>) -> PhysicalPosition<i32> {
        PhysicalPosition::new(
            self.work_position.x + self.work_size.width.saturating_sub(outer.width) as i32,
            self.position.y.min(
                self.work_position.y + self.work_size.height.saturating_sub(outer.height) as i32,
            ),
        )
    }
}

const HIDE_DELAY: Duration = Duration::from_millis(600);

#[derive(Default)]
struct Dwell {
    since: Option<(usize, Instant)>,
    left: Option<Instant>,
    blocked: bool,
}

impl Dwell {
    fn reveal(&mut self, edge: Option<usize>, now: Instant, delay: Duration) -> bool {
        let Some(edge) = edge else {
            self.since = None;
            self.blocked = false;
            return false;
        };
        if self.blocked {
            return false;
        }
        match self.since {
            Some((last, since)) if last == edge => {
                if now.duration_since(since) < delay {
                    return false;
                }
                self.blocked = true;
                true
            }
            _ => {
                self.since = Some((edge, now));
                false
            }
        }
    }

    fn dismiss(&mut self, inside: bool, now: Instant) -> bool {
        if inside {
            self.left = None;
            return false;
        }
        now.duration_since(*self.left.get_or_insert(now)) >= HIDE_DELAY
    }
}

#[cfg(windows)]
fn contains(origin: PhysicalPosition<i32>, size: PhysicalSize<u32>, x: i32, y: i32) -> bool {
    x >= origin.x
        && x < origin.x + size.width as i32
        && y >= origin.y
        && y < origin.y + size.height as i32
}

#[cfg(windows)]
fn foreground_blocks(monitor: &Monitor, dragging: bool) -> bool {
    // SAFETY: 只查询当前窗口情况，RECT 与 GUITHREADINFO 由当前调用持有。
    unsafe {
        let foreground = GetForegroundWindow();
        if foreground.is_null() {
            return true;
        }
        if dragging {
            let mut info = GUITHREADINFO {
                cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
                ..Default::default()
            };
            if GetGUIThreadInfo(0, &mut info) != 0
                && (info.flags & (GUI_INMOVESIZE | GUI_INMENUMODE) != 0
                    || !info.hwndCapture.is_null())
            {
                return true;
            }
        }
        if foreground == GetShellWindow() {
            return false;
        }
        let mut rect = RECT::default();
        let position = monitor.position();
        let size = monitor.size();
        GetWindowRect(foreground, &mut rect) != 0
            && rect.left <= position.x
            && rect.top <= position.y
            && rect.right >= position.x + size.width as i32
            && rect.bottom >= position.y + size.height as i32
    }
}

#[cfg(windows)]
pub(super) fn set_inactive_visibility(
    window: &tauri::WebviewWindow,
    visible: bool,
) -> tauri::Result<()> {
    let hwnd = window.hwnd()?;
    // SAFETY: hwnd 由仍持有的启动器窗口提供，ShowWindow 只请求变更显示状态。
    unsafe {
        ShowWindow(hwnd.0, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
    }
    Ok(())
}

#[cfg(windows)]
fn placement(monitor: &Monitor, y: i32) -> Placement {
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let width = ((344.0 * scale).round() as u32).min(area.size.width);
    let height = ((548.0 * scale).round() as u32).min(area.size.height);
    let left = area.position.x + (area.size.width - width) as i32;
    let top = (y - height as i32 / 2).clamp(
        area.position.y,
        area.position.y + (area.size.height - height) as i32,
    );
    Placement {
        position: PhysicalPosition::new(left, top),
        size: PhysicalSize::new(width, height),
        work_position: area.position,
        work_size: area.size,
    }
}

#[cfg(windows)]
pub(super) async fn watch(app: AppHandle, delay_ms: u64) {
    let mut dwell = Dwell::default();
    let delay = Duration::from_millis(delay_ms);
    loop {
        tokio::time::sleep(Duration::from_millis(60)).await;
        let state = app.state::<LauncherState>();
        let window = app.get_webview_window(LABEL);
        let visible = window
            .as_ref()
            .is_some_and(|window| window.is_visible().unwrap_or(false));
        let edge_visible = visible && state.is_edge_surface();
        if visible && !edge_visible {
            dwell = Dwell::default();
            continue;
        }
        let (Ok(point), Ok(monitors)) = (app.cursor_position(), app.available_monitors()) else {
            dwell.since = None;
            continue;
        };
        let (x, y) = (point.x as i32, point.y as i32);
        let current = monitors
            .iter()
            .enumerate()
            .find(|(_, monitor)| contains(*monitor.position(), *monitor.size(), x, y));
        let now = Instant::now();
        if edge_visible {
            dwell.since = None;
            dwell.blocked = true;
            let Some(window) = window else { continue };
            let inside = window
                .outer_position()
                .ok()
                .zip(window.outer_size().ok())
                .is_some_and(|(position, size)| contains(position, size, x, y));
            if current.is_some_and(|(_, monitor)| foreground_blocks(monitor, false))
                || dwell.dismiss(inside, now)
            {
                super::hide_edge(&app);
            }
            continue;
        }
        dwell.left = None;
        let active = current.filter(|(index, monitor)| {
            let area = monitor.work_area();
            let right = monitor.position().x + monitor.size().width as i32;
            let width = (3.0 * monitor.scale_factor()).ceil() as i32;
            x >= right - width
                && area.position.x + area.size.width as i32 == right
                && y >= area.position.y + 16
                && y < area.position.y + area.size.height as i32 - 16
                && !monitors.iter().enumerate().any(|(other, neighbor)| {
                    other != *index && contains(*neighbor.position(), *neighbor.size(), right, y)
                })
        });
        let target = active.filter(|(_, monitor)| !foreground_blocks(monitor, true));
        if active.is_some() && target.is_none() {
            // 全屏或拖动结束时从零计时，仍需尊重关闭后的离开条件。
            dwell.since = None;
            continue;
        }
        if dwell.reveal(target.map(|(index, _)| index), now, delay) {
            if let Some((_, monitor)) = target {
                if let Err(error) = super::reveal_edge(&app, placement(monitor, y)) {
                    eprintln!("[aaw-tools] 贴边栏显示失败：{error}");
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dwell_requires_continuous_presence_and_rearms_after_leaving() {
        let mut dwell = Dwell::default();
        let now = Instant::now();
        let delay = Duration::from_millis(350);
        assert!(!dwell.reveal(Some(0), now, delay));
        assert!(!dwell.reveal(None, now + delay, delay));
        assert!(!dwell.reveal(Some(1), now + delay, delay));
        assert!(dwell.reveal(Some(1), now + delay * 2, delay));
        assert!(!dwell.reveal(Some(1), now + delay * 3, delay));
        assert!(!dwell.reveal(None, now + delay * 3, delay));
        assert!(!dwell.reveal(Some(1), now + delay * 4, delay));
        assert!(dwell.reveal(Some(1), now + delay * 5, delay));
    }

    #[test]
    fn leaving_and_returning_restarts_the_hide_timer() {
        let mut dwell = Dwell::default();
        let now = Instant::now();
        assert!(!dwell.dismiss(false, now));
        assert!(!dwell.dismiss(true, now + HIDE_DELAY));
        assert!(!dwell.dismiss(false, now + HIDE_DELAY));
        assert!(dwell.dismiss(false, now + HIDE_DELAY * 2));
    }

    #[cfg(windows)]
    #[test]
    fn aligns_the_outer_frame_inside_a_negative_origin_work_area() {
        let placement = Placement {
            position: PhysicalPosition::new(-430, 315),
            size: PhysicalSize::new(430, 685),
            work_position: PhysicalPosition::new(-1920, 0),
            work_size: PhysicalSize::new(1920, 1000),
        };
        assert_eq!(
            placement.fit_outer(PhysicalSize::new(448, 703)),
            PhysicalPosition::new(-448, 297),
        );
    }
}
