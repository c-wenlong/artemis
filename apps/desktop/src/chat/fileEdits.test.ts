import type { ChatBlock } from "@artemis/core";
import { describe, expect, it } from "vitest";
import { deriveFileEdits } from "./fileEdits";

function tool(
  name: string,
  input: unknown,
  status: ChatBlock["status"] = "completed"
): ChatBlock {
  return {
    id: `tool-${name}-${JSON.stringify(input).length}`,
    input: JSON.stringify(input),
    name,
    status,
    type: "tool_call"
  };
}

/**
 * The counts on this card are a claim about the user's files. Anywhere the tool
 * input does not actually support a number, the file is listed without one
 * rather than given a plausible-looking zero.
 */
describe("deriveFileEdits", () => {
  it("says nothing when nothing was edited", () => {
    expect(deriveFileEdits([])).toBeNull();
    expect(
      deriveFileEdits([{ id: "t", name: "read", status: "completed", type: "tool_call" }])
    ).toBeNull();
  });

  it("counts a write as every line added", () => {
    const summary = deriveFileEdits([
      tool("write", { content: "one\ntwo\nthree", filePath: "NOTES.md" })
    ]);
    expect(summary).toEqual({
      added: 3,
      files: [{ added: 3, path: "NOTES.md", removed: 0 }],
      removed: 0
    });
  });

  it("counts an edit as the difference between the two strings", () => {
    const summary = deriveFileEdits([
      tool("edit", {
        filePath: "flake.nix",
        newString: "a\nb\nc",
        oldString: "a"
      })
    ]);
    expect(summary?.files).toEqual([{ added: 3, path: "flake.nix", removed: 1 }]);
  });

  it("sums repeated edits to one file into a single row", () => {
    const summary = deriveFileEdits([
      tool("edit", { filePath: "a.ts", newString: "x\ny", oldString: "x" }),
      tool("edit", { filePath: "a.ts", newString: "q", oldString: "q\nr" })
    ]);
    expect(summary?.files).toHaveLength(1);
    expect(summary?.files[0]).toEqual({ added: 3, path: "a.ts", removed: 3 });
  });

  it("totals across files", () => {
    const summary = deriveFileEdits([
      tool("write", { content: "one", filePath: "AGENTS.md" }),
      tool("write", { content: "a\nb", filePath: "HANDOFF.md" })
    ]);
    expect(summary?.added).toBe(3);
    expect(summary?.removed).toBe(0);
    expect(summary?.files.map((file) => file.path)).toEqual([
      "AGENTS.md",
      "HANDOFF.md"
    ]);
  });

  it("ignores an edit that failed", () => {
    expect(
      deriveFileEdits([
        tool("edit", { filePath: "a.ts", newString: "b", oldString: "a" }, "errored")
      ])
    ).toBeNull();
  });

  it("ignores an edit still in flight, whose outcome is not known yet", () => {
    expect(
      deriveFileEdits([
        tool("edit", { filePath: "a.ts", newString: "b", oldString: "a" }, "running")
      ])
    ).toBeNull();
  });

  it("lists a file it cannot count rather than inventing a number", () => {
    const summary = deriveFileEdits([tool("edit", { filePath: "opaque.bin" })]);
    expect(summary?.files).toEqual([{ added: null, path: "opaque.bin", removed: null }]);
    expect(summary?.added).toBe(0);
  });

  it("survives input that is not JSON at all", () => {
    const summary = deriveFileEdits([
      { id: "t", input: "not json {{{", name: "edit", status: "completed", type: "tool_call" }
    ]);
    expect(summary).toBeNull();
  });

  it("recognises the several names harnesses give the same tool", () => {
    for (const name of ["edit", "Edit", "write", "str_replace", "apply_patch", "MultiEdit"]) {
      const summary = deriveFileEdits([
        tool(name, { content: "x", filePath: "f.ts", newString: "x", oldString: "" })
      ]);
      expect(summary, name).not.toBeNull();
    }
  });

  it("reads whichever key the harness used for the path", () => {
    for (const key of ["filePath", "file_path", "path", "file"]) {
      const summary = deriveFileEdits([tool("write", { [key]: "x.ts", content: "a" })]);
      expect(summary?.files[0]?.path, key).toBe("x.ts");
    }
  });
});

/**
 * The counts opencode itself computed, taken from a live run that edited two
 * files. Believing the harness beats anything this module could infer from a
 * patch: `apply_patch` passes one `patchText` blob with no file names in a
 * shape the fallback could read.
 */
describe("deriveFileEdits, from what the harness reported", () => {
  const applyPatch = (
    fileChanges: Array<{ additions: number; deletions: number; path: string }>
  ): ChatBlock => ({
    fileChanges,
    id: `patch-${fileChanges[0]?.path}`,
    input: JSON.stringify({ patchText: "*** Begin Patch\n*** End Patch" }),
    name: "apply_patch",
    output: "Success. Updated the following files:\nM seed.txt",
    status: "completed",
    type: "tool_call"
  });

  it("uses the reported counts", () => {
    const summary = deriveFileEdits([
      applyPatch([{ additions: 1, deletions: 0, path: "seed.txt" }]),
      applyPatch([{ additions: 3, deletions: 0, path: "notes.md" }])
    ]);
    expect(summary).toEqual({
      added: 4,
      files: [
        { added: 1, path: "seed.txt", removed: 0 },
        { added: 3, path: "notes.md", removed: 0 }
      ],
      removed: 0
    });
  });

  it("prefers them over anything guessed from the input", () => {
    const summary = deriveFileEdits([
      {
        fileChanges: [{ additions: 7, deletions: 2, path: "real.ts" }],
        id: "t",
        // A path the fallback would have believed, on a tool it recognises.
        input: JSON.stringify({ content: "a\nb", filePath: "guessed.ts" }),
        name: "write",
        status: "completed",
        type: "tool_call"
      }
    ]);
    expect(summary?.files).toEqual([{ added: 7, path: "real.ts", removed: 2 }]);
  });

  it("still reads a bash call as touching nothing", () => {
    expect(
      deriveFileEdits([
        {
          id: "b",
          input: JSON.stringify({ command: "ls -la" }),
          name: "bash",
          output: "total 8",
          status: "completed",
          type: "tool_call"
        }
      ])
    ).toBeNull();
  });
});
