//! Claude Code, from `claude --print --output-format stream-json --verbose`.
//!
//! The envelope came from a live run; the content blocks are the Anthropic
//! Messages shapes, read out of Claude Code's own session logs on disk:
//!
//! ```text
//! {"type":"system","subtype":"init","session_id":"bb50f838-…"}
//! {"type":"system","subtype":"hook_started",…}          ← machinery
//! {"type":"assistant","message":{"content":[{"type":"text","text":"…"}]}}
//! {"type":"user","message":{"content":[{"type":"tool_result",…}]}}
//! {"type":"result","subtype":"success","is_error":false}
//! ```
//!
//! Blocks observed: `text`, `thinking`, `tool_use`, `tool_result`.
//!
//! The `user` frames are not the user. Claude Code reports a tool's output as a
//! user-role message, because that is how the Messages API models it: reading
//! them as prompts would put the model's own tool output in the transcript as
//! something the human said.

use serde_json::Value;

use super::{HarnessAdapter, Stamp};
use crate::types::RuntimeEvent;

pub struct ClaudeAdapter {
    stamp: Stamp,
    session_id_seen: Option<String>,
    first_error: Option<String>,
}

impl ClaudeAdapter {
    pub fn new(session_id: String, turn_id: String) -> Self {
        ClaudeAdapter {
            stamp: Stamp::new(session_id, turn_id),
            session_id_seen: None,
            first_error: None,
        }
    }

    fn event(&mut self, block: &Value) -> Option<RuntimeEvent> {
        let block_type = block.get("type").and_then(Value::as_str)?;
        let id = self.stamp.next_id();
        let session_id = self.stamp.session_id.clone();
        let turn_id = self.stamp.turn_id.clone();
        let timestamp = self.stamp.now();

        match block_type {
            "text" => Some(RuntimeEvent::TextDelta {
                id,
                session_id,
                timestamp,
                turn_id,
                block_id: block
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("text")
                    .to_string(),
                text: block.get("text")?.as_str()?.to_string(),
            }),

            "thinking" => Some(RuntimeEvent::ReasoningDelta {
                id,
                session_id,
                timestamp,
                turn_id,
                block_id: "thinking".to_string(),
                text: block.get("thinking")?.as_str()?.to_string(),
            }),

            "tool_use" => Some(RuntimeEvent::ToolCallStarted {
                id,
                session_id,
                timestamp,
                turn_id,
                agent: None,
                block_id: block.get("id")?.as_str()?.to_string(),
                name: block.get("name")?.as_str()?.to_string(),
                // The arguments are an object here, unlike opencode's string.
                input: block.get("input").map(|input| input.to_string()),
            }),

            // Pairs with the `tool_use` that has the same id, which is what
            // closes the block the transcript is showing as running.
            "tool_result" => {
                let block_id = block.get("tool_use_id")?.as_str()?.to_string();
                let output = block.get("content").map(|content| match content.as_str() {
                    Some(text) => text.to_string(),
                    None => content.to_string(),
                });

                if block
                    .get("is_error")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    return Some(RuntimeEvent::ToolCallErrored {
                        id,
                        session_id,
                        timestamp,
                        turn_id,
                        agent: None,
                        block_id,
                        name: None,
                        message: output.unwrap_or_else(|| "The tool failed.".into()),
                    });
                }

                Some(RuntimeEvent::ToolCallCompleted {
                    id,
                    session_id,
                    timestamp,
                    turn_id,
                    agent: None,
                    block_id,
                    name: None,
                    // The arguments were on the `tool_use`; only the result is
                    // here, and the reducer keeps what the start event carried.
                    input: None,
                    output,
                    file_changes: None,
                })
            }

            _ => None,
        }
    }
}

impl HarnessAdapter for ClaudeAdapter {
    fn parse_line(&mut self, line: &str) -> Vec<RuntimeEvent> {
        let Ok(frame) = serde_json::from_str::<Value>(line.trim()) else {
            return Vec::new();
        };
        let Some(frame_type) = frame.get("type").and_then(Value::as_str) else {
            return Vec::new();
        };

        if let Some(id) = frame.get("session_id").and_then(Value::as_str) {
            self.session_id_seen.get_or_insert_with(|| id.to_string());
        }

        match frame_type {
            // `init` carries the session id, already taken above. Hook frames
            // are Claude Code's own machinery: a PreToolUse hook firing is not
            // part of the conversation.
            "system" => Vec::new(),

            "result" => {
                if frame
                    .get("is_error")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    self.first_error.get_or_insert_with(|| {
                        frame
                            .get("result")
                            .and_then(Value::as_str)
                            .unwrap_or("The run failed.")
                            .to_string()
                    });
                }
                // The run loop writes the turn's terminal event; it knows the
                // exit code, which this frame does not always reflect.
                Vec::new()
            }

            // Both roles carry content blocks. `user` here means tool output,
            // not a prompt: see the module note.
            "assistant" | "user" => {
                let Some(content) = frame
                    .get("message")
                    .and_then(|message| message.get("content"))
                    .and_then(Value::as_array)
                else {
                    return Vec::new();
                };
                content
                    .iter()
                    .filter_map(|block| self.event(block))
                    .collect()
            }

            _ => Vec::new(),
        }
    }

    fn observed_session_id(&self) -> Option<&str> {
        self.session_id_seen.as_deref()
    }

    fn error_message(&self) -> Option<&str> {
        self.first_error.as_deref()
    }
}
