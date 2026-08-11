//! Quiver as an optional enrichment source.
//!
//! The rule the whole module exists to keep: Artemis works fully with Quiver
//! absent, and a Quiver that has changed shape or gone corrupt degrades to
//! native rather than failing. Every test here is either "this is the value we
//! get" or "this is what happens when it is not there".
//!
//! Fixtures under `tests/fixtures/quiver/` are trimmed copies of the real files
//! at `~/.config/swe/`, so the schema assumptions are pinned against something
//! that actually existed rather than something documented.

use artemis_host::quiver;
use artemis_host::types::{AssetHealth, HarnessAsset, HarnessDiscoverySource, HarnessKind};
use std::path::{Path, PathBuf};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/quiver")
}

/// A directory with only the files a test names, so "Quiver is half-installed"
/// is as easy to set up as "Quiver is present".
fn partial(name: &str, files: &[&str]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("artemis-quiver-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    for file in files {
        std::fs::copy(fixtures().join(file), dir.join(file)).expect("copy fixture");
    }
    dir
}

fn write(dir: &Path, name: &str, contents: &str) {
    std::fs::write(dir.join(name), contents).expect("write");
}

fn native(id: &str, health: AssetHealth) -> HarnessAsset {
    HarnessAsset {
        id: id.to_string(),
        kind: HarnessKind::Custom,
        label: id.to_string(),
        command: id.to_string(),
        version: None,
        aliases: Vec::new(),
        health,
        source: HarnessDiscoverySource::Path,
        executable_path: Some(format!("/usr/local/bin/{id}")),
        description: None,
        workspace_mentions: None,
        last_used_at: None,
        supports_streaming: false,
    }
}

// ------------------------------------------------------------ the registry

#[test]
fn reads_the_curated_registry() {
    let registry = quiver::registry(&fixtures());
    assert!(registry.contains_key("claude"), "got {:?}", registry.keys());

    let claude = &registry["claude"];
    assert_eq!(claude.command.as_deref(), Some("claude"));
    assert_eq!(claude.aliases, vec!["cc"]);
    assert!(claude.description.as_deref().unwrap().contains("Anthropic"));
    assert!(claude.version.is_some());
}

#[test]
fn a_missing_quiver_is_simply_empty() {
    let nowhere = std::env::temp_dir().join("artemis-quiver-absent");
    let _ = std::fs::remove_dir_all(&nowhere);
    assert!(quiver::registry(&nowhere).is_empty());
    assert!(quiver::sessions(&nowhere).is_empty());
}

/// Rule 3: a malformed row must not fail the whole load.
#[test]
fn one_bad_entry_does_not_lose_the_good_ones() {
    let dir = partial("bad_row", &[]);
    write(
        &dir,
        "tools.json",
        r#"{
             "claude": { "command": "claude", "aliases": ["cc"] },
             "broken": "this should have been an object",
             "codex":  { "command": "codex" }
           }"#,
    );

    let registry = quiver::registry(&dir);
    assert_eq!(registry.len(), 2, "the two well-formed rows survive");
    assert!(registry.contains_key("claude"));
    assert!(registry.contains_key("codex"));
}

/// The exit criterion, in the corruption case: degrade, never crash.
#[test]
fn a_corrupt_registry_degrades_to_nothing() {
    let dir = partial("corrupt", &[]);
    write(&dir, "tools.json", "{ not json at all ");
    assert!(quiver::registry(&dir).is_empty());
}

// ---------------------------------------------------------- the enrichment

#[test]
fn quiver_layers_onto_the_native_scan() {
    let mut harnesses = vec![native("claude", AssetHealth::Ready)];
    quiver::enrich_harnesses(&fixtures(), &mut harnesses);

    let claude = &harnesses[0];
    assert_eq!(claude.aliases, vec!["cc"], "aliases come from the registry");
    assert!(claude.description.is_some());
    assert_eq!(
        claude.source,
        HarnessDiscoverySource::QuiverCatalog,
        "an enriched row says where the extra came from"
    );
}

