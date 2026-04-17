use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize)]
pub struct PickedFolder {
    pub path: String,
    pub name: String,
}

// Opens the OS native folder-picker dialog. Returns None when the user
// cancels. The JS side sends the path back to the Next.js sidecar via the
// existing /api/workspaces POST, so we don't duplicate registry logic in
// Rust — this command is just the native chooser.
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<PickedFolder>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path);
    });
    let chosen = rx.await.map_err(|e| e.to_string())?;
    let Some(path_buf) = chosen else {
        return Ok(None);
    };
    let path = path_buf.into_path().map_err(|e| e.to_string())?;
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Workspace".to_string());
    Ok(Some(PickedFolder {
        path: path.to_string_lossy().to_string(),
        name,
    }))
}
