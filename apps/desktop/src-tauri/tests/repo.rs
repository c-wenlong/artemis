//! What has to be true before this repository can be public.
//!
//! Two kinds of check, and the first matters more.
//!
//! **Nothing personal ships.** This was built on one person's machine, against
//! their real projects, with fixtures captured from real runs. Absolute paths,
//! home directories, project names and session ids all found their way in.
//! Publishing is irreversible (a git history is forever) so this runs over
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
    // Binary files are not read as text. That is a real blind spot, not a
    // statement that binaries are safe: a compiled `.pyc` carried the whole
    // set of personal data past every check here. What keeps the spot narrow is
    // that the only binaries tracked are icons and screenshots, and
    // `no_compiled_bytecode_is_tracked` keeps it that way.
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

/// True when `marker` is followed by something that could be an account name.
///
/// Prose mentions the prefix too: this file's own commentary and the roadmap
/// entry describing this check both contain a bare `/Users/`. Requiring a name
/// after the separator keeps those out without weakening the check: every real
/// leak found so far had one.
fn names_a_directory_after(line: &str, marker: &str) -> bool {
    line.match_indices(marker).any(|(at, _)| {
        line[at + marker.len()..]
            .chars()
            .next()
            .is_some_and(|next| next.is_alphanumeric())
    })
}

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
            if [r"/Users/", r"/home/", r"C:\Users\"]
                .iter()
                .any(|marker| names_a_directory_after(line, marker))
            {
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

/// Account names that identify a machine rather than a person.
///
/// A CI runner's home directory is `/home/runner`, so the derived username is
/// `runner`, which appears legitimately in `.github/workflows/ci.yml` and in
/// lockfile paths, and made this test fail on all three platforms the first
/// time CI was ever able to run. These names are not personal data by
/// definition, so matching them says nothing.
///
/// Listed explicitly rather than skipping the whole check under `CI`: the check
/// is worth most exactly where the repository gets published from.
const SERVICE_ACCOUNTS: [&str; 7] = [
    "runner",
    "root",
    "ubuntu",
    "runneradmin",
    "administrator",
    "circleci",
    "vsts",
];

/// The account name of whoever is running this.
///
/// Derived rather than hardcoded, for two reasons: a test that names one
/// person only protects that person, and writing the name into a file that is
/// about to be published would be the very leak being tested for.
fn current_username() -> Option<String> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    let name = Path::new(&home).file_name()?.to_string_lossy().into_owned();
    if SERVICE_ACCOUNTS
        .iter()
        .any(|account| account.eq_ignore_ascii_case(&name))
    {
        return None;
    }
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

/// Captured fixtures carry more than the paths they were captured under.
///
/// The Quiver session-cache fixture is a trimmed copy of a real cache. Scrubbing
/// its absolute paths left the *basenames* and the session *titles* intact:
/// real project names, course codes, and in one path a string shaped exactly
/// like a student identifier. None of that is a credential,
/// and none of it was caught by the home-directory or username checks, because
/// it is neither.
///
/// The rule this encodes: a fixture captured from real use is scrubbed of its
/// content, not just its paths.
#[test]
fn captured_fixtures_carry_no_real_identifiers() {
    // An identifier of the form used by several universities: a letter, seven
    // digits, a check letter. Distinctive enough not to fire on ordinary text.
    let matric = regex_lite(r"\bA\d{7}[A-Z]\b");

    let mut offenders = Vec::new();
    for path in tracked_files() {
        if path.ends_with("repo.rs") {
            continue;
        }
        let Some(text) = text_of(&path) else { continue };
        for line in text.lines() {
            if matric(line) {
                offenders.push(
                    path.strip_prefix(repo_root())
                        .unwrap_or(&path)
                        .display()
                        .to_string(),
                );
                break;
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "these look like personal identifiers: {offenders:?}"
    );
}

/// Compiled bytecode is never tracked.
///
/// A `.pyc` was committed alongside `scripts/scrub_tree.py`, and it embedded
/// every string constant of the module it was built from, which, for that
/// module, is the full list of personal data the script exists to remove. It
/// went unnoticed because it is binary: every check in this file reads text and
/// `text_of` returns `None` for anything with a NUL byte, so the one file in
/// the repository that concentrated all of it was the one nothing looked at.
///
/// The rule this encodes: a build artefact is not source, and a binary is not
/// evidence of nothing. Excluding a file class from an audit has to be a
/// decision, not a side effect of how the audit happens to read.
#[test]
fn no_compiled_bytecode_is_tracked() {
    let offenders: Vec<String> = tracked_files()
        .iter()
        .filter(|path| {
            let name = path.to_string_lossy();
            name.ends_with(".pyc") || name.contains("__pycache__/")
        })
        .map(|path| {
            path.strip_prefix(repo_root())
                .unwrap_or(path)
                .display()
                .to_string()
        })
        .collect();

    assert!(
        offenders.is_empty(),
        "compiled bytecode is tracked, and it carries the source's string \
         constants where no text audit will see them: {offenders:?}"
    );
}

/// Hand-rolled rather than pulling in a regex crate for one pattern:
/// letter, seven digits, letter, on word boundaries.
///
/// **Case-insensitive.** The first version required uppercase and passed
/// against a fixture where the identifier was lowercased, the way a directory
/// name writes it. Deliberately not quoting the example here: repeating it
/// would be the very thing this test refuses.
fn regex_lite(_pattern: &str) -> impl Fn(&str) -> bool {
    |line: &str| {
        let chars: Vec<char> = line.chars().collect();
        if chars.len() < 9 {
            return false;
        }
        for start in 0..=chars.len() - 9 {
            if start > 0 && (chars[start - 1].is_alphanumeric() || chars[start - 1] == '_') {
                continue;
            }
            let window = &chars[start..start + 9];
            let shaped = window[0].eq_ignore_ascii_case(&'a')
                && window[1..8].iter().all(char::is_ascii_digit)
                && window[8].is_ascii_alphabetic();
            // `map_or` rather than `is_none_or`: the crate's MSRV is 1.77.
            if shaped && chars.get(start + 9).map_or(true, |c| !c.is_alphanumeric()) {
                return true;
            }
        }
        false
    }
}
