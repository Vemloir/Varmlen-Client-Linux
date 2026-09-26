//! Bring the window back when WebKit loses the page under it.
//!
//! On Linux the UI runs in a separate `WebKitWebProcess`. When that process dies
//! -- a JavaScriptCore crash (WebKitGTK 2.52 has one that fires after the window has
//! sat idle for a while) or the memory limit being hit -- WebKit emits
//! `web-process-terminated` and leaves the view empty. Nothing was listening, so the
//! app, the tray and the tunnel all kept running behind a window that had turned
//! grey for good and only came back on a restart.
//!
//! A reload is what asks WebKit for a new web process. The page owns no state that
//! a reload loses: subscriptions and settings live in localStorage, and the layout
//! asks the daemon for the tunnel's real state the moment it mounts.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// How many reloads a burst of crashes may cost before we stop asking for more.
const MAX_RELOADS: usize = 3;
/// The window those reloads are counted over. A page that dies again as soon as it
/// is reloaded would otherwise spin a new web process forever.
const WINDOW: Duration = Duration::from_secs(120);

/// Remembers recent reloads, so a page that crashes on load does not loop.
#[derive(Debug, Default)]
pub(crate) struct ReloadBudget {
    recent: VecDeque<Instant>,
}

impl ReloadBudget {
    /// Whether a reload may happen at `now`; records it when it may.
    pub(crate) fn take(&mut self, now: Instant) -> bool {
        while let Some(&first) = self.recent.front() {
            if now.duration_since(first) >= WINDOW {
                self.recent.pop_front();
            } else {
                break;
            }
        }
        if self.recent.len() >= MAX_RELOADS {
            return false;
        }
        self.recent.push_back(now);
        true
    }
}

/// Watch the main window's web process and reload the page when it dies.
#[cfg(target_os = "linux")]
pub fn install(app: &tauri::AppHandle) {
    use std::cell::RefCell;
    use tauri::Manager;
    use webkit2gtk::{WebProcessTerminationReason, WebViewExt};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let result = window.with_webview(|webview| {
        let view = webview.inner();
        let budget = RefCell::new(ReloadBudget::default());
        view.connect_web_process_terminated(move |view, reason| {
            // Our own terminate call is not a crash.
            if reason == WebProcessTerminationReason::TerminatedByApi {
                return;
            }
            if budget.borrow_mut().take(Instant::now()) {
                eprintln!("webview: web process terminated ({reason:?}); reloading");
                view.reload();
            } else {
                eprintln!(
                    "webview: web process terminated ({reason:?}) {MAX_RELOADS} times in {}s; not reloading again",
                    WINDOW.as_secs()
                );
            }
        });
    });
    if let Err(e) = result {
        eprintln!("webview: could not watch the web process: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_crash_now_and_then_is_always_reloaded() {
        let mut budget = ReloadBudget::default();
        let start = Instant::now();
        for i in 0..10 {
            assert!(budget.take(start + WINDOW * i), "reload {i}");
        }
    }

    #[test]
    fn a_crash_loop_stops_after_the_budget() {
        let mut budget = ReloadBudget::default();
        let start = Instant::now();
        for i in 0..MAX_RELOADS as u32 {
            assert!(budget.take(start + Duration::from_secs(i as u64)));
        }
        assert!(!budget.take(start + Duration::from_secs(10)));
        // A refused reload is not counted, so the budget still refills on time.
        assert!(budget.take(start + WINDOW + Duration::from_secs(1)));
    }
}
