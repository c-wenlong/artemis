import type { ChatBlock } from "@artemis/core";

/**
 * What the agent edited, derived from the tool calls it made.
 *
 * There is no `file_change` event yet — the host reports tool calls, and an
 * edit is a tool call with a path in its input. Deriving it here keeps the host
 * unchanged until we have seen enough real harness output to design the event
 * properly; when that lands this module is what gets deleted.
 *
 * The counts are a claim about the user's files, so they are only made where
 * the input actually supports them. A file whose input cannot be read is listed
 * with `null` counts and rendered without numbers, rather than being given a
 * confident-looking zero.
 */

export interface FileEdit {
  /** Lines added, or null when the tool input did not say. */
  added: number | null;
  path: string;
  removed: number | null;
}

export interface EditSummary {
  added: number;
  files: FileEdit[];
  removed: number;
}

const EDIT_TOOLS = ["edit", "write", "patch", "replace", "create"];
const PATH_KEYS = ["filePath", "file_path", "path", "file"];

function isEditTool(name: string): boolean {
  const lower = name.toLowerCase();
  return EDIT_TOOLS.some((verb) => lower.includes(verb));
}

function lineCount(value: unknown): number | null {
  if (typeof value !== "string") return null;
  if (value === "") return 0;
  return value.split("\n").length;
}

export function deriveFileEdits(blocks: readonly ChatBlock[]): EditSummary | null {
  const byPath = new Map<string, FileEdit>();

  for (const block of blocks) {
    // Only a call that finished says anything about the file on disk. One still
    // running has not necessarily written, and one that errored did not.
    if (block.type !== "tool_call" || block.status !== "completed") continue;
    if (!isEditTool(block.name) || !block.input) continue;

    let input: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(block.input);
      if (!parsed || typeof parsed !== "object") continue;
      input = parsed as Record<string, unknown>;
    } catch {
      // Not JSON. We cannot name a file, so there is nothing honest to show.
      continue;
    }

    const path = PATH_KEYS.map((key) => input[key]).find(
      (value): value is string => typeof value === "string" && value.length > 0
    );
    if (!path) continue;

    // A write replaces the file, so every line of it is an addition. An edit
    // swaps one string for another, and the delta is the two line counts.
    const written = lineCount(input.content);
    const added = written ?? lineCount(input.newString ?? input.new_string);
    const removed = written === null ? lineCount(input.oldString ?? input.old_string) : 0;

    const existing = byPath.get(path);
    if (!existing) {
      byPath.set(path, { added, path, removed });
      continue;
    }
    // Repeated edits to one file read as one row.
    existing.added = sum(existing.added, added);
    existing.removed = sum(existing.removed, removed);
  }

  if (byPath.size === 0) return null;

  const files = [...byPath.values()];
  return {
    added: files.reduce((total, file) => total + (file.added ?? 0), 0),
    files,
    removed: files.reduce((total, file) => total + (file.removed ?? 0), 0)
  };
}

function sum(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}
