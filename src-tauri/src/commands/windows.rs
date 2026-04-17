use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::sidecar::SidecarState;

// Opens a new native window pinned to a specific workspace. Each window
// is its own OS-level window so the user can have multiple projects
// visible at once. The URL points at the already-running sidecar so all
// windows share the same Next.js process and DB connections.
#[tauri::command]
pub async fn open_workspace_window(
    app: AppHandle,
    workspace_id: String,
    title: Option<String>,
) -> Result<(), String> {
    let sidecar = app.state::<SidecarState>();
    let base = sidecar.base_url();

    let label = format!("workspace-{}", sanitize_label(&workspace_id));
    if let Some(existing) = app.get_webview_window(&label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let url = format!("{}/w/{}", base.trim_end_matches('/'), workspace_id);
    let parsed = url.parse().map_err(|e: url::ParseError| e.to_string())?;

    WebviewWindowBuilder::new(&app, label, WebviewUrl::External(parsed))
        .title(title.unwrap_or_else(|| format!("Bird Brain · {}", workspace_id)))
        .inner_size(1280.0, 820.0)
        .min_inner_size(960.0, 640.0)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn sanitize_label(input: &str) -> String {
    input
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}
