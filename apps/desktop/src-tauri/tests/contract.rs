//! Wire-shape contract with `@artemis/core`.
//!
//! `@artemis/core` is the contract; these structs must serialize to exactly what
//! its TypeScript types describe. A rename on the Rust side that the UI is not
//! expecting fails here rather than silently rendering an empty panel.
//!
//! The expected literals are transcribed by hand from
//! `packages/core/src/**/types.ts`. That manual step is deliberate: changing the
//! contract should require touching both sides.

use artemis_host::types::*;
use serde_json::{json, Value};

fn to_json<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("serializes")
}

#[test]
fn asset_health_matches_union() {
    // export type AssetHealth = "ready" | "missing" | "needs-setup" | "unknown";
    assert_eq!(to_json(&AssetHealth::Ready), json!("ready"));
    assert_eq!(to_json(&AssetHealth::Missing), json!("missing"));
    assert_eq!(to_json(&AssetHealth::NeedsSetup), json!("needs-setup"));
    assert_eq!(to_json(&AssetHealth::Unknown), json!("unknown"));
}

#[test]
fn discovery_source_matches_union() {
    // "path" | "settings" | "workspace-config" | "quiver-catalog" | "seed"
    assert_eq!(to_json(&HarnessDiscoverySource::Path), json!("path"));
    assert_eq!(
        to_json(&HarnessDiscoverySource::Settings),
        json!("settings")
    );
    assert_eq!(
        to_json(&HarnessDiscoverySource::WorkspaceConfig),
        json!("workspace-config")
    );
    assert_eq!(
        to_json(&HarnessDiscoverySource::QuiverCatalog),
        json!("quiver-catalog")
    );
    assert_eq!(to_json(&HarnessDiscoverySource::Seed), json!("seed"));
}

#[test]
fn workspace_status_matches_union() {
    assert_eq!(
        to_json(&WorkspaceStatus::NeedsAttention),
        json!("needs-attention")
    );
    assert_eq!(to_json(&WorkspaceStatus::Ready), json!("ready"));
    assert_eq!(to_json(&WorkspaceStatus::Archived), json!("archived"));
}

#[test]
fn harness_kind_matches_union() {
    assert_eq!(to_json(&HarnessKind::Opencode), json!("opencode"));
    assert_eq!(to_json(&HarnessKind::Claude), json!("claude"));
    assert_eq!(to_json(&HarnessKind::Custom), json!("custom"));
}

#[test]
fn change_kind_matches_union() {
    assert_eq!(to_json(&ChangeKind::Added), json!("added"));
    assert_eq!(to_json(&ChangeKind::Modified), json!("modified"));
    assert_eq!(to_json(&ChangeKind::Deleted), json!("deleted"));
    assert_eq!(to_json(&ChangeKind::Renamed), json!("renamed"));
}

/// A fully-populated harness serializes every documented key in camelCase.
#[test]
fn harness_asset_serializes_camel_case() {
    let asset = HarnessAsset {
        id: "opencode".into(),
        kind: HarnessKind::Opencode,
        label: "OpenCode".into(),
        command: "opencode".into(),
        version: Some("1.17.11".into()),
        aliases: vec!["oc".into()],
        health: AssetHealth::Ready,
        source: HarnessDiscoverySource::Path,
        executable_path: Some("/usr/local/bin/opencode".into()),
        description: Some("Open source AI coding agent".into()),
        workspace_mentions: Some(vec!["AGENTS.md".into()]),
        last_used_at: None,
    };

    assert_eq!(
        to_json(&asset),
        json!({
            "id": "opencode",
            "kind": "opencode",
            "label": "OpenCode",
            "command": "opencode",
            "version": "1.17.11",
            "aliases": ["oc"],
            "health": "ready",
            "source": "path",
            "executablePath": "/usr/local/bin/opencode",
            "description": "Open source AI coding agent",
            "workspaceMentions": ["AGENTS.md"]
        })
    );
}

