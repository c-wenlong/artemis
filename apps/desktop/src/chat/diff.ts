/**
 * Unified-diff parsing, for rendering only.
 *
 * Deliberately not a general diff library. It reads the hunks a harness sends
 * and gives them line numbers; it does not apply anything. Undo reverse-applies
 * the original patch text through `git apply` in the host, which is the only
 * thing that can do it safely.
 */

export type DiffLineKind = "added" | "removed" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  /** Line number on the new side, or null for a removal. */
  newNumber: number | null;
  /** Line number on the old side, or null for an addition. */
  oldNumber: number | null;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

/** "@@ -1,3 +1,4 @@" — the two starting line numbers are what we need. */
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldNumber = 0;
  let newNumber = 0;

  for (const line of patch.split("\n")) {
    const start = HUNK.exec(line);
    if (start) {
      current = { header: line.trimEnd(), lines: [] };
      hunks.push(current);
      oldNumber = Number(start[1]);
      newNumber = Number(start[2]);
      continue;
    }

    // Everything before the first hunk is the preamble — `Index:`, the rule of
    // equals signs, and the `---`/`+++` pair. None of it is content, and the
    // paths in it are absolute and machine-specific.
    if (!current) continue;

    // "\ No newline at end of file" annotates the previous line.
    if (line.startsWith("\\")) continue;

    const marker = line[0];
    const text = line.slice(1);

    if (marker === "+") {
      current.lines.push({ kind: "added", newNumber, oldNumber: null, text });
      newNumber += 1;
    } else if (marker === "-") {
      current.lines.push({ kind: "removed", newNumber: null, oldNumber, text });
      oldNumber += 1;
    } else if (marker === " ") {
      current.lines.push({ kind: "context", newNumber, oldNumber, text });
      oldNumber += 1;
      newNumber += 1;
    }
    // Anything else is trailing junk between hunks; skip it rather than
    // rendering a line the diff never claimed.
  }

  return hunks;
}

/** Lines added and removed, for a diff whose counts were not reported. */
export function diffStat(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of parseUnifiedDiff(patch)) {
    for (const line of hunk.lines) {
      if (line.kind === "added") added += 1;
      if (line.kind === "removed") removed += 1;
    }
  }
  return { added, removed };
}
