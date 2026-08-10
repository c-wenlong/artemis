//! Harness discovery: resolve known commands against PATH, read versions, and
//! note which workspace config files mention each harness.
//!
//! Ported from `packages/host-service/src/node/scanners/harnessScanner.ts`.
//! Two deliberate changes from the TypeScript original:
//!
//! * the workspace walk is bounded (depth, entry count, wall-clock budget).
//!   The original walked whatever sat above the app directory, which took ~7.6s
//!   on a workspace containing large checkouts and blocked first paint.
//! * `--version` probes have a real timeout. The original relied on
//!   `execFileSync`'s timeout; here it is an explicit poll-and-kill.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::catalog::{harness_by_token, KNOWN_HARNESSES};
use crate::types::{AssetHealth, HarnessAsset, HarnessDiscoverySource, HarnessKind};

const EXTRA_BIN_DIRS: &[&str] = &[
    "~/.local/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "~/.npm-global/bin",
    "~/go/bin",
];

const WORKSPACE_CONFIG_NAMES: &[&str] = &[
    "AGENTS.md",
    "CLAUDE.md",
    "CODEX.md",
    "WARP.md",
    ".mcp.json",
    "opencode.json",
    "package.json",
    "pnpm-workspace.yaml",
    "pyproject.toml",
];

const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "dist-electron",
    "build",
    ".next",
    ".turbo",
    "__pycache__",
    "target",
    "vendor",
    ".venv",
];

/// Caps on the workspace-mention walk.
const MAX_DEPTH: usize = 6;
const MAX_ENTRIES: usize = 20_000;
const MAX_MENTIONS: usize = 200;
const MAX_FILE_BYTES: u64 = 250_000;
const WALK_BUDGET: Duration = Duration::from_millis(1_500);
const VERSION_TIMEOUT: Duration = Duration::from_millis(1_800);

pub struct ScanOptions {
    pub workspace_root: PathBuf,
    pub include_versions: bool,
    pub include_workspace_mentions: bool,
}

struct Mention {
    harness_id: String,
    path: String,
}

fn expand_home(path: &str, home: &Path) -> PathBuf {
    match path.strip_prefix("~/") {
        Some(rest) => home.join(rest),
        None => PathBuf::from(path),
    }
}

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

/// PATH plus the extra bin dirs, de-duplicated, existing directories only.
fn path_dirs() -> Vec<PathBuf> {
    let home = home_dir();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut dirs = Vec::new();

    let path_env = std::env::var("PATH").unwrap_or_default();
    let candidates = path_env
        .split(':')
        .map(PathBuf::from)
        .chain(EXTRA_BIN_DIRS.iter().map(|dir| expand_home(dir, &home)));

    for candidate in candidates {
        if candidate.as_os_str().is_empty() {
            continue;
        }
        let normalized = candidate.canonicalize().unwrap_or(candidate);
        if !seen.insert(normalized.clone()) {
            continue;
        }
        if normalized.is_dir() {
            dirs.push(normalized);
        }
    }
    dirs
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path)
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    fs::metadata(path)
        .map(|meta| meta.is_file())
        .unwrap_or(false)
}

pub fn executable_at(path: &str) -> bool {
    is_executable(Path::new(path))
}

fn resolve_executable(command: &str, dirs: &[PathBuf]) -> Option<String> {
    if command.contains('/') && is_executable(Path::new(command)) {
        return Some(command.to_string());
    }
    dirs.iter()
        .map(|dir| dir.join(command))
        .find(|candidate| is_executable(candidate))
        .map(|candidate| candidate.to_string_lossy().into_owned())
}

fn read_version(command_path: &str, version_args: &[&str]) -> Option<String> {
    crate::proc::first_line(command_path, version_args, VERSION_TIMEOUT)
}

/// Walk the workspace looking for config files that name a known harness.
/// Bounded on every axis — this runs on the first-paint path.
fn scan_workspace_mentions(root: &Path) -> Vec<Mention> {
    let mut mentions = Vec::new();
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    let mut entries_seen = 0usize;
    let deadline = Instant::now() + WALK_BUDGET;

    while let Some((current, depth)) = stack.pop() {
        if mentions.len() >= MAX_MENTIONS
            || entries_seen >= MAX_ENTRIES
            || Instant::now() >= deadline
        {
            break;
        }

        let Ok(read_dir) = fs::read_dir(&current) else {
            continue;
        };

        for entry in read_dir.flatten() {
            entries_seen += 1;
            let name = entry.file_name().to_string_lossy().into_owned();
            let full_path = entry.path();

            let Ok(metadata) = entry.metadata() else {
                continue;
            };

            if metadata.is_dir() {
                let ignored = IGNORED_DIRS.contains(&name.as_str())
                    || (name.starts_with('.') && name != ".codex" && name != ".claude");
                if !ignored && depth < MAX_DEPTH {
                    stack.push((full_path, depth + 1));
                }
                continue;
            }

            if metadata.len() > MAX_FILE_BYTES {
                continue;
            }
            let is_config = WORKSPACE_CONFIG_NAMES.contains(&name.as_str());
            if !is_config && !name.ends_with(".md") {
                continue;
            }

            let Ok(text) = fs::read_to_string(&full_path) else {
                continue;
            };
            let haystack = text.to_lowercase();
            let relative = full_path
                .strip_prefix(root)
                .unwrap_or(&full_path)
                .to_string_lossy()
                .into_owned();

            for harness in KNOWN_HARNESSES {
                let mut tokens = vec![harness.id, harness.command];
                tokens.extend_from_slice(harness.aliases);
                let hit = tokens
                    .iter()
                    .filter(|token| token.len() > 1)
                    .any(|token| haystack.contains(&token.to_lowercase()));
                if hit {
                    mentions.push(Mention {
                        harness_id: harness.id.to_string(),
                        path: relative.clone(),
                    });
                }
            }
        }
    }

    mentions
}

