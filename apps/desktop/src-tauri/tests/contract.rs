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
        supports_streaming: true,
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
            "workspaceMentions": ["AGENTS.md"],
            "supportsStreaming": true
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
        supports_streaming: true,
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

#[test]
fn file_change_matches_core() {
    // export interface FileChange {
    //   additions: number;
    //   deletions: number;
    //   path: string;
    // }
    let change = FileChange {
        path: "seed.txt".into(),
        additions: 1,
        deletions: 0,
        patch: Some("@@ -1,3 +1,4 @@\n gamma\n+delta\n".into()),
    };
    assert_eq!(
        to_json(&change),
        json!({
            "path": "seed.txt",
            "additions": 1,
            "deletions": 0,
            "patch": "@@ -1,3 +1,4 @@\n gamma\n+delta\n"
        })
    );

    // A harness that reports counts but no diff omits the field rather than
    // sending null; the TypeScript side declares it with `?`.
    let countless = FileChange {
        path: "seed.txt".into(),
        additions: 1,
        deletions: 0,
        patch: None,
    };
    assert!(to_json(&countless).get("patch").is_none());
}

/// A sub-agent's calls have to arrive attributed, or the transcript cannot tell
/// a fan-out from one long run of tools.
///
/// `agent` is omitted rather than sent as null when absent, which is what makes
/// "the main thread did this" the reading for every harness that does not
/// delegate, and for every event recorded before this field existed.
#[test]
fn agent_ref_matches_core() {
    // export interface AgentRef {
    //   id: string;
    //   name: string;
    // }
    let agent = AgentRef {
        id: "ses_01".into(),
        name: "explore".into(),
    };
    assert_eq!(
        to_json(&agent),
        json!({ "id": "ses_01", "name": "explore" })
    );

    let delegated = RuntimeEvent::ToolCallCompleted {
        id: "e1".into(),
        session_id: "s1".into(),
        timestamp: "2026-08-11T09:00:00Z".into(),
        turn_id: "t1".into(),
        block_id: "b1".into(),
        agent: Some(agent),
        name: Some("grep".into()),
        input: None,
        output: None,
        file_changes: None,
    };
    assert_eq!(
        to_json(&delegated).get("agent"),
        Some(&json!({ "id": "ses_01", "name": "explore" }))
    );

    let direct = RuntimeEvent::ToolCallCompleted {
        id: "e2".into(),
        session_id: "s1".into(),
        timestamp: "2026-08-11T09:00:00Z".into(),
        turn_id: "t1".into(),
        block_id: "b2".into(),
        agent: None,
        name: Some("grep".into()),
        input: None,
        output: None,
        file_changes: None,
    };
    assert!(to_json(&direct).get("agent").is_none());
}

