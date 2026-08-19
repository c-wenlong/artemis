//! Non-interactive agent launching.
//!
//! Ported from `packages/host-service/src/node/agentLauncher.ts`. This is the
//! one-shot path: prompt in, transcript out. Streaming (M1) and PTY-backed
//! interactive sessions (M6) are separate surfaces; this stays the fallback for
//! harnesses that can answer in a single shot.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::inventory;
use crate::proc::{run, RunOptions};
use crate::types::{AgentLaunchRequest, AgentLaunchResult, AssetHealth, HarnessAsset, HarnessKind};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(12);
const PI_TIMEOUT: Duration = Duration::from_secs(30);

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn failed(command: String, cwd: &Path, error: String, started_at: String) -> AgentLaunchResult {
    AgentLaunchResult {
        args: Vec::new(),
        command,
        completed_at: now(),
        cwd: cwd.to_string_lossy().into_owned(),
        error: Some(error),
        exit_code: None,
        ok: false,
        started_at,
        stderr: String::new(),
        stdout: String::new(),
        timed_out: None,
    }
}

/// Per-harness non-interactive invocation. Harnesses absent from this table
/// have no one-shot adapter yet and belong in the terminal dock.
fn command_for(harness: &HarnessAsset, prompt: &str) -> Option<(String, Vec<String>)> {
    let command = harness
        .executable_path
        .clone()
        .unwrap_or_else(|| harness.command.clone());
    let args: Vec<String> = match harness.kind {
        HarnessKind::Pi => vec!["--print".into(), prompt.into()],
        HarnessKind::Amp => vec![
            "--no-color".into(),
            "--no-notifications".into(),
            "-x".into(),
            prompt.into(),
        ],
        HarnessKind::Codex => vec!["exec".into(), prompt.into()],
        HarnessKind::Claude => vec!["-p".into(), prompt.into()],
        HarnessKind::Gemini => vec!["-p".into(), prompt.into()],
        _ => return None,
    };
    Some((command, args))
}

fn has_amp_credentials() -> bool {
    std::env::var("AMP_API_KEY")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

pub fn launch(request: AgentLaunchRequest) -> AgentLaunchResult {
    let started_at = now();
    let cwd =
        PathBuf::from(&request.workspace_path).join(request.start_path.as_deref().unwrap_or("."));

    let harnesses = inventory::harnesses(false, false);
    let Some(harness) = harnesses
        .into_iter()
        .find(|candidate| candidate.id == request.harness_id)
    else {
        return failed(
            request.harness_id.clone(),
            &cwd,
            format!("Unknown harness: {}", request.harness_id),
            started_at,
        );
    };

    if harness.health != AssetHealth::Ready || harness.executable_path.is_none() {
        return failed(
            harness.command.clone(),
            &cwd,
            format!(
                "Harness {} is not ready or has no executable path.",
                request.harness_id
            ),
            started_at,
        );
    }

    if !cwd.is_dir() {
        return failed(
            harness.command.clone(),
            &cwd,
            format!("Start path does not exist or is not a directory: {cwd:?}"),
            started_at,
        );
    }

    if harness.kind == HarnessKind::Amp && !has_amp_credentials() {
        return failed(
            harness.command.clone(),
            &cwd,
            "Amp is installed but not authenticated for non-interactive launches. \
             Run `amp login` or set AMP_API_KEY, then launch Amp again."
                .to_string(),
            started_at,
        );
    }

    let Some((command, args)) = command_for(&harness, &request.prompt) else {
        return failed(
            harness.command.clone(),
            &cwd,
            format!(
                "No non-interactive launch adapter exists for {} yet.",
                harness.label
            ),
            started_at,
        );
    };

    let timeout = if harness.kind == HarnessKind::Pi {
        PI_TIMEOUT
    } else {
        DEFAULT_TIMEOUT
    };

    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    let captured = run(
        &command,
        &borrowed,
        RunOptions {
            cwd: Some(&cwd),
            timeout,
            env: &[("NO_COLOR", "1".to_string())],
        },
    );

    match captured {
        Some(captured) => AgentLaunchResult {
            args,
            command,
            completed_at: now(),
            cwd: cwd.to_string_lossy().into_owned(),
            error: captured
                .timed_out
                .then(|| format!("Timed out after {}s", timeout.as_secs())),
            exit_code: captured.exit_code,
            ok: captured.ok(),
            started_at,
            stderr: captured.stderr,
            stdout: captured.stdout,
            timed_out: Some(captured.timed_out),
        },
        None => failed(
            command,
            &cwd,
            "Failed to spawn the harness process.".to_string(),
            started_at,
        ),
    }
}
