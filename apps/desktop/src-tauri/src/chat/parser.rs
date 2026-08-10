//! OpenCode stdout → `RuntimeEvent`.
//!
//! Ported from `packages/host-service/src/node/opencodeChat.ts`.
//!
//! The parser is deliberately shape-tolerant. OpenCode's JSON line format
//! varies across versions and event kinds, so rather than modelling each
//! envelope, this walks every object in the tree, keeps the ones that look like
//! a content part, and classifies them. A stricter parser breaks on the next
//! opencode release; this one degrades to emitting less.
//!
//! Text arrives **cumulative** — each line resends the whole part — so deltas
//! are computed by diffing against the last value seen for that block.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::types::{FileChange, RuntimeEvent};

pub struct OpenCodeParser {
    session_id: String,
    turn_id: String,
    observed_session_id: Option<String>,
    first_error: Option<String>,
    previous_text: HashMap<String, String>,
    started_tools: HashSet<String>,
    counter: u64,
    workspace_root: Option<PathBuf>,
}

enum Part {
    Text {
        id: String,
        text: String,
    },
    Reasoning {
        id: String,
        text: String,
    },
    Tool {
        id: String,
        name: String,
        input: Option<String>,
        output: Option<String>,
        status: ToolStatus,
        file_changes: Option<Vec<FileChange>>,
    },
}

#[derive(PartialEq, Eq)]
enum ToolStatus {
    Started,
    Completed,
    Errored,
}

impl OpenCodeParser {
    pub fn new(session_id: String, turn_id: String) -> Self {
        OpenCodeParser {
            session_id,
            turn_id,
            observed_session_id: None,
            first_error: None,
            previous_text: HashMap::new(),
            started_tools: HashSet::new(),
            counter: 0,
            workspace_root: None,
        }
    }

    /// The directory the turn runs in, used to shorten reported file paths.
    ///
    /// opencode sends a `relativePath`, but it is only relative when its own
    /// path arithmetic works out; on macOS, where `/var` is a symlink to
    /// `/private/var`, it comes back as a stripped absolute path. Keeping the
    /// root here lets that be corrected rather than rendered.
    pub fn rooted_at(mut self, root: &Path) -> Self {
        let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
        self.workspace_root = Some(canonical);
        self
    }

    /// The opencode-side session id, needed to resume this conversation later.
    pub fn observed_session_id(&self) -> Option<&str> {
        self.observed_session_id.as_deref()
    }

    /// The first error seen. Later errors are usually fallout from the first.
    pub fn error_message(&self) -> Option<&str> {
        self.first_error.as_deref()
    }

    fn next_id(&mut self) -> String {
        self.counter += 1;
        format!("{}-{}-{}", self.turn_id, self.counter, now_nanos())
    }

    pub fn parse_line(&mut self, line: &str) -> Vec<RuntimeEvent> {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return Vec::new();
        };

        if let Some(found) = find_string_by_key(&value, &["sessionID", "sessionId", "session_id"]) {
            self.observed_session_id = Some(found);
        }

