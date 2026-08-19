//! Runtime settings, persisted to `~/.artemis/settings.json`.

use std::fs;
use std::path::PathBuf;

use crate::scanner::{executable_at, home_dir};
use crate::types::{AssetHealth, HarnessAsset, HarnessDiscoverySource, RuntimeSettings};

pub fn settings_path() -> PathBuf {
    std::env::var_os("ARTEMIS_SETTINGS_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".artemis/settings.json"))
}

/// A malformed settings file reads as defaults rather than an error: settings
/// are an enhancement, and refusing to start over one is the wrong trade.
pub fn read() -> RuntimeSettings {
    let path = settings_path();
    let Ok(raw) = fs::read_to_string(&path) else {
        return RuntimeSettings::default();
    };
    serde_json::from_str::<RuntimeSettings>(&raw)
        .map(RuntimeSettings::sanitized)
        .unwrap_or_default()
}

pub fn write(settings: RuntimeSettings) -> Result<RuntimeSettings, String> {
    let sanitized = settings.sanitized();
    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("create {parent:?}: {error}"))?;
    }
    let body = serde_json::to_string_pretty(&sanitized)
        .map_err(|error| format!("serialize settings: {error}"))?;
    fs::write(&path, body).map_err(|error| format!("write {path:?}: {error}"))?;
    Ok(sanitized)
}

/// Where to scan for projects and workspace config mentions.
///
/// Precedence: env override, then the configured setting, then the user's home
/// directory. Home is a deliberately conservative default: the walk is bounded,
/// so a large root degrades into partial results rather than a hang.
pub fn scan_root(settings: &RuntimeSettings) -> PathBuf {
    if let Some(from_env) = std::env::var_os("ARTEMIS_SCAN_ROOT") {
        return PathBuf::from(from_env);
    }
    if let Some(configured) = &settings.scan_root {
        let path = PathBuf::from(configured);
        if path.is_dir() {
            return path;
        }
    }
    home_dir()
}

/// Apply the configured opencode executable over whatever the scan found.
/// Mirrors `applyRuntimeSettingsToHarnesses` in the TypeScript host.
pub fn apply_to_harnesses(
    harnesses: Vec<HarnessAsset>,
    settings: &RuntimeSettings,
) -> Vec<HarnessAsset> {
    let Some(configured) = &settings.opencode_executable_path else {
        return harnesses;
    };
    harnesses
        .into_iter()
        .map(|harness| {
            if harness.id != "opencode" {
                return harness;
            }
            HarnessAsset {
                health: if executable_at(configured) {
                    AssetHealth::Ready
                } else {
                    AssetHealth::NeedsSetup
                },
                executable_path: Some(configured.clone()),
                source: HarnessDiscoverySource::Settings,
                ..harness
            }
        })
        .collect()
}
