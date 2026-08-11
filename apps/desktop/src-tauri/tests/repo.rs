//! What has to be true before this repository can be public.
//!
//! Two kinds of check, and the first matters more.
//!
//! **Nothing personal ships.** This was built on one person's machine, against
//! their real projects, with fixtures captured from real runs. Absolute paths,
//! home directories, project names and session ids all found their way in.
//! Publishing is irreversible — a git history is forever — so this runs over
//! every tracked file rather than over a list someone remembered to update.
//!
//! **A stranger can get started.** The exit criterion for M14 is that someone
//! who has never seen this can build, run and land a change. Documentation rots
//! quietly, so the pieces that make that possible are asserted rather than
//! assumed.

use std::path::{Path, PathBuf};
use std::process::Command;

fn repo_root() -> PathBuf {
    // tests/ -> src-tauri -> desktop -> apps -> repo
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("repo root")
        .to_path_buf()
}

/// Every file git actually tracks. Untracked scratch files are not published,
/// and `node_modules` and `target` are not ours to police.
fn tracked_files() -> Vec<PathBuf> {
    let root = repo_root();
    let output = Command::new("git")
        .args(["ls-files", "-z"])
        .current_dir(&root)
        .output()
        .expect("git ls-files");
    assert!(output.status.success(), "git ls-files failed");

    String::from_utf8_lossy(&output.stdout)
        .split('\0')
        .filter(|name| !name.is_empty())
        .map(|name| root.join(name))
        .collect()
}

fn text_of(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    // Binary files (icons) have nothing to leak in text form.
    if bytes.contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

fn read(relative: &str) -> String {
    let path = repo_root().join(relative);
    std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("{relative} is missing"))
}

// ------------------------------------------------------- nothing personal

/// A home directory in a tracked file names its owner, and often their
/// employer's projects with it.
/// Placeholders that are meant to be read as "your name here". Documentation
/// and fixtures need *a* home directory to show, and refusing every one of
/// them would only push people towards a real one.
const PLACEHOLDER_HOMES: &[&str] = &[
    "/Users/you",
    "/Users/example",
    "/home/user",
    "/home/example",
    r"C:\Users\you",
];

fn is_placeholder(line: &str) -> bool {
    PLACEHOLDER_HOMES
        .iter()
        .any(|placeholder| line.contains(placeholder))
}