/// Rule: the native scan is ground truth about what is actually runnable.
/// Quiver's registry is curated by hand and can name a binary that is gone.
#[test]
fn quiver_never_overrides_what_the_scan_found() {
    let mut harnesses = vec![native("claude", AssetHealth::Missing)];
    harnesses[0].executable_path = None;

    quiver::enrich_harnesses(&fixtures(), &mut harnesses);

    assert_eq!(
        harnesses[0].health,
        AssetHealth::Missing,
        "a curated entry cannot make an absent binary present"
    );
    assert!(harnesses[0].executable_path.is_none());
}

/// A version the scan actually probed beats a version someone typed into a
/// registry months ago.
#[test]
fn a_probed_version_wins_over_a_curated_one() {
    let mut harnesses = vec![native("claude", AssetHealth::Ready)];
    harnesses[0].version = Some("99.0.0-probed".into());

    quiver::enrich_harnesses(&fixtures(), &mut harnesses);
    assert_eq!(harnesses[0].version.as_deref(), Some("99.0.0-probed"));
}

#[test]
fn a_harness_quiver_does_not_know_is_left_exactly_as_it_was() {
    let mut harnesses = vec![native("aider", AssetHealth::Ready)];
    let before = harnesses[0].clone();

    quiver::enrich_harnesses(&fixtures(), &mut harnesses);

    assert_eq!(harnesses[0].aliases, before.aliases);
    assert_eq!(
        harnesses[0].source,
        HarnessDiscoverySource::Path,
        "provenance must not claim Quiver contributed when it did not"
    );
}

// ------------------------------------------------------------- the history

#[test]
fn reads_session_history_with_the_ids_needed_to_resume() {
    let sessions = quiver::sessions(&fixtures());
    assert!(!sessions.is_empty());

    let first = &sessions[0];
    assert!(!first.title.is_empty());
    assert_eq!(first.tool_name.as_deref(), Some("opencode"));
    assert!(
        first.session_id.is_some(),
        "the resume id is the whole point of reading this file"
    );
    assert!(first.path.as_deref().unwrap().starts_with("/work/"));
}

#[test]
fn sessions_are_newest_first() {
    let sessions = quiver::sessions(&fixtures());
    let stamps: Vec<f64> = sessions.iter().filter_map(|s| s.timestamp).collect();
    let mut sorted = stamps.clone();
    sorted.sort_by(|a, b| b.partial_cmp(a).unwrap());
    assert_eq!(stamps, sorted, "a history reads newest first");
}

#[test]
fn a_session_row_missing_its_id_is_dropped_rather_than_shown_unresumable() {
    let dir = partial("no_id", &[]);
    write(
        &dir,
        "session_cache.json",
        r#"{"sessions": [
             {"title": "good", "session_id": "ses_1", "tool_name": "opencode", "timestamp": 2},
             {"title": "no id", "tool_name": "opencode", "timestamp": 1}
           ]}"#,
    );

    let sessions = quiver::sessions(&dir);
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].title, "good");
}

#[test]
fn a_session_cache_that_is_a_list_rather_than_an_object_still_reads() {
    // Older Quiver wrote a bare array. Tolerating both costs three lines and
    // saves a silent empty history on someone's machine.
    let dir = partial("bare_list", &[]);
    write(
        &dir,
        "session_cache.json",
        r#"[{"title": "old shape", "session_id": "ses_1", "tool_name": "codex", "timestamp": 1}]"#,
    );
    assert_eq!(quiver::sessions(&dir).len(), 1);
}

#[test]
fn history_for_one_workspace_is_the_history_at_that_path() {
    let all = quiver::sessions(&fixtures());
    let wanted = all[0].path.clone().expect("a path");

    let scoped = quiver::sessions_at(&fixtures(), &wanted);
    assert!(!scoped.is_empty());
    assert!(scoped
        .iter()
        .all(|session| session.path.as_deref() == Some(&wanted)));
}

