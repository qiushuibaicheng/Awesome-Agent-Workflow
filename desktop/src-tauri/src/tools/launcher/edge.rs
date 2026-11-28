//! Windows 贴边触发与停留计时。边缘命中和面板展示各自独立。

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preference {
    pub enabled: bool,
    pub delay_ms: u64,
    pub side: Side,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Left,
    #[default]
    Right,
    Top,
    Bottom,
}

impl Side {
    #[cfg(windows)]
    fn is_horizontal(self) -> bool {
        matches!(self, Self::Top | Self::Bottom)
    }
}

impl Default for Preference {
    fn default() -> Self {
        Self {
            enabled: false,
            delay_ms: 350,
            side: Side::Right,
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
    side: Side,
}

#[cfg(windows)]
impl Placement {
    pub fn fit_outer(&self, outer: PhysicalSize<u32>) -> PhysicalPosition<i32> {
        let spare_width = self.work_size.width.saturating_sub(outer.width) as i32;
        let spare_height = self.work_size.height.saturating_sub(outer.height) as i32;
        let (x, y) = match self.side {
            Side::Left => (0, spare_height / 2),
            Side::Right => (spare_width, spare_height / 2),
            Side::Top => (spare_width / 2, 0),
            Side::Bottom => (spare_width / 2, spare_height),
        };
        PhysicalPosition::new(self.work_position.x + x, self.work_position.y + y)
    }

    fn edge_neighbor(&self, x: i32, y: i32, band: i32) -> Option<(i32, i32)> {
        let origin = self.work_position;
        let right = origin.x + self.work_size.width as i32;
        let bottom = origin.y + self.work_size.height as i32;
        if !contains(origin, self.work_size, x, y) {
            return None;
        }
        // 返回边缘外一点，用于排除相邻屏幕的接缝。
        match self.side {
            Side::Left if x < origin.x + band => Some((origin.x - 1, y)),
            Side::Right if x >= right - band => Some((right, y)),
            Side::Top if y < origin.y + band => Some((x, origin.y - 1)),
            Side::Bottom if y >= bottom - band => Some((x, bottom)),
            _ => None,
        }
    }

    fn contains_along_edge(&self, x: i32, y: i32) -> bool {
        if self.side.is_horizontal() {
            x >= self.position.x && x < self.position.x + self.size.width as i32
        } else {
            y >= self.position.y && y < self.position.y + self.size.height as i32
        }
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
fn dock_length(axis: u32, scale: f64, entries: usize) -> u32 {
    // 与工具栏的 49px 按钮、5px 间距及首尾留白对齐，最后一格用于打开全部功能。
    let needed = ((22.0 + entries.saturating_add(1) as f64 * 54.0) * scale).ceil() as u32;
    let max = (f64::from(axis) * 0.618).floor() as u32;
    needed.min(max).max(1)
}

#[cfg(windows)]
fn placement(monitor: &Monitor, preference: Preference, entries: usize) -> Placement {
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let cross = (106.0 * scale).round() as u32;
    let size = if preference.side.is_horizontal() {
        PhysicalSize::new(
            dock_length(area.size.width, scale, entries),
            cross.min(area.size.height),
        )
    } else {
        PhysicalSize::new(
            cross.min(area.size.width),
            dock_length(area.size.height, scale, entries),
        )
    };
    let mut placement = Placement {
        position: area.position,
        size,
        work_position: area.position,
        work_size: area.size,
        side: preference.side,
    };
    placement.position = placement.fit_outer(size);
    placement
}

#[cfg(windows)]
pub(super) async fn watch(app: AppHandle, preference: Preference) {
    let mut dwell = Dwell::default();
    let delay = Duration::from_millis(preference.delay_ms);
    let mut entry_count = None;
    loop {
        tokio::time::sleep(Duration::from_millis(60)).await;
        let state = app.state::<LauncherState>();
        if state
            .dock_dragging
            .load(std::sync::atomic::Ordering::Acquire)
        {
            dwell = Dwell::default();
            continue;
        }
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
            let band = (3.0 * monitor.scale_factor()).ceil() as i32;
            placement(monitor, preference, 0)
                .edge_neighbor(x, y, band)
                .is_some_and(|(outside_x, outside_y)| {
                    !monitors.iter().enumerate().any(|(other, neighbor)| {
                        other != *index
                            && contains(
                                *neighbor.position(),
                                *neighbor.size(),
                                outside_x,
                                outside_y,
                            )
                    })
                })
        });
        let target = active.filter(|(_, monitor)| !foreground_blocks(monitor, true));
        if active.is_some() && target.is_none() {
            // 全屏或拖动结束时从零计时，仍需尊重关闭后的离开条件。
            dwell.since = None;
            continue;
        }
        if target.is_none() {
            entry_count = None;
        }
        let target = target.filter(|(_, monitor)| {
            let (count, sampled_at) = entry_count
                .get_or_insert_with(|| (super::dock_entry_count(&app).unwrap_or(2), now));
            if now.duration_since(*sampled_at) >= Duration::from_secs(1) {
                *count = super::dock_entry_count(&app).unwrap_or(*count);
                *sampled_at = now;
            }
            placement(monitor, preference, *count).contains_along_edge(x, y)
        });
        if dwell.reveal(target.map(|(index, _)| index), now, delay) {
            if let Some((_, monitor)) = target {
                let count = entry_count.map_or(2, |(count, _)| count);
                if let Err(error) = super::reveal_edge(&app, placement(monitor, preference, count))
                {
                    eprintln!("[aaw-tools] 贴边栏显示失败：{error}");
                }
            }
        }
    }
}

#[cfg(windows)]
fn nearest_side(origin: PhysicalPosition<i32>, size: PhysicalSize<u32>, x: i32, y: i32) -> Side {
    let candidates = [
        (x.abs_diff(origin.x), Side::Left),
        (x.abs_diff(origin.x + size.width as i32), Side::Right),
        (y.abs_diff(origin.y), Side::Top),
        (y.abs_diff(origin.y + size.height as i32), Side::Bottom),
    ];
    candidates
        .into_iter()
        .min_by_key(|(distance, _)| *distance)
        .unwrap()
        .1
}

#[cfg(windows)]
#[link(name = "user32")]
unsafe extern "system" {
    fn GetAsyncKeyState(key: i32) -> i16;
}

#[cfg(windows)]
fn left_is_down() -> bool {
    // SAFETY: VK_LBUTTON 只用于一次实际拖动的开始和结束判断。
    unsafe { GetAsyncKeyState(0x01) < 0 }
}

#[cfg(windows)]
pub(super) fn start_drag(app: AppHandle, window: &tauri::WebviewWindow) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    let state = app.state::<LauncherState>();
    if !left_is_down()
        || state
            .dock_dragging
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
            .is_err()
    {
        return Ok(());
    }
    if let Err(error) = window.start_dragging() {
        state.dock_dragging.store(false, Ordering::Release);
        return Err(error.to_string());
    }
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        while left_is_down()
            && started.elapsed() < Duration::from_secs(30)
            && app
                .state::<LauncherState>()
                .edge_enabled
                .load(Ordering::Acquire)
        {
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
        let state = app.state::<LauncherState>();
        if state.edge_enabled.load(Ordering::Acquire) && state.is_edge_surface() {
            if let Err(error) = snap_after_drag(&app) {
                eprintln!("[aaw-tools] 工具栏停靠失败：{error}");
            }
        }
        state.dock_dragging.store(false, Ordering::Release);
    });
    Ok(())
}

