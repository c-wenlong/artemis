/**
 * Finding file references in prose.
 *
 * The difficulty is not matching filenames, it is declining to match the many
 * things in English that look like one. "Node.js", "e.g." and "version 1.5" all
 * fit `word.word`, and chipping them would make the transcript worse, not
 * better. So a bare token is never enough on its own: a reference is only
 * chipped when something corroborates it —
 *
 *   - a line suffix, `AGENTS.md (line 7)` or `reduce.ts:42`
 *   - a path separator, `home/AGENTS.md`
 *   - or the file having actually been touched in this turn, passed in `known`
 *
 * The cost of that rule is a missed chip on a bare filename the agent only
 * mentioned. That is the right way round: a missed chip reads as plain prose,
 * a false one reads as a bug.
 */

export type FileKind = "shell" | "doc" | "data" | "code";

export interface FileRefPart {
  kind: "ref";
  line?: number;
  path: string;
}

export interface TextPart {
  kind: "text";
  value: string;
}

export type ProsePart = FileRefPart | TextPart;

const SHELL = new Set(["sh", "bash", "zsh", "fish", "ps1", "bat", "cmd"]);
const DOC = new Set(["md", "mdx", "txt", "rst", "adoc"]);
const DATA = new Set(["json", "yaml", "yml", "toml", "ini", "csv", "xml", "lock"]);

export function fileKind(path: string): FileKind {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  // A path with no dot at all lands here too, and `Makefile` is code.
  if (extension === path.toLowerCase()) return "code";
  if (SHELL.has(extension)) return "shell";
  if (DOC.has(extension)) return "doc";
  if (DATA.has(extension)) return "data";
  return "code";
}

// A path-ish token, then optionally " (line N)" or ":N".
const CANDIDATE =
  /([A-Za-z0-9_.\-/]*[A-Za-z0-9_-]\.[A-Za-z][A-Za-z0-9]{0,9})(?:\s*\(line\s+(\d+)\)|:(\d+))?/g;

export function parseFileRefs(text: string, known?: ReadonlySet<string>): ProsePart[] {
  const parts: ProsePart[] = [];
  let cursor = 0;

  for (const match of text.matchAll(CANDIDATE)) {
    const [whole, rawPath, parenLine, colonLine] = match;
    const start = match.index;
    const line = parenLine ?? colonLine;

    // A trailing dot belongs to the sentence, not the path: "home.nix (line 56)."
    const path = rawPath!.replace(/\.$/, "");
    const corroborated =
      line !== undefined || path.includes("/") || Boolean(known?.has(path));
    if (!corroborated) continue;

    if (start > cursor) {
      parts.push({ kind: "text", value: text.slice(cursor, start) });
    }
    parts.push(
      line === undefined
        ? { kind: "ref", path }
        : { kind: "ref", line: Number(line), path }
    );
    cursor = start + whole.length;
  }

  if (cursor < text.length) {
    parts.push({ kind: "text", value: text.slice(cursor) });
  }
  return parts;
}