fn unique_mention_paths(mentions: &[Mention], harness_id: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    mentions
        .iter()
        .filter(|mention| mention.harness_id == harness_id)
        .filter(|mention| seen.insert(mention.path.clone()))
        .map(|mention| mention.path.clone())
        .take(6)
        .collect()
}

pub fn scan_harnesses(options: &ScanOptions) -> Vec<HarnessAsset> {
    let dirs = path_dirs();
    let mentions = if options.include_workspace_mentions && options.workspace_root.is_dir() {
        scan_workspace_mentions(&options.workspace_root)
    } else {
        Vec::new()
    };

    // Resolve paths first (cheap), then probe versions concurrently. Serially,
    // ten installed harnesses each allowed 1.8s dominated the whole scan; in
    // parallel the cost is the slowest single probe.
    let resolved: Vec<Option<String>> = KNOWN_HARNESSES
        .iter()
        .map(|harness| resolve_executable(harness.command, &dirs))
        .collect();

    let versions: Vec<Option<String>> = if options.include_versions {
        std::thread::scope(|scope| {
            let handles: Vec<_> = KNOWN_HARNESSES
                .iter()
                .zip(&resolved)
                .map(|(harness, path)| {
                    scope.spawn(move || {
                        path.as_ref()
                            .and_then(|path| read_version(path, harness.version_args))
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap_or(None))
                .collect()
        })
    } else {
        vec![None; KNOWN_HARNESSES.len()]
    };

    let mut assets: Vec<HarnessAsset> = KNOWN_HARNESSES
        .iter()
        .zip(resolved)
        .zip(versions)
        .map(|((harness, executable_path), version)| {
            let workspace_mentions = unique_mention_paths(&mentions, harness.id);
            let found_in_workspace = !workspace_mentions.is_empty();

            let (health, source) = match (&executable_path, found_in_workspace) {
                (Some(_), _) => (AssetHealth::Ready, HarnessDiscoverySource::Path),
                (None, true) => (
                    AssetHealth::NeedsSetup,
                    HarnessDiscoverySource::WorkspaceConfig,
                ),
                (None, false) => (AssetHealth::Missing, HarnessDiscoverySource::QuiverCatalog),
            };

            HarnessAsset {
                id: harness.id.to_string(),
                kind: harness.kind,
                label: harness.label.to_string(),
                command: harness.command.to_string(),
                version,
                aliases: harness.aliases.iter().map(|a| a.to_string()).collect(),
                health,
                source,
                executable_path,
                description: Some(harness.description.to_string()),
                workspace_mentions: Some(workspace_mentions),
                last_used_at: None,
            }
        })
        .collect();

    assets.extend(scan_unknown_executables(&dirs, options.include_versions));

    assets.sort_by(|a, b| {
        a.health
            .rank()
            .cmp(&b.health.rank())
            .then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase()))
    });
    assets
}

/// Pick up agent-shaped executables on PATH that the catalog doesn't know about.
fn scan_unknown_executables(dirs: &[PathBuf], include_versions: bool) -> Vec<HarnessAsset> {
    let known: HashSet<&str> = KNOWN_HARNESSES.iter().map(|h| h.command).collect();
    let mut found = Vec::new();
    let mut seen_commands = HashSet::new();

    for dir in dirs {
        let Ok(read_dir) = fs::read_dir(dir) else {
            continue;
        };
        for entry in read_dir.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if known.contains(name.as_str()) || harness_by_token(&name).is_some() {
                continue;
            }
            let interesting =
                name.ends_with("-code") || matches!(name.as_str(), "aider" | "factory" | "warp");
            if !interesting || !seen_commands.insert(name.clone()) {
                continue;
            }
            let path = entry.path();
            if !is_executable(&path) {
                continue;
            }
            let executable_path = path.to_string_lossy().into_owned();
            let version = if include_versions {
                read_version(&executable_path, &["--version"])
            } else {
                None
            };
            found.push(HarnessAsset {
                id: format!("path-{name}"),
                kind: HarnessKind::Custom,
                label: name.clone(),
                command: name,
                version,
                aliases: Vec::new(),
                health: AssetHealth::Ready,
                source: HarnessDiscoverySource::Path,
                executable_path: Some(executable_path),
                description: Some("Discovered executable on PATH".to_string()),
                workspace_mentions: Some(Vec::new()),
                last_used_at: None,
            });
        }
    }
    found
}
