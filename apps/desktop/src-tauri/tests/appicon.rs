//! The app-icon catalog.
//!
//! Swapping the icon at runtime changes the *dock* icon of the running app. The
//! bundled icon: what Finder shows, and what appears before the app starts:
//! is baked at build time and cannot be changed from inside. The catalog and
//! the persistence are what is testable here; the AppKit call is not, so it is
//! kept to a few lines behind this.

use artemis_host::appicon;

#[test]
fn every_variant_is_listed() {
    let icons = appicon::catalog();
    assert_eq!(icons.len(), 11, "eleven variants ship");
}

#[test]
fn the_default_is_olympian_and_comes_first() {
    let icons = appicon::catalog();
    assert_eq!(appicon::DEFAULT_ICON_ID, "olympian-marble");
    assert_eq!(
        icons[0].id, "olympian-marble",
        "the bundled icon should lead the list rather than hide in it"
    );
}

/// The source images were not uniquely captioned: two arrived as "Galactic
/// Vanguard (Nebula)" on different artwork, so a duplicate label is a real
/// way for this catalog to go wrong rather than a theoretical one.
#[test]
fn labels_are_unique() {
    let icons = appicon::catalog();
    let mut seen = std::collections::HashSet::new();
    for icon in &icons {
        assert!(seen.insert(icon.label), "duplicate label: {}", icon.label);
    }
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
        // "Solar Sentinel", not "solar-sentinel-sunstone".
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

/// The opaque bounding box of a PNG, as (left, top, width, height).
fn opaque_box(path: &std::path::Path) -> (u32, u32, u32, u32, u32) {
    let decoder = png::Decoder::new(std::fs::File::open(path).expect("open png"));
    let mut reader = decoder.read_info().expect("png header");
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).expect("png pixels");
    assert_eq!(
        info.color_type,
        png::ColorType::Rgba,
        "{path:?} has no alpha channel, so it cannot carry the icon margin"
    );

    let (w, h) = (info.width, info.height);
    let (mut l, mut t, mut r, mut b) = (w, h, 0u32, 0u32);
    for y in 0..h {
        for x in 0..w {
            let alpha = buf[((y * w + x) * 4 + 3) as usize];
            if alpha > 64 {
                l = l.min(x);
                t = t.min(y);
                r = r.max(x);
                b = b.max(y);
            }
        }
    }
    (l, t, r - l + 1, b - t + 1, w)
}

/// macOS does not draw app icons edge to edge. On a 1024 canvas the rounded
/// square occupies 824x824 at +100+100: measured off Spotify and Telegram,
/// both exact, and artwork that fills its canvas renders about a quarter
/// larger than every neighbour in the dock. That shipped once already.
#[test]
fn variants_sit_on_apples_icon_grid() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("icons/variants");
    for icon in appicon::catalog() {
        let path = root.join(format!("{}.png", icon.id));
        let (left, top, w, h, canvas) = opaque_box(&path);

        let ratio = w as f32 / canvas as f32;
        assert!(
            (0.78..=0.83).contains(&ratio),
            "{} fills {:.3} of its canvas; Apple's grid is 824/1024 = 0.805",
            icon.id,
            ratio
        );
        // Centred, give or take the odd row of drop shadow.
        let right = canvas - (left + w);
        let bottom = canvas - (top + h);
        assert!(
            left.abs_diff(right) <= 4 && top.abs_diff(bottom) <= 12,
            "{} is off centre: margins l={left} r={right} t={top} b={bottom}",
            icon.id
        );
    }
}

/// The other direction of the check above. Replacing the icon set is a matter
/// of swapping a directory, and a leftover from the previous set would ship in
/// the bundle forever without anything noticing.
#[test]
fn no_artwork_ships_without_a_catalog_entry() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("icons/variants");
    let known: std::collections::HashSet<&str> = appicon::catalog().iter().map(|i| i.id).collect();
    for entry in std::fs::read_dir(&root).expect("variants directory") {
        let path = entry.expect("readable entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("png") {
            continue;
        }
        let stem = path.file_stem().unwrap().to_str().unwrap();
        assert!(known.contains(stem), "orphaned artwork: {stem}");
    }
}

#[test]
fn an_unknown_id_is_rejected_rather_than_guessed_at() {
    assert!(appicon::is_known("olympian-marble"));
    assert!(!appicon::is_known("no-such-icon"));
    // The previous icon set. A settings row still naming one of these has to
    // fall through to the default rather than look for artwork that is gone.
    assert!(!appicon::is_known("deep-sea-gradient"));
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
