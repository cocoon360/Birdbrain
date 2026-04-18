#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod commands;
mod sidecar;

use commands::{
    keychain_clear, keychain_get, keychain_set, open_workspace_window, pick_folder,
};
use sidecar::SidecarState;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = SidecarState::spawn(&handle)?;
            let base_url = state.base_url();
            app.manage(state);

            // Build the initial picker window pointed at the live sidecar
            // URL. We do this in setup() instead of tauri.conf.json so the
            // URL can change depending on the bundled sidecar port.
            // Trailing slash avoids subtle origin/path joins in the webview.
            let url = format!("{}/", base_url.trim_end_matches('/'));
            let parsed = url
                .parse::<url::Url>()
                .map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!(e.to_string())))?;
            tauri::WebviewWindowBuilder::new(
                &handle,
                "picker",
                tauri::WebviewUrl::External(parsed),
            )
            .title("Bird Brain")
            .inner_size(1280.0, 820.0)
            .min_inner_size(960.0, 640.0)
            .resizable(true)
            .build()?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            keychain_get,
            keychain_set,
            keychain_clear,
            open_workspace_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bird Brain");
}