#[cfg(windows)]
fn snap_after_drag(app: &AppHandle) -> Result<(), String> {
    let point = app.cursor_position().map_err(|error| error.to_string())?;
    let (x, y) = (point.x as i32, point.y as i32);
    let monitors = app
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let monitor = monitors
        .iter()
        .find(|monitor| contains(*monitor.position(), *monitor.size(), x, y))
        .ok_or("找不到拖动结束时所在屏幕。")?;
    let area = monitor.work_area();
    let store = super::store_of(app)?;
    let launcher = super::LauncherStore::new(&store);
    let mut preference = launcher.edge_preference();
    preference.side = nearest_side(area.position, area.size, x, y);
    launcher.set_edge_preference(preference)?;
    super::hide_edge(app);
    super::apply_edge_preference(app, preference);
    super::reveal_edge(
        app,
        placement(
            monitor,
            preference,
            super::dock_entry_count(app).unwrap_or(2),
        ),
    )
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
            side: Side::Right,
        };
        assert_eq!(
            placement.fit_outer(PhysicalSize::new(448, 703)),
            PhysicalPosition::new(-448, 148),
        );
    }

    #[cfg(windows)]
    #[test]
    fn anchors_all_four_sides_and_matches_only_the_configured_segment() {
        for (side, x, y, hit_x, hit_y) in [
            (Side::Left, 0, 350, 1, 355),
            (Side::Right, 800, 350, 999, 355),
            (Side::Top, 400, 0, 405, 1),
            (Side::Bottom, 400, 700, 405, 899),
        ] {
            let mut placement = Placement {
                position: PhysicalPosition::new(0, 0),
                size: PhysicalSize::new(200, 200),
                work_position: PhysicalPosition::new(0, 0),
                work_size: PhysicalSize::new(1000, 900),
                side,
            };
            placement.position = placement.fit_outer(placement.size);
            assert_eq!(placement.position, PhysicalPosition::new(x, y));
            assert!(placement.edge_neighbor(hit_x, hit_y, 3).is_some());
            assert!(placement.contains_along_edge(hit_x, hit_y));
            assert!(!placement.contains_along_edge(10, 10));
        }
    }

    #[test]
    fn reads_previous_settings_as_a_centered_right_dock() {
        let old: Preference = serde_json::from_str(r#"{"enabled":true,"delayMs":500}"#).unwrap();
        assert!(old.enabled);
        assert_eq!(old.delay_ms, 500);
        assert!(matches!(old.side, Side::Right));
    }

    #[cfg(windows)]
    #[test]
    fn grows_with_the_catalog_up_to_the_work_area_limit() {
        assert!(dock_length(1000, 1.0, 2) < dock_length(1000, 1.0, 5));
        assert_eq!(dock_length(1000, 1.0, 400), 618);
        assert_eq!(dock_length(800, 1.25, 2), 230);
    }

    #[cfg(windows)]
    #[test]
    fn dragging_selects_the_nearest_side_of_the_current_screen() {
        let origin = PhysicalPosition::new(-1000, 0);
        let size = PhysicalSize::new(1000, 800);
        assert!(matches!(
            nearest_side(origin, size, -500, 798),
            Side::Bottom
        ));
        assert!(matches!(nearest_side(origin, size, -2, 500), Side::Right));
    }
}
