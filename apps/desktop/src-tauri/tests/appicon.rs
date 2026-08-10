//! The app-icon catalog.
//!
//! Swapping the icon at runtime changes the *dock* icon of the running app. The
//! bundled icon — what Finder shows, and what appears before the app starts —
//! is baked at build time and cannot be changed from inside. The catalog and
//! the persistence are what is testable here; the AppKit call is not, so it is
//! kept to a few lines behind this.

use artemis_host::appicon;

#[test]
fn every_variant_is_listed() {
    let icons = appicon::catalog();
    assert_eq!(icons.len(), 12, "twelve variants were produced");
}

#[test]
fn the_default_is_deep_sea_and_comes_first() {
    let icons = appicon::catalog();
    assert_eq!(appicon::DEFAULT_ICON_ID, "deep-sea-gradient");
    assert_eq!(
        icons[0].id, "deep-sea-gradient",
        "the bundled icon should lead the list rather than hide in it"
    );
}

#[test]
fn ids_are_unique_and_filesystem_safe() {
    let icons = appicon::catalog();
    let mut seen = std::collections::HashSet::new();
    for icon in &icons {
        assert!(seen.insert(icon.id), "duplicate id: {}", icon.id);
        assert!(
            icon.id
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
            "id reaches the filesystem: {}",
            icon.id
        );
    }
}

#[test]
fn every_variant_has_a_readable_label() {
    for icon in appicon::catalog() {
        assert!(!icon.label.trim().is_empty(), "{} has no label", icon.id);
        // "Deep Sea Gradient", not "deep-sea-gradient".
        assert!(
            icon.label.chars().next().unwrap().is_uppercase(),
            "{} should be titled for display, got {:?}",
            icon.id,
            icon.label
        );
    }
}

/// A catalog entry naming a file that is not shipped would fail only when
/// someone clicked it.
#[test]
fn every_variant_has_a_file_on_disk() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("icons/variants");
    for icon in appicon::catalog() {
        let path = root.join(format!("{}.png", icon.id));
        assert!(path.is_file(), "missing artwork for {}: {path:?}", icon.id);
    }
}

#[test]
fn an_unknown_id_is_rejected_rather_than_guessed_at() {
    assert!(appicon::is_known("deep-sea-gradient"));
    assert!(!appicon::is_known("no-such-icon"));
    // Path traversal through the id must not resolve to a real file.
    assert!(!appicon::is_known("../../../etc/passwd"));
}

#[test]
fn resolving_falls_back_to_the_default_for_an_unknown_id() {
    assert_eq!(appicon::resolve_id(None), appicon::DEFAULT_ICON_ID);
    assert_eq!(appicon::resolve_id(Some("nope")), appicon::DEFAULT_ICON_ID);
    assert_eq!(
        appicon::resolve_id(Some("frost-weaver-ice")),
        "frost-weaver-ice"
    );
}