// ------------------------------------------------------------ availability

#[test]
fn presence_is_decided_by_the_files_that_matter() {
    assert!(quiver::is_present(&fixtures()));

    let empty = partial("empty", &[]);
    assert!(!quiver::is_present(&empty));

    let only_history = partial("history_only", &["session_cache.json"]);
    assert!(
        quiver::is_present(&only_history),
        "a half-installed Quiver still has something worth reading"
    );
}

// ------------------------------------------------- history, as Artemis sees it

/// The history is only useful once it is Artemis's own type, carrying the id
/// that lets a conversation be picked up again.
#[test]
fn history_becomes_sessions_artemis_can_resume() {
    let summaries = quiver::session_summaries(&fixtures(), "ws-demo", None);
    assert!(!summaries.is_empty());

    let first = &summaries[0];
    assert_eq!(first.workspace_id, "ws-demo");
    assert_eq!(
        first.harness,
        HarnessKind::Opencode,
        "mapped from tool_name"
    );
    assert!(!first.title.is_empty());
    assert!(
        first.resume_id.is_some(),
        "without this the row is history that cannot be reopened"
    );
    assert_eq!(
        first.status,
        artemis_host::types::AgentSessionStatus::Complete,
        "an imported session is finished by definition; it is not running now"
    );
}

#[test]
fn imported_history_can_be_scoped_to_one_directory() {
    let path = quiver::sessions(&fixtures())[0].path.clone().unwrap();
    let scoped = quiver::session_summaries(&fixtures(), "ws-demo", Some(&path));
    assert!(!scoped.is_empty());

    let elsewhere = quiver::session_summaries(&fixtures(), "ws-demo", Some("/work/nothing-here"));
    assert!(elsewhere.is_empty());
}

#[test]
fn an_unrecognised_harness_name_still_imports() {
    let dir = partial("odd_harness", &[]);
    write(
        &dir,
        "session_cache.json",
        r#"{"sessions": [{"title": "t", "session_id": "s1", "tool_name": "some-new-tool", "timestamp": 1}]}"#,
    );

    let summaries = quiver::session_summaries(&dir, "ws", None);
    assert_eq!(summaries.len(), 1, "a tool we do not know is still history");
    assert_eq!(summaries[0].harness, HarnessKind::Custom);
}

// ------------------------------------------------------------- the CLI source

/// Rule 4: the subprocess is opt-in, timed out, and treats failure as no data.
/// This drives a command that is guaranteed to fail rather than the real `swe`,
/// because the point being tested is the failure handling.
#[test]
fn a_cli_that_fails_yields_no_data_rather_than_an_error() {
    let servers = quiver::mcp_servers_via("definitely-not-a-real-binary-xyz", 2);
    assert!(servers.is_empty());
}

#[test]
fn a_cli_that_prints_nonsense_yields_no_data() {
    let servers = quiver::mcp_servers_via("echo", 2);
    assert!(servers.is_empty(), "stdout that is not the expected JSON");
}

/// The reconciliation Quiver is worth shelling out for: which harnesses each
/// server is registered in. Parsed from the documented shape rather than from
/// a live run, so the test does not need the CLI installed.
#[test]
fn parses_the_cross_tool_reconciliation() {
    let json = r#"[
      {"name": "dv__github", "tools": ["claude", "codex", "opencode"], "status": "new",
       "source_tool": "codex", "summary": "…"},
      {"name": "computer-use", "tools": ["codex"], "status": "new", "source_tool": "codex"},
      {"garbage": true}
    ]"#;

    let servers = quiver::parse_mcp_discovery(json);
    assert_eq!(servers.len(), 2, "the unusable row is dropped, not fatal");

    let github = &servers[0];
    assert_eq!(github.name, "dv__github");
    assert_eq!(
        github.owner_tool, "claude, codex, opencode",
        "the whole point is seeing every harness a server is registered in"
    );
}

