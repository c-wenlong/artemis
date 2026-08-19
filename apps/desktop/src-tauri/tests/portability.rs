//! Assumptions that only hold on the machine this was written on.
//!
//! Artemis was built on macOS, and the scanner picked up three POSIX habits
//! that would each independently make it find no harnesses at all on Windows:
//! splitting `PATH` on `:` (which shreds `C:\…`), looking for a bare `opencode`
//! rather than `opencode.exe`, and treating `/` as the only path separator.
//!
//! Most of these run on any platform because the logic under test is pure.
//! Where behaviour genuinely differs, the test says which platform it is
//! asserting for rather than skipping quietly.

use artemis_host::scanner;
use std::path::{Path, PathBuf};

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("artemis-portability-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

/// Create a file that the platform agrees is runnable.
fn executable(dir: &Path, name: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, "#!/bin/sh\necho hi\n").expect("write");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    }
    path
}

// ------------------------------------------------------------------- PATH

/// `split(':')` turns `C:\tools;C:\bin` into four nonsense fragments, so a
/// Windows user's PATH would contribute nothing but broken directories.
#[test]
fn path_is_split_the_way_the_platform_writes_it() {
    let dir = temp("path_split");
    let other = dir.join("second");
    std::fs::create_dir_all(&other).expect("second dir");

    // Built with the platform's own separator, as std does it.
    let joined = std::env::join_paths([dir.clone(), other.clone()]).expect("join");
    let parsed: Vec<PathBuf> = scanner::split_path_env(&joined.to_string_lossy()).collect();

    assert!(parsed.contains(&dir), "{parsed:?}");
    assert!(parsed.contains(&other), "{parsed:?}");
}

#[cfg(windows)]
#[test]
fn a_windows_drive_letter_survives_splitting() {
    let parsed: Vec<PathBuf> = scanner::split_path_env(r"C:\tools;C:\bin").collect();
    assert_eq!(
        parsed,
        vec![PathBuf::from(r"C:\tools"), PathBuf::from(r"C:\bin")]
    );
}

#[cfg(unix)]
#[test]
fn a_posix_path_still_splits_on_colons() {
    let parsed: Vec<PathBuf> = scanner::split_path_env("/usr/bin:/usr/local/bin").collect();
    assert_eq!(
        parsed,
        vec![PathBuf::from("/usr/bin"), PathBuf::from("/usr/local/bin")]
    );
}

#[test]
fn an_empty_path_entry_is_not_the_current_directory() {
    // A trailing separator yields an empty entry, which as a PathBuf means
    // "here", and resolving harnesses out of the working directory is how a
    // repository gets to choose which binary runs.
    let parsed: Vec<PathBuf> = scanner::split_path_env("").collect();
    assert!(parsed.iter().all(|entry| !entry.as_os_str().is_empty()));
}

// ------------------------------------------------------------- executables

/// Windows stores runnability in the extension, and nothing on PATH is called
/// plain `opencode` there.
#[test]
fn a_command_is_tried_with_the_platform_extensions() {
    let variants: Vec<String> = scanner::executable_names("opencode").collect();
    assert!(variants.contains(&"opencode".to_string()), "{variants:?}");

    if cfg!(windows) {
        assert!(
            variants
                .iter()
                .any(|name| name.eq_ignore_ascii_case("opencode.exe")),
            "windows needs the extension: {variants:?}"
        );
    } else {
        assert_eq!(variants.len(), 1, "no extensions to try on unix");
    }
}

#[test]
fn a_command_that_already_has_an_extension_is_left_alone() {
    let variants: Vec<String> = scanner::executable_names("opencode.exe").collect();
    assert_eq!(variants[0], "opencode.exe");
    assert!(
        !variants.iter().any(|name| name.ends_with(".exe.exe")),
        "{variants:?}"
    );
}

#[test]
fn resolving_finds_a_real_file_on_a_synthetic_path() {
    let dir = temp("resolve");
    executable(
        &dir,
        if cfg!(windows) {
            "widget.exe"
        } else {
            "widget"
        },
    );

    let found = scanner::resolve_in_dirs("widget", std::slice::from_ref(&dir));
    assert!(found.is_some(), "widget should have been found in {dir:?}");
    assert!(found.unwrap().contains("widget"));
}

#[test]
fn resolving_a_name_that_is_not_there_returns_nothing() {
    let dir = temp("resolve_missing");
    assert!(scanner::resolve_in_dirs("no-such-binary", &[dir]).is_none());
}

// ------------------------------------------------------------------- paths

/// `C:\tools\opencode.exe` is a path, and treating it as a bare command name
/// sends the scanner hunting for it on PATH instead of using it.
#[test]
fn both_separators_mark_a_command_as_a_path() {
    assert!(scanner::looks_like_path("/usr/local/bin/opencode"));
    assert!(scanner::looks_like_path(r"C:\tools\opencode.exe"));
    assert!(scanner::looks_like_path("./opencode"));
    assert!(!scanner::looks_like_path("opencode"));
    assert!(!scanner::looks_like_path(""));
}

#[test]
fn the_home_directory_is_found_on_either_platform() {
    let home = scanner::home_dir();
    assert!(
        home.as_os_str().len() > 1,
        "a bare root is a fallback, not a home: {home:?}"
    );
}

/// The extra bin directories are POSIX conventions. They must not be *harmful*
/// elsewhere: a non-existent directory is skipped, not an error.
#[test]
fn nonexistent_extra_directories_are_simply_skipped() {
    let dirs = scanner::search_dirs();
    assert!(
        dirs.iter().all(|dir| dir.is_dir()),
        "a directory that does not exist should not be searched"
    );
}
