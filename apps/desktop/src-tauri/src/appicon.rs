//! App icon variants.
//!
//! What this can and cannot do is worth being precise about, because the
//! difference is invisible from the settings panel:
//!
//! - **Can**: change the icon of the *running* app — the dock, Cmd-Tab, the
//!   window menu. Applied immediately and re-applied on the next launch.
//! - **Cannot**: change the bundled icon, which is what Finder shows and what
//!   appears in the dock before the app has started. That is baked into the
//!   `.app` at build time.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIcon {
    pub id: &'static str,
    pub label: &'static str,
}

/// The bundled icon. Leads the catalog so the list opens on what is currently
/// shipped rather than burying it; the rest follow alphabetically.
pub const DEFAULT_ICON_ID: &str = "olympian-marble";

pub fn catalog() -> Vec<AppIcon> {
    vec![
        AppIcon {
            id: "olympian-marble",
            label: "Olympian",
        },
        AppIcon {
            id: "arcane-sentinel-obsidian",
            label: "Arcane Sentinel",
        },
        AppIcon {
            id: "auroral-archer-frost",
            label: "Auroral Archer",
        },
        AppIcon {
            id: "celestial-emissary-stained-glass",
            label: "Celestial Emissary",
        },
        AppIcon {
            id: "chrome-sentinel-cybernetic",
            label: "Chrome Sentinel",
        },
        AppIcon {
            id: "chronos-archer-clockwork",
            label: "Chronos Archer",
        },
        AppIcon {
            id: "desert-nomad-sandstone",
            label: "Desert Nomad",
        },
        AppIcon {
            id: "frost-weaver-ice",
            label: "Frost Weaver",
        },
        AppIcon {
            id: "galactic-vanguard-nebula",
            label: "Galactic Vanguard",
        },
        // The source art for this one carries the same "Galactic Vanguard
        // (Nebula)" caption as the entry above on a different picture. Named
        // for what distinguishes it rather than shipped as a second identical
        // label.
        AppIcon {
            id: "galactic-vanguard-spiral",
            label: "Galactic Vanguard (Spiral)",
        },
        AppIcon {
            id: "solar-sentinel-sunstone",
            label: "Solar Sentinel",
        },
        AppIcon {
            id: "verdant-druid-moss",
            label: "Verdant Druid",
        },
    ]
}

pub fn is_known(id: &str) -> bool {
    catalog().iter().any(|icon| icon.id == id)
}

/// The stored id if it names a real variant, else the default.
///
/// A stored id is user data that reaches a file path, and a build that drops a
/// variant would otherwise leave someone stuck on a missing one.
pub fn resolve_id(stored: Option<&str>) -> &str {
    match stored {
        Some(id) if is_known(id) => catalog()
            .into_iter()
            .find(|icon| icon.id == id)
            .map(|icon| icon.id)
            .unwrap_or(DEFAULT_ICON_ID),
        _ => DEFAULT_ICON_ID,
    }
}

/// Set the dock icon of the running application.
///
/// macOS only. The image has to be handed to AppKit on the main thread, so the
/// caller is responsible for arriving there — see `set_app_icon` in `lib.rs`.
#[cfg(target_os = "macos")]
pub fn apply_to_running_app(png: &[u8]) -> Result<(), String> {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let Some(mtm) = MainThreadMarker::new() else {
        return Err("The app icon can only be set from the main thread.".to_string());
    };
    let data = NSData::with_bytes(png);
    let image = NSImage::initWithData(NSImage::alloc(), &data)
        .ok_or_else(|| "Could not decode the icon image.".to_string())?;

    let app = NSApplication::sharedApplication(mtm);
    unsafe { app.setApplicationIconImage(Some(&image)) };
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn apply_to_running_app(_png: &[u8]) -> Result<(), String> {
    // Windows and Linux take the icon from the window and the desktop entry,
    // neither of which is swappable the same way. Silently doing nothing is
    // better than an error the user cannot act on.
    Ok(())
}
