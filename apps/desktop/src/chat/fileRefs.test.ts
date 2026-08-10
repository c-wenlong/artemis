import { describe, expect, it } from "vitest";
import { fileKind, parseFileRefs } from "./fileRefs";

/**
 * The hard part here is not finding filenames, it is refusing to find them in
 * ordinary prose. "Node.js" and "e.g." are shaped exactly like files, so a
 * bare token is only chipped when something corroborates it: a line suffix, a
 * path separator, or the file having actually been touched this turn.
 */
describe("parseFileRefs", () => {
  it("leaves prose alone", () => {
    expect(parseFileRefs("The right next step is to migrate deliberately.")).toEqual([
      { kind: "text", value: "The right next step is to migrate deliberately." }
    ]);
  });

  it("reads a file with a line number", () => {
    expect(parseFileRefs("see AGENTS.md (line 7) for context")).toEqual([
      { kind: "text", value: "see " },
      { kind: "ref", line: 7, path: "AGENTS.md" },
      { kind: "text", value: " for context" }
    ]);
  });

  it("reads a path with directories", () => {
    const parsed = parseFileRefs("home/AGENTS.md (line 1) is the policy");
    expect(parsed[0]).toEqual({ kind: "ref", line: 1, path: "home/AGENTS.md" });
  });

  it("accepts the colon form harnesses emit", () => {
    expect(parseFileRefs("src/chat/reduce.ts:42")[0]).toEqual({
      kind: "ref",
      line: 42,
      path: "src/chat/reduce.ts"
    });
  });

  it("chips a bare filename only when the turn actually touched it", () => {
    const known = new Set(["configuration.nix"]);
    expect(parseFileRefs("Edited configuration.nix today", known)[1]).toEqual({
      kind: "ref",
      path: "configuration.nix"
    });
    expect(parseFileRefs("Edited configuration.nix today")).toEqual([
      { kind: "text", value: "Edited configuration.nix today" }
    ]);
  });

  it("does not mistake prose for a filename", () => {
    for (const prose of [
      "we use Node.js here",
      "e.g. this one",
      "version 1.5 shipped",
      "an ordinary sentence."
    ]) {
      expect(parseFileRefs(prose), prose).toEqual([{ kind: "text", value: prose }]);
    }
  });

  it("finds several references in one line", () => {
    const parsed = parseFileRefs("flake.nix (line 4) pins it, home.nix (line 11) does not");
    expect(parsed.filter((part) => part.kind === "ref")).toHaveLength(2);
  });

  it("keeps a trailing sentence period out of the path", () => {
    const parsed = parseFileRefs("declared in home.nix (line 56).");
    expect(parsed.at(-1)).toEqual({ kind: "text", value: "." });
  });
});

describe("fileKind", () => {
  it("gives shell scripts the dollar sign", () => {
    expect(fileKind("bootstrap.sh")).toBe("shell");
    expect(fileKind("deploy/rebuild.zsh")).toBe("shell");
  });

  it("gives prose files the document icon", () => {
    expect(fileKind("AGENTS.md")).toBe("doc");
    expect(fileKind("notes.txt")).toBe("doc");
  });

  it("separates data from code", () => {
    expect(fileKind("tauri.conf.json")).toBe("data");
    expect(fileKind("flake.nix")).toBe("code");
  });

  it("falls back rather than throwing on something unrecognised", () => {
    expect(fileKind("Makefile")).toBe("code");
    expect(fileKind("")).toBe("code");
  });
});
