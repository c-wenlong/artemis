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
pub fn vetted(relative: &str) -> Result<String, String> {
    let trimmed = relative.trim();
    if trimmed.is_empty() {
        return Err("No file path was given.".to_string());
    }

    let candidate = Path::new(trimmed);
    if candidate.is_absolute() {
        return Err(format!("Refusing an absolute path: {trimmed}"));
    }
    if candidate
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(format!(
            "Refusing a path that leaves the workspace: {trimmed}"
        ));
    }
    Ok(trimmed.to_string())
}
