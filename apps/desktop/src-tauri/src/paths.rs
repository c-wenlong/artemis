//! Workspace-relative paths that arrive from a model.
//!
//! Both a patch to reverse and a citation to open name a file chosen by an
//! agent, from prose or a tool call. Neither can be allowed to address anything
//! outside the workspace, and both want the same answer, so the check lives in
//! one place rather than being written twice slightly differently.

use std::path::{Component, Path, PathBuf};

/// Validate a workspace-relative path and join it to the workspace.
///
/// Rejects absolute paths and anything containing `..`. The `..` check is on
/// the components rather than the string, so `a/../../x` is caught even though
/// it contains no leading `..`.
pub fn resolve_in_workspace(workspace: &Path, relative: &str) -> Result<PathBuf, String> {
    Ok(workspace.join(vetted(relative)?))
}

/// The vetted path itself, for callers that need the relative form.
///
/// **Both platforms' rules are applied on every platform**, because the string
/// comes from a model rather than from the host. `std::path` only knows the
/// rules of the machine it is compiled for, and each one is blind to an escape
/// the other sees:
///
/// - `/etc/passwd` is **not absolute on Windows** (it has no drive letter) so
///   `is_absolute()` passed it. And `join` there does not append a rooted path,
///   it *replaces* the root: `C:\workspace` + `/etc/passwd` is `C:\etc\passwd`.
///   That is outside the workspace, on a path an agent chose. CI found it.
/// - `C:\Windows\...` is one ordinary filename on Unix, and `a\..\..\x` has no
///   `..` *component* there, because a backslash is not a separator.
///
/// Separators are normalised before the component walk so `..` is caught in
/// either notation. A Unix filename may legitimately contain a backslash and
/// will be refused by this; that trade is deliberate: refusing an unusual name
/// costs a reader one click, and accepting a traversal costs the file.
pub fn vetted(relative: &str) -> Result<String, String> {
    let trimmed = relative.trim();
    if trimmed.is_empty() {
        return Err("No file path was given.".to_string());
    }

    let absolute = || Err(format!("Refusing an absolute path: {trimmed}"));
    let normalised = trimmed.replace('\\', "/");
    let candidate = Path::new(normalised.as_str());

    // Rooted in either notation: `/x` on Unix, and on Windows the driveless
    // root that `is_absolute` reports as relative.
    if candidate.is_absolute() || normalised.starts_with('/') {
        return absolute();
    }
    // Drive-qualified: `C:\x` and the equally absolute `C:x`.
    if matches!(normalised.as_bytes(), [b'A'..=b'Z' | b'a'..=b'z', b':', ..]) {
        return absolute();
    }
    if candidate.components().any(|part| {
        matches!(
            part,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(format!(
            "Refusing a path that leaves the workspace: {trimmed}"
        ));
    }
    Ok(trimmed.to_string())
}