/// The completion carries `input` and `fileChanges` because
/// `opencode run --format json` reports each tool exactly once, already
/// finished: there is no start event to have carried them.
#[test]
fn tool_call_completed_matches_core() {
    let event = RuntimeEvent::ToolCallCompleted {
        id: "e1".into(),
        session_id: "s1".into(),
        timestamp: "2026-08-11T09:00:00Z".into(),
        turn_id: "t1".into(),
        agent: None,
        block_id: "b1".into(),
        name: Some("apply_patch".into()),
        input: Some(r#"{"patchText":"..."}"#.into()),
        output: Some("Success.".into()),
        file_changes: Some(vec![FileChange {
            path: "seed.txt".into(),
            additions: 1,
            deletions: 0,
            patch: None,
        }]),
    };
    assert_eq!(
        to_json(&event),
        json!({
            "type": "tool_call.completed",
            "id": "e1",
            "sessionId": "s1",
            "timestamp": "2026-08-11T09:00:00Z",
            "turnId": "t1",
            "blockId": "b1",
            "name": "apply_patch",
            "input": "{\"patchText\":\"...\"}",
            "output": "Success.",
            "fileChanges": [{ "path": "seed.txt", "additions": 1, "deletions": 0 }]
        })
    );
}

/// The optional halves stay absent rather than serializing as null, which the
/// TypeScript side declares with `?` rather than `| null`.
#[test]
fn tool_call_completed_omits_what_it_does_not_have() {
    let event = RuntimeEvent::ToolCallCompleted {
        id: "e1".into(),
        session_id: "s1".into(),
        timestamp: "2026-08-11T09:00:00Z".into(),
        turn_id: "t1".into(),
        agent: None,
        block_id: "b1".into(),
        name: None,
        input: None,
        output: None,
        file_changes: None,
    };
    let json = to_json(&event);
    for absent in ["name", "input", "output", "fileChanges"] {
        assert!(json.get(absent).is_none(), "{absent} should be omitted");
    }
}

/// A setting whose only job is to change how much of a transcript is rendered.
/// It reaches the wire as a plain union, matching `TranscriptVerbosity` in
/// `packages/core/src/settings/types.ts`.
#[test]
fn transcript_verbosity_matches_union() {
    // export type TranscriptVerbosity = "full" | "output";
    assert_eq!(to_json(&TranscriptVerbosity::Full), json!("full"));
    assert_eq!(to_json(&TranscriptVerbosity::Output), json!("output"));
}

#[test]
fn runtime_settings_carries_verbosity() {
    let settings = RuntimeSettings {
        opencode_default_model: None,
        opencode_executable_path: None,
        scan_root: None,
        app_icon_id: None,
        transcript_verbosity: Some(TranscriptVerbosity::Output),
        quiver_cli_enabled: None,
    };
    assert_eq!(
        to_json(&settings),
        json!({ "transcriptVerbosity": "output" }),
        "an unset field must be omitted, not sent as null"
    );
}

/// Absent means full. A settings file written before this shipped must not
/// silently start hiding the user's tool output.
#[test]
fn verbosity_defaults_to_showing_everything() {
    let stored: RuntimeSettings = serde_json::from_value(json!({})).expect("empty settings");
    assert!(stored.transcript_verbosity.is_none());
    assert_eq!(
        stored.transcript_verbosity.unwrap_or_default(),
        TranscriptVerbosity::Full
    );
}

/// Sanitizing trims strings; it must not drop the enum along the way.
#[test]
fn sanitizing_keeps_the_verbosity_choice() {
    let settings = RuntimeSettings {
        opencode_default_model: Some("  openai/gpt-5-mini  ".into()),
        opencode_executable_path: Some("   ".into()),
        scan_root: None,
        app_icon_id: None,
        transcript_verbosity: Some(TranscriptVerbosity::Output),
        quiver_cli_enabled: None,
    }
    .sanitized();

    assert_eq!(
        settings.opencode_default_model.as_deref(),
        Some("openai/gpt-5-mini")
    );
    assert!(settings.opencode_executable_path.is_none());
    assert_eq!(
        settings.transcript_verbosity,
        Some(TranscriptVerbosity::Output)
    );
}

/// An unrecognised value must not take the rest of the settings with it.
///
/// `settings::read` falls back to `default()` on any parse error, so a closed
/// union here would mean one hand-edited typo silently discarding the model,
/// the executable path and the icon as well. The field absorbs it instead.
#[test]
fn an_unknown_verbosity_costs_only_that_field() {
    let parsed: RuntimeSettings = serde_json::from_value(json!({
        "opencodeDefaultModel": "openai/gpt-5-mini",
        "appIconId": "olympian-marble",
        "transcriptVerbosity": "sideways"
    }))
    .expect("the rest of the file must survive one bad value");

    assert!(parsed.transcript_verbosity.is_none());
    assert_eq!(
        parsed.opencode_default_model.as_deref(),
        Some("openai/gpt-5-mini")
    );
    assert_eq!(parsed.app_icon_id.as_deref(), Some("olympian-marble"));
}

/// The imported-history field. Absent for a session Artemis ran itself, which
/// it can already resume from its own event log.
#[test]
fn agent_session_summary_carries_a_resume_id() {
    let session = AgentSessionSummary {
        id: "quiver:ses_1".into(),
        workspace_id: "ws-artemis".into(),
        harness: HarnessKind::Opencode,
        title: "Codebase exploration".into(),
        status: AgentSessionStatus::Complete,
        started_at: "2026-08-11T09:00:00+00:00".into(),
        last_event_at: "2026-08-11T09:00:00+00:00".into(),
        attention_reason: None,
        terminal_preview: String::new(),
        resume_id: Some("ses_1".into()),
    };
    assert_eq!(to_json(&session)["resumeId"], json!("ses_1"));

    let own = AgentSessionSummary {
        resume_id: None,
        ..session
    };
    assert!(to_json(&own).get("resumeId").is_none());
}

/// Reading Quiver's files is free and always on; running its Python is not.
#[test]
fn the_quiver_cli_is_opt_in() {
    let stored: RuntimeSettings = serde_json::from_value(json!({})).expect("empty settings");
    assert!(
        !stored.quiver_cli_enabled.unwrap_or(false),
        "absent must mean off"
    );

    let on = RuntimeSettings {
        quiver_cli_enabled: Some(true),
        ..Default::default()
    };
    assert_eq!(to_json(&on), json!({ "quiverCliEnabled": true }));
}