/// Unset optionals must be absent, not null: the TypeScript side declares them
/// with `?`, and `exactOptionalPropertyTypes` rejects an explicit null.
#[test]
fn unset_optionals_are_omitted() {
    let asset = HarnessAsset {
        id: "aider".into(),
        kind: HarnessKind::Custom,
        label: "Aider".into(),
        command: "aider".into(),
        version: None,
        aliases: vec![],
        health: AssetHealth::Missing,
        source: HarnessDiscoverySource::QuiverCatalog,
        executable_path: None,
        description: None,
        workspace_mentions: None,
        last_used_at: None,
    };

    let value = to_json(&asset);
    let object = value.as_object().expect("object");
    for absent in [
        "version",
        "executablePath",
        "description",
        "workspaceMentions",
        "lastUsedAt",
    ] {
        assert!(
            !object.contains_key(absent),
            "`{absent}` must be omitted when unset, found {value}"
        );
    }
}

#[test]
fn workspace_summary_serializes_camel_case() {
    let workspace = WorkspaceSummary {
        id: "ws-artemis".into(),
        project_id: "artemis".into(),
        name: "Current checkout".into(),
        branch: "main".into(),
        worktree_path: "/tmp/artemis".into(),
        status: WorkspaceStatus::Ready,
        active_session_ids: vec![],
        changed_file_count: 3,
        last_activity_at: "2026-08-10T00:00:00Z".into(),
    };

    let value = to_json(&workspace);
    assert_eq!(value["projectId"], json!("artemis"));
    assert_eq!(value["worktreePath"], json!("/tmp/artemis"));
    assert_eq!(value["activeSessionIds"], json!([]));
    assert_eq!(value["lastActivityAt"], json!("2026-08-10T00:00:00Z"));
    assert!(
        value["changedFileCount"].is_number(),
        "changedFileCount must stay numeric"
    );
}

#[test]
fn review_snapshot_serializes_camel_case() {
    let snapshot = ReviewSnapshot {
        workspace_id: "ws-artemis".into(),
        base_branch: "main".into(),
        files: vec![ChangedFile {
            path: "src/main.rs".into(),
            kind: ChangeKind::Added,
            additions: 12,
            deletions: 0,
        }],
        artifact_paths: vec![],
    };

    assert_eq!(
        to_json(&snapshot),
        json!({
            "workspaceId": "ws-artemis",
            "baseBranch": "main",
            "files": [{
                "path": "src/main.rs",
                "kind": "added",
                "additions": 12,
                "deletions": 0
            }],
            "artifactPaths": []
        })
    );
}

/// The launch request arrives from the UI, so deserialization is the direction
/// that matters.
#[test]
fn launch_request_deserializes_from_camel_case() {
    let request: AgentLaunchRequest = serde_json::from_value(json!({
        "harnessId": "claude",
        "prompt": "explain this repo",
        "startPath": ".",
        "workspaceId": "ws-artemis",
        "workspacePath": "/tmp/artemis"
    }))
    .expect("deserializes");

    assert_eq!(request.harness_id, "claude");
    assert_eq!(request.workspace_path, "/tmp/artemis");
    assert_eq!(request.start_path.as_deref(), Some("."));
}

#[test]
fn settings_round_trip_and_sanitize() {
    let settings: RuntimeSettings = serde_json::from_value(json!({
        "opencodeExecutablePath": "  /usr/local/bin/opencode  ",
        "opencodeDefaultModel": "   ",
    }))
    .expect("deserializes");

    let sanitized = settings.sanitized();
    assert_eq!(
        sanitized.opencode_executable_path.as_deref(),
        Some("/usr/local/bin/opencode"),
        "paths are trimmed"
    );
    assert!(
        sanitized.opencode_default_model.is_none(),
        "whitespace-only values are dropped, not stored"
    );

    let value = to_json(&sanitized);
    assert!(value
        .as_object()
        .unwrap()
        .contains_key("opencodeExecutablePath"));
    assert!(!value
        .as_object()
        .unwrap()
        .contains_key("opencodeDefaultModel"));
}