#[test]
fn a_server_registered_nowhere_is_not_reported_as_reconciled() {
    let servers = quiver::parse_mcp_discovery(r#"[{"name": "orphan", "tools": []}]"#);
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].health, AssetHealth::Unknown);
}

// ------------------------------------------------ against the real thing

/// Runs against `~/.config/swe/` on this machine rather than a fixture.
///
/// Ignored by default: it depends on Quiver being installed, and its numbers
/// are specific to whoever runs it. It exists because a fixture only proves the
/// parser handles the shape it was cut from — this proves the shape is still
/// what the real file has.
///
/// ```text
/// cargo test --test quiver real_quiver -- --ignored --nocapture
/// ```
#[test]
#[ignore]
fn real_quiver_still_has_the_shape_we_parse() {
    let root = quiver::config_root();
    if !quiver::is_present(&root) {
        eprintln!("Quiver not installed at {root:?}; nothing to check");
        return;
    }

    let registry = quiver::registry(&root);
    let sessions = quiver::sessions(&root);
    println!(
        "registry: {} tools, history: {} resumable sessions",
        registry.len(),
        sessions.len()
    );

    assert!(!registry.is_empty(), "tools.json parsed to nothing");
    assert!(!sessions.is_empty(), "session_cache.json parsed to nothing");
    assert!(
        sessions.iter().all(|s| s.session_id.is_some()),
        "every imported row must be resumable"
    );

    let harnesses: Vec<&str> = {
        let mut names: Vec<&str> = sessions
            .iter()
            .filter_map(|s| s.tool_name.as_deref())
            .collect();
        names.sort_unstable();
        names.dedup();
        names
    };
    println!("harnesses in history: {harnesses:?}");
    assert!(
        harnesses.len() > 1,
        "the value here is breadth across harnesses, got {harnesses:?}"
    );

    // The enrichment, against the real registry and a real scan.
    let mut scanned = artemis_host::inventory::harnesses(false, false);
    let before = scanned.len();
    quiver::enrich_harnesses(&root, &mut scanned);
    assert_eq!(
        before,
        scanned.len(),
        "enrichment must not add or drop rows"
    );

    let enriched = scanned
        .iter()
        .filter(|h| h.source == HarnessDiscoverySource::QuiverCatalog)
        .count();
    println!("{enriched} of {before} harnesses gained something from Quiver");
}

/// The exit criterion, stated directly: Artemis must be unchanged by Quiver's
/// absence, and unharmed by its corruption.
///
/// ```text
/// cargo test --test quiver degrades -- --ignored --nocapture
/// ```
#[test]
#[ignore]
fn degrades_to_native_when_quiver_is_broken() {
    let native_only = artemis_host::inventory::harnesses(false, false);
    assert!(!native_only.is_empty(), "nothing to compare against");

    // Corrupt every file Artemis reads, in a copy — never the real directory.
    let broken = std::env::temp_dir().join("artemis-quiver-corrupt-all");
    let _ = std::fs::remove_dir_all(&broken);
    std::fs::create_dir_all(&broken).unwrap();
    for name in ["tools.json", "session_cache.json", "providers.json"] {
        std::fs::write(broken.join(name), "\u{0}\u{0} not json \u{fffd}").unwrap();
    }

    let mut harnesses = native_only.clone();
    quiver::enrich_harnesses(&broken, &mut harnesses);

    assert_eq!(harnesses.len(), native_only.len());
    for (after, before) in harnesses.iter().zip(native_only.iter()) {
        assert_eq!(after.id, before.id);
        assert_eq!(after.health, before.health);
        assert_eq!(
            after.source, before.source,
            "a corrupt registry must not claim provenance"
        );
    }
    assert!(quiver::sessions(&broken).is_empty());
    assert!(quiver::session_summaries(&broken, "ws", None).is_empty());
    println!(
        "{} harnesses, identical with Quiver corrupt",
        harnesses.len()
    );
}
