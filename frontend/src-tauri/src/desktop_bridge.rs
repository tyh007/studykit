use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutEvent, ShortcutState};

pub const QUICK_CAPTURE_SHORTCUT: &str = "CmdOrCtrl+Shift+Space";

#[derive(Debug, Clone, Serialize)]
pub struct GlobalShortcutStatus {
    pub available: bool,
    pub shortcut: String,
    pub error: Option<String>,
}

static STATUS: Lazy<Mutex<GlobalShortcutStatus>> = Lazy::new(|| {
    Mutex::new(GlobalShortcutStatus {
        available: false,
        shortcut: QUICK_CAPTURE_SHORTCUT.to_string(),
        error: Some("global shortcut has not been registered".to_string()),
    })
});

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(
            |app: &tauri::AppHandle,
             _shortcut: &tauri_plugin_global_shortcut::Shortcut,
             event: ShortcutEvent| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
                let _ = app.emit("studykit://quick-capture", ());
            },
        )
        .build()
}

pub fn register(app: &tauri::AppHandle) {
    let next = match app.global_shortcut().register(QUICK_CAPTURE_SHORTCUT) {
        Ok(()) => GlobalShortcutStatus {
            available: true,
            shortcut: QUICK_CAPTURE_SHORTCUT.to_string(),
            error: None,
        },
        Err(error) => GlobalShortcutStatus {
            available: false,
            shortcut: QUICK_CAPTURE_SHORTCUT.to_string(),
            error: Some(format!(
                "shortcut is unavailable or already used by another app: {error}"
            )),
        },
    };
    *STATUS.lock().expect("shortcut status mutex poisoned") = next;
}

#[tauri::command]
pub fn get_global_shortcut_status_v1() -> GlobalShortcutStatus {
    STATUS
        .lock()
        .expect("shortcut status mutex poisoned")
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_status_is_fail_closed() {
        let status = get_global_shortcut_status_v1();
        assert_eq!(status.shortcut, QUICK_CAPTURE_SHORTCUT);
        assert!(!status.available);
    }
}
