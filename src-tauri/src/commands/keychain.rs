use keyring::Entry;

const SERVICE: &str = "com.alexander.birdbrain";

// The renderer calls these when the Settings panel stores an API key.
// We key every secret by the env var name so the Next.js sidecar's
// `resolveSecret(envVarName)` path stays identical across dev and desktop.

#[tauri::command]
pub fn keychain_get(env_var: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, &env_var).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn keychain_set(env_var: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &env_var).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn keychain_clear(env_var: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &env_var).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