        let raw_type = value
            .get("type")
            .or_else(|| value.pointer("/event/type"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();

        if let Some(message) = extract_error_message(&value, &raw_type) {
            self.first_error.get_or_insert(message);
        }

        let mut events = Vec::new();
        for part in extract_parts(&value, &raw_type, self.workspace_root.as_deref()) {
            match part {
                Part::Text { id, text } => {
                    if let Some(delta) = self.delta_for(&id, &text) {
                        let event_id = self.next_id();
                        events.push(RuntimeEvent::TextDelta {
                            id: event_id,
                            session_id: self.session_id.clone(),
                            timestamp: now(),
                            turn_id: self.turn_id.clone(),
                            block_id: id,
                            text: delta,
                        });
                    }
                }
                Part::Reasoning { id, text } => {
                    if let Some(delta) = self.delta_for(&id, &text) {
                        let event_id = self.next_id();
                        events.push(RuntimeEvent::ReasoningDelta {
                            id: event_id,
                            session_id: self.session_id.clone(),
                            timestamp: now(),
                            turn_id: self.turn_id.clone(),
                            block_id: id,
                            text: delta,
                        });
                    }
                }
                Part::Tool {
                    id,
                    name,
                    input,
                    output,
                    status,
                    file_changes,
                } => match status {
                    ToolStatus::Errored => {
                        let event_id = self.next_id();
                        events.push(RuntimeEvent::ToolCallErrored {
                            id: event_id,
                            session_id: self.session_id.clone(),
                            timestamp: now(),
                            turn_id: self.turn_id.clone(),
                            block_id: id,
                            name: Some(name),
                            message: output.unwrap_or_else(|| "Tool call failed.".into()),
                        });
                    }
                    ToolStatus::Completed => {
                        let event_id = self.next_id();
                        events.push(RuntimeEvent::ToolCallCompleted {
                            id: event_id,
                            session_id: self.session_id.clone(),
                            timestamp: now(),
                            turn_id: self.turn_id.clone(),
                            block_id: id,
                            name: Some(name),
                            input,
                            output,
                            file_changes,
                        });
                    }
                    ToolStatus::Started => {
                        if self.started_tools.insert(id.clone()) {
                            let event_id = self.next_id();
                            events.push(RuntimeEvent::ToolCallStarted {
                                id: event_id,
                                session_id: self.session_id.clone(),
                                timestamp: now(),
                                turn_id: self.turn_id.clone(),
                                block_id: id,
                                name,
                                input,
                            });
                        }
                    }
                },
            }
        }
        events
    }

    /// The grown suffix, or the whole value if the text was rewritten rather
    /// than appended. `None` when nothing changed.
    fn delta_for(&mut self, block_id: &str, text: &str) -> Option<String> {
        if text.is_empty() {
            return None;
        }
        let previous = self
            .previous_text
            .get(block_id)
            .cloned()
            .unwrap_or_default();
        let delta = if text.starts_with(&previous) {
            text[previous.len()..].to_string()
        } else {
            text.to_string()
        };
        self.previous_text
            .insert(block_id.to_string(), text.to_string());
        (!delta.is_empty()).then_some(delta)
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn now_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

fn collect_objects(value: &Value, out: &mut Vec<Value>) {
    match value {
        Value::Object(map) => {
            out.push(value.clone());
            for nested in map.values() {
                collect_objects(nested, out);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_objects(item, out);
            }
        }
        _ => {}
    }
}

fn looks_like_part(value: &Value) -> bool {
    [
        "type", "kind", "text", "content", "output", "tool", "toolName",
    ]
    .iter()
    .any(|key| value.get(key).is_some())
}

fn read_text(value: &Value) -> Option<String> {
    for key in ["text", "content", "markdown", "message"] {
        match value.get(key) {
            Some(Value::String(text)) => return Some(text.clone()),
            Some(Value::Array(items)) => {
                let joined: String = items.iter().filter_map(read_text).collect();
                if !joined.is_empty() {
                    return Some(joined);
                }
            }
            _ => {}
        }
    }
    None
}

fn stringify(value: Option<&Value>) -> Option<String> {
    match value {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => Some(text.clone()),
        Some(other) => serde_json::to_string(other).ok(),
    }
}

fn is_reasoning(part_type: &str) -> bool {
    part_type.contains("reasoning")
        || part_type.contains("thinking")
        || part_type.contains("thought")
}

/// opencode nests a tool call's real payload under `state`:
/// `{ status, input, output, metadata: { files: [...] } }`. Earlier code here
/// read `state` as a status string, which is why tool calls arrived named
/// "tool" with no input at all.
fn tool_state(part: &Value) -> Option<&Value> {
    part.get("state").filter(|state| state.is_object())
}

/// Per-file line counts, which opencode has already computed. Preferring its
/// numbers over anything derived from the patch text means the summary agrees
/// with what the harness actually did.
/// Shorten a reported path against the workspace root.
///
/// Tries the absolute path first: it is the one opencode is reliable about.
/// Anything still absolute after this is left alone rather than mangled — a
/// long path is worse to read than a short one, but a wrong one is worse still.
fn relativize(root: Option<&Path>, file: &Value) -> Option<String> {
    let absolute = file.get("filePath").and_then(Value::as_str);
    if let (Some(root), Some(absolute)) = (root, absolute) {
        let canonical = Path::new(absolute)
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(absolute));
        if let Ok(relative) = canonical.strip_prefix(root) {
            return Some(relative.to_string_lossy().into_owned());
        }
    }

    let reported = file
        .get("relativePath")
        .and_then(Value::as_str)
        .or(absolute)?;
    Some(reported.to_string())
}

fn read_file_changes(part: &Value, root: Option<&Path>) -> Option<Vec<FileChange>> {
    let files = tool_state(part)?
        .get("metadata")?
        .get("files")?
        .as_array()?;

    let changes: Vec<FileChange> = files
        .iter()
        .filter_map(|file| {
            // The absolute path is machine-specific and too long to render.
            let path = relativize(root, file)?;
            Some(FileChange {
                path,
                additions: file.get("additions").and_then(Value::as_u64).unwrap_or(0) as u32,
                deletions: file.get("deletions").and_then(Value::as_u64).unwrap_or(0) as u32,
            })
        })
        .collect();

    (!changes.is_empty()).then_some(changes)
}

fn is_tool(part_type: &str, raw_type: &str, part: &Value) -> bool {
    part_type.contains("tool")
        || raw_type.to_lowercase().contains("tool")
        || part.get("tool").is_some()
        || part.get("toolName").is_some()
        || part.get("args").is_some()
        || part.get("arguments").is_some()
}

fn read_tool_status(part_type: &str, raw_type: &str, part: &Value) -> ToolStatus {
    let status = part
        .get("status")
        .and_then(Value::as_str)
        .or_else(|| tool_state(part).and_then(|state| state.get("status")?.as_str()))
        // Some harnesses put the status directly on `state` as a string.
        .or_else(|| part.get("state").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| format!("{raw_type}{part_type}"))
        .to_lowercase();

    if status.contains("error") || status.contains("failed") {
        return ToolStatus::Errored;
    }
    if ["after", "complete", "result", "finished"]
        .iter()
        .any(|marker| status.contains(marker))
    {
        return ToolStatus::Completed;
    }
    ToolStatus::Started
}

fn extract_parts(raw: &Value, raw_type: &str, root: Option<&Path>) -> Vec<Part> {
    // opencode names the real payload: `{ type, part: { ... } }`. Take it
    // directly rather than flattening the frame, because a tool part contains
    // nested objects — `state`, `state.metadata` — that are shaped enough like
    // parts to be collected as extra ones. That produced a second, unnamed
    // tool call for every real one, and doubled the completions.
    let mut candidates: Vec<Value> = Vec::new();
    match raw.get("part") {
        Some(part) if part.is_object() => candidates.push(part.clone()),
        _ => collect_objects(raw, &mut candidates),
    }

    let mut parts = Vec::new();
    for (index, part) in candidates.iter().filter(|v| looks_like_part(v)).enumerate() {
        let part_type = part
            .get("type")
            .or_else(|| part.get("kind"))
            .and_then(Value::as_str)
            .unwrap_or(raw_type)
            .to_lowercase();

        let id = ["id", "partID", "partId", "toolCallID", "toolCallId"]
            .iter()
            .find_map(|key| part.get(*key).and_then(Value::as_str))
            .map(str::to_string)
            .unwrap_or_else(|| {
                format!(
                    "{}-{index}",
                    if raw_type.is_empty() {
                        "part"
                    } else {
                        raw_type
                    }
                )
            });

        if is_reasoning(&part_type) {
            if let Some(text) = read_text(part) {
                parts.push(Part::Reasoning { id, text });
            }
            continue;
        }

        if is_tool(&part_type, raw_type, part) {
            let name = ["name", "tool", "toolName"]
                .iter()
                .find_map(|key| part.get(*key).and_then(Value::as_str))
                .unwrap_or("tool")
                .to_string();
            let state = tool_state(part);
            let from_state = |key: &str| state.and_then(|state| state.get(key));
            parts.push(Part::Tool {
                id,
                name,
                input: stringify(
                    from_state("input")
                        .or_else(|| part.get("input"))
                        .or_else(|| part.get("args"))
                        .or_else(|| part.get("arguments")),
                ),
                output: stringify(from_state("output"))
                    .or_else(|| read_text(part))
                    .or_else(|| stringify(part.get("output").or_else(|| part.get("error")))),
                status: read_tool_status(&part_type, raw_type, part),
                file_changes: read_file_changes(part, root),
            });
            continue;
        }

        if let Some(text) = read_text(part) {
            parts.push(Part::Text { id, text });
        }
    }

    // Nothing matched but the envelope itself carries text.
    if parts.is_empty() {
        if let Some(text) = read_text(raw) {
            let id = if raw_type.is_empty() {
                "text".to_string()
            } else {
                raw_type.to_string()
            };
            if is_reasoning(&raw_type.to_lowercase()) {
                parts.push(Part::Reasoning { id, text });
            } else {
                parts.push(Part::Text { id, text });
            }
        }
    }
    parts
}

fn extract_error_message(raw: &Value, raw_type: &str) -> Option<String> {
    let maybe_error = raw.get("error").or_else(|| raw.get("err"));
    if !raw_type.to_lowercase().contains("error") && maybe_error.is_none() {
        return None;
    }

    let name = find_string_by_key(raw, &["name"]);
    let message = find_string_by_key(raw, &["message"])
        .or_else(|| maybe_error.and_then(read_text))
        .or_else(|| stringify(maybe_error));
    let reference = find_string_by_key(raw, &["ref", "reference"]);

    let message = message?;
    let prefix = match name.as_deref() {
        Some(name) if name != "Error" => format!("{name}: "),
        _ => String::new(),
    };
    let suffix = reference
        .map(|reference| format!(" ({reference})"))
        .unwrap_or_default();
    Some(format!("{prefix}{message}{suffix}"))
}

fn find_string_by_key(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(Value::String(found)) = map.get(*key) {
                    return Some(found.clone());
                }
            }
            map.values()
                .find_map(|nested| find_string_by_key(nested, keys))
        }
        Value::Array(items) => items.iter().find_map(|item| find_string_by_key(item, keys)),
        _ => None,
    }
}
