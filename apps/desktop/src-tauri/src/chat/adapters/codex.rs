//! Codex, from a real `codex exec --json` capture.
//!
//! The protocol is items with a lifecycle:
//!
//! ```text
//! {"type":"thread.started","thread_id":"019fef86-…"}
//! {"type":"turn.started"}
//! {"type":"item.started",  "item":{"id":"item_2","type":"file_change",…}}
//! {"type":"item.completed","item":{"id":"item_2","type":"file_change",…}}
//! {"type":"turn.completed","usage":{…}}
//! ```
//!
//! Two things make it pleasanter than opencode's. Items carry a stable `id`, so
//! start and finish pair without guessing. And an edit is its own
//! `file_change` item rather than something to be inferred from a tool's
//! arguments, though it names the files without diffing them, so there is
//! nothing to count and nothing to reverse.

use std::collections::HashSet;

use serde_json::Value;

use super::{HarnessAdapter, Stamp};
use crate::types::{FileChange, RuntimeEvent};

pub struct CodexAdapter {
    stamp: Stamp,
    thread_id: Option<String>,
    first_error: Option<String>,
    started: HashSet<String>,
}

impl CodexAdapter {
    pub fn new(session_id: String, turn_id: String) -> Self {
        CodexAdapter {
            stamp: Stamp::new(session_id, turn_id),
            thread_id: None,
            first_error: None,
            started: HashSet::new(),
        }
    }

    /// Codex reports absolute paths; the transcript wants workspace-relative
    /// ones. Without the workspace root here, the best available answer is the
    /// tail, which is what a reader recognises anyway.
    fn file_changes(item: &Value) -> Option<Vec<FileChange>> {
        let changes = item.get("changes")?.as_array()?;
        let mapped: Vec<FileChange> = changes
            .iter()
            .filter_map(|change| {
                let path = change.get("path")?.as_str()?;
                Some(FileChange {
                    path: path.rsplit('/').next().unwrap_or(path).to_string(),
                    // Codex names the file but sends no diff. Zero is the
                    // honest count for "not reported"; the summary card renders
                    // a row without numbers rather than claiming a change of
                    // nothing.
                    additions: 0,
                    deletions: 0,
                    patch: None,
                })
            })
            .collect();
        (!mapped.is_empty()).then_some(mapped)
    }
}

impl HarnessAdapter for CodexAdapter {
    fn parse_line(&mut self, line: &str) -> Vec<RuntimeEvent> {
        let Ok(frame) = serde_json::from_str::<Value>(line.trim()) else {
            return Vec::new();
        };
        let Some(frame_type) = frame.get("type").and_then(Value::as_str) else {
            return Vec::new();
        };

        if frame_type == "thread.started" {
            if let Some(id) = frame.get("thread_id").and_then(Value::as_str) {
                self.thread_id = Some(id.to_string());
            }
            return Vec::new();
        }

        // turn.started / turn.completed carry no content. The turn's own
        // terminal event is written by the run loop, which knows the exit code.
        let Some(item) = frame.get("item") else {
            return Vec::new();
        };
        let Some(item_type) = item.get("type").and_then(Value::as_str) else {
            return Vec::new();
        };
        let block_id = item
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("item")
            .to_string();
        let completed = frame_type == "item.completed";

        match item_type {
            "agent_message" => {
                // Sent whole on completion, not as deltas.
                if !completed {
                    return Vec::new();
                }
                let Some(text) = item.get("text").and_then(Value::as_str) else {
                    return Vec::new();
                };
                vec![RuntimeEvent::TextDelta {
                    id: self.stamp.next_id(),
                    session_id: self.stamp.session_id.clone(),
                    timestamp: self.stamp.now(),
                    turn_id: self.stamp.turn_id.clone(),
                    block_id,
                    text: text.to_string(),
                }]
            }

            "reasoning" => {
                if !completed {
                    return Vec::new();
                }
                let Some(text) = item
                    .get("text")
                    .or_else(|| item.get("summary"))
                    .and_then(Value::as_str)
                else {
                    return Vec::new();
                };
                let text = text.to_string();
                vec![RuntimeEvent::ReasoningDelta {
                    id: self.stamp.next_id(),
                    session_id: self.stamp.session_id.clone(),
                    timestamp: self.stamp.now(),
                    turn_id: self.stamp.turn_id.clone(),
                    block_id,
                    text,
                }]
            }

            "error" => {
                let message = item
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Codex reported an error")
                    .to_string();
                // Codex uses `error` items for advisories too: the capture this
                // was written from opens with a note about skill descriptions
                // being shortened. Recording it as *the* turn error would fail a
                // turn that went on to succeed, so it renders and nothing more.
                vec![RuntimeEvent::ToolCallErrored {
                    id: self.stamp.next_id(),
                    session_id: self.stamp.session_id.clone(),
                    timestamp: self.stamp.now(),
                    turn_id: self.stamp.turn_id.clone(),
                    agent: None,
                    block_id,
                    name: Some("notice".to_string()),
                    message,
                }]
            }

            // Everything else is work: a shell command, an edit, a search.
            _ => {
                let input = item
                    .get("command")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| item.get("changes").map(|changes| changes.to_string()));

                if !completed {
                    if !self.started.insert(block_id.clone()) {
                        return Vec::new();
                    }
                    return vec![RuntimeEvent::ToolCallStarted {
                        id: self.stamp.next_id(),
                        session_id: self.stamp.session_id.clone(),
                        timestamp: self.stamp.now(),
                        turn_id: self.stamp.turn_id.clone(),
                        agent: None,
                        block_id,
                        name: item_type.to_string(),
                        input,
                    }];
                }

                let failed = item
                    .get("exit_code")
                    .and_then(Value::as_i64)
                    .is_some_and(|code| code != 0);
                let output = item
                    .get("aggregated_output")
                    .and_then(Value::as_str)
                    .map(str::to_string);

                if failed {
                    return vec![RuntimeEvent::ToolCallErrored {
                        id: self.stamp.next_id(),
                        session_id: self.stamp.session_id.clone(),
                        timestamp: self.stamp.now(),
                        turn_id: self.stamp.turn_id.clone(),
                        agent: None,
                        block_id,
                        name: Some(item_type.to_string()),
                        message: output.unwrap_or_else(|| "The command failed.".into()),
                    }];
                }

                vec![RuntimeEvent::ToolCallCompleted {
                    id: self.stamp.next_id(),
                    session_id: self.stamp.session_id.clone(),
                    timestamp: self.stamp.now(),
                    turn_id: self.stamp.turn_id.clone(),
                    agent: None,
                    block_id,
                    name: Some(item_type.to_string()),
                    input,
                    output,
                    file_changes: Self::file_changes(item),
                }]
            }
        }
    }

    fn observed_session_id(&self) -> Option<&str> {
        self.thread_id.as_deref()
    }

    fn error_message(&self) -> Option<&str> {
        self.first_error.as_deref()
    }
}