#[test]
fn no_home_directory_is_committed() {
    let mut offenders = Vec::new();
    for path in tracked_files() {
        // This test necessarily contains the patterns it looks for.
        if path.ends_with("repo.rs") {
            continue;
        }
        let Some(text) = text_of(&path) else { continue };
        for (number, line) in text.lines().enumerate() {
            if is_placeholder(line) {
                continue;
            }
            if line.contains("/Users/") || line.contains("/home/") || line.contains(r"C:\Users\") {
                offenders.push(format!(
                    "{}:{}",
                    path.strip_prefix(repo_root()).unwrap_or(&path).display(),
                    number + 1
                ));
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "a real home directory would be published here:\n  {}",
        offenders.join("\n  ")
    );
}

/// Credentials do not belong in a repository at any visibility, and become
/// unrecoverable mistakes in a public one.
#[test]
fn nothing_that_looks_like_a_credential_is_committed() {
    // Prefixes published by the issuers themselves, so these are not guesses.
    let markers = [
        "BEGIN RSA PRIVATE KEY",
        "BEGIN OPENSSH PRIVATE KEY",
        "BEGIN PRIVATE KEY",
        "sk-ant-",
        "ghp_",
        "github_pat_",
        "AKIA",
        "xoxb-",
    ];

    let mut offenders = Vec::new();
    for path in tracked_files() {
        if path.ends_with("repo.rs") {
            continue;
        }
        let Some(text) = text_of(&path) else { continue };
        for marker in markers {
            if text.contains(marker) {
                offenders.push(format!(
                    "{}: {marker}",
                    path.strip_prefix(repo_root()).unwrap_or(&path).display()
                ));
            }
        }
    }
    assert!(offenders.is_empty(), "{offenders:?}");
}

/// The account name of whoever is running this.
///
/// Derived rather than hardcoded, for two reasons: a test that names one
/// person only protects that person, and writing the name into a file that is
/// about to be published would be the very leak being tested for.
fn current_username() -> Option<String> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    let name = Path::new(&home).file_name()?.to_string_lossy().into_owned();
    (name.len() > 2).then_some(name)
}

/// Catches the forms a path takes after it has been mangled.
///
/// `/Users/someone` is the obvious one and the easy one to scrub. The form that
/// actually survived into a fixture here was `-Users-someone-Desktop-…`, a
/// flattened temp-directory name, which contains the username but not a single
/// slash. Searching for the name itself catches every shape of it.
#[test]
fn no_tracked_file_names_the_person_who_built_it() {
    let Some(username) = current_username() else {
        eprintln!("no home directory to derive a username from; skipping");
        return;
    };

    let mut offenders = Vec::new();
    for path in tracked_files() {
        if path.ends_with("repo.rs") {
            continue;
        }
        let Some(text) = text_of(&path) else { continue };
        if text.contains(&username) {
            offenders.push(
                path.strip_prefix(repo_root())
                    .unwrap_or(&path)
                    .display()
                    .to_string(),
            );
        }
    }
    assert!(
        offenders.is_empty(),
        "these name the current user and would be published:\n  {}",
        offenders.join("\n  ")
    );
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            found.extend(walk(&path));
        } else {
            found.push(path);
        }
    }
    found
}

// ------------------------------------------------ a stranger can start

#[test]
fn the_repository_says_how_it_is_licensed() {
    let license = read("LICENSE");
    assert!(
        license.contains("MIT") || license.contains("Apache") || license.contains("Mozilla"),
        "LICENSE does not name a license anyone will recognise"
    );
    assert!(
        license.contains("2026"),
        "a licence with no year is a licence with no start"
    );
}

#[test]
fn the_readme_says_how_to_build_and_run() {
    let readme = read("README.md").to_lowercase();
    for expected in ["pnpm install", "pnpm dev", "requirements", "opencode"] {
        assert!(
            readme.contains(expected),
            "README never mentions {expected:?}"
        );
    }
}

/// A contributor's first question is how to run the tests, and their second is
/// what will be checked before their change is merged.
#[test]
fn contributing_says_how_to_run_the_checks() {
    let contributing = read("CONTRIBUTING.md").to_lowercase();
    for expected in ["pnpm test", "cargo test", "clippy", "cargo fmt"] {
        assert!(
            contributing.contains(expected),
            "CONTRIBUTING never mentions {expected:?}"
        );
    }
}

#[test]
fn there_is_somewhere_to_report_a_problem() {
    let templates = repo_root().join(".github/ISSUE_TEMPLATE");
    assert!(templates.is_dir(), "no issue templates");
    assert!(
        walk(&templates).len() >= 2,
        "a bug and a feature request are different conversations"
    );
    assert!(repo_root()
        .join(".github/pull_request_template.md")
        .is_file());
}

/// The roadmap is the honest part of this repository: it records what is done,
/// what is deliberately not, and what is blocked. Linking it is the point.
#[test]
fn the_readme_points_at_the_roadmap_and_the_architecture() {
    let readme = read("README.md");
    assert!(readme.contains("MILESTONES.md"), "no roadmap link");
    assert!(readme.contains("ARCHITECTURE.md"), "no architecture link");
}

#[test]
fn the_architecture_document_covers_both_halves_of_the_app() {
    let architecture = read("docs/ARCHITECTURE.md").to_lowercase();
    for expected in ["rust", "tauri", "adapter", "event log", "worktree"] {
        assert!(
            architecture.contains(expected),
            "ARCHITECTURE never mentions {expected:?}"
        );
    }
}
