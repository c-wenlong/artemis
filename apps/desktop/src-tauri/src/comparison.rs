//! One prompt, several harnesses, one kept answer.
//!
//! The comparison is why Artemis exists rather than any single-agent shell: ask
//! three agents the same question, read the three diffs beside each other, keep
//! the one that is right. Nothing else in the tool does this across vendors.
//!
//! Mechanically it is orchestration of things that already exist — a git
//! worktree per harness from M5, a chat session per worktree from M7, an adapter
//! per harness from M11. This module owns only what none of them can know: that
//! these runs belong together, that they must not share a directory, and which
//! of them survives.
//!
//! **Isolation is the whole experiment.** Two harnesses editing one checkout
//! overwrite each other and the comparison means nothing, so every entry gets
//! its own worktree branched from the same commit.
//!
//! **Resolution is the one place Artemis destroys work on purpose.** Discarding
//! the losers throws away uncommitted changes an agent spent real time and money
//! producing, and there is no undo. So it refuses anything it does not
//! recognise, and it only ever touches worktrees in this comparison.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::git;

/// One harness's place in a comparison, before anything has been created.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedEntry {
    pub harness_id: String,
    pub branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonPlan {
    pub id: String,
    pub project_id: String,
    pub prompt: String,
    pub entries: Vec<PlannedEntry>,
}

/// One harness's place in a comparison that has been started.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonEntry {
    pub harness_id: String,
    pub branch: String,
    /// Stable id for this entry's workspace, and what names the winner.
    pub workspace_id: String,
    /// `None` when the worktree could not be created — see `error`.
    pub path: Option<PathBuf>,
    /// Why this harness has nowhere to run. The others carry on regardless.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    pub id: String,
    pub project_id: String,
    pub prompt: String,
    pub entries: Vec<ComparisonEntry>,
}

/// A branch-safe slug of the prompt, so a branch says what was asked.
///
/// git refuses a great many characters in a ref name, and a prompt is arbitrary
/// user text, so this keeps only what is unambiguously safe rather than trying
/// to escape the rest.
fn slug(prompt: &str) -> String {
    let mut out = String::new();
    let mut last_dash = true; // leading dashes are dropped
    for ch in prompt.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
        if out.len() >= 32 {
            break;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        // A prompt of pure punctuation still needs somewhere to run.
        "run".to_string()
    } else {
        trimmed
    }
}

/// Plan a comparison. Deterministic: the same prompt and harnesses plan the
/// same branches, which is what makes a re-run recognisable rather than a pile
/// of near-duplicates.
pub fn plan(
    project_id: &str,
    prompt: &str,
    harness_ids: &[String],
) -> Result<ComparisonPlan, String> {
    if prompt.trim().is_empty() {
        return Err("A comparison needs a prompt.".to_string());
    }

    // Asking one harness twice is asking once; order is preserved so the tabs
    // appear in the order they were chosen.
    let mut seen = std::collections::HashSet::new();
    let unique: Vec<&String> = harness_ids
        .iter()
        .filter(|id| !id.trim().is_empty() && seen.insert(id.trim().to_lowercase()))
        .collect();

    if unique.is_empty() {
        return Err("A comparison needs at least one harness.".to_string());
    }

    let topic = slug(prompt);
    Ok(ComparisonPlan {
        id: format!("cmp-{topic}"),
        project_id: project_id.to_string(),
        prompt: prompt.trim().to_string(),
        entries: unique
            .into_iter()
            .map(|harness_id| PlannedEntry {
                branch: format!("compare/{topic}/{}", slug(harness_id)),
                harness_id: harness_id.trim().to_string(),
            })
            .collect(),
    })
}

/// Create a worktree per harness, all branched from the repository's head.
///
/// A harness whose worktree cannot be created keeps its place in the comparison
/// with an `error` rather than vanishing from it: the user chose it, and the
/// answer "this one could not start" is information.
pub fn start_in(repo: &Path, worktree_root: &Path, plan: &ComparisonPlan) -> Comparison {
    let entries = plan
        .entries
        .iter()
        .map(|planned| {
            let workspace_id = format!("{}-{}", plan.id, slug(&planned.harness_id));
            match git::create_worktree(repo, worktree_root, &planned.branch) {
                Ok(worktree) => ComparisonEntry {
                    harness_id: planned.harness_id.clone(),
                    branch: planned.branch.clone(),
                    workspace_id,
                    path: Some(worktree.path),
                    error: None,
                },
                Err(error) => ComparisonEntry {
                    harness_id: planned.harness_id.clone(),
                    branch: planned.branch.clone(),
                    workspace_id,
                    path: None,
                    error: Some(error),
                },
            }
        })
        .collect();

    Comparison {
        id: plan.id.clone(),
        project_id: plan.project_id.clone(),
        prompt: plan.prompt.clone(),
        entries,
    }
}

/// Keep one entry's worktree and discard the others.
///
/// `force` is not a parameter, and that is deliberate. A losing entry always has
/// uncommitted changes — that is what an agent produces — so requiring a flag
/// would mean the operation never works without it, which teaches the caller to
/// pass it blindly. Instead the guard is the winner: an id this comparison does
/// not contain is refused, and nothing outside the comparison is ever touched.
pub fn resolve_in(repo: &Path, comparison: &Comparison, winner: &str) -> Result<(), String> {
    if !comparison
        .entries
        .iter()
        .any(|entry| entry.workspace_id == winner)
    {
        return Err(format!(
            "{winner} is not part of this comparison, so nothing was discarded."
        ));
    }

    let mut failures = Vec::new();
    for entry in &comparison.entries {
        if entry.workspace_id == winner {
            continue;
        }
        // An entry that never got a worktree has nothing to discard.
        let Some(path) = &entry.path else { continue };
        if let Err(error) = git::remove_worktree(repo, path, true) {
            failures.push(format!("{}: {error}", entry.harness_id));
        }
    }

    if failures.is_empty() {
        Ok(())
    } else {
        // The winner is already safe by this point; report what would not go.
        Err(format!(
            "Some runs could not be discarded — {}",
            failures.join("; ")
        ))
    }
}

/// Discard every worktree in a comparison. Used when none of the answers is
/// worth keeping.
pub fn abandon_in(repo: &Path, comparison: &Comparison) -> Result<(), String> {
    let mut failures = Vec::new();
    for entry in &comparison.entries {
        let Some(path) = &entry.path else { continue };
        if let Err(error) = git::remove_worktree(repo, path, true) {
            failures.push(format!("{}: {error}", entry.harness_id));
        }
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Some runs could not be discarded — {}",
            failures.join("; ")
        ))
    }
}
