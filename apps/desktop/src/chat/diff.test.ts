import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./diff";

/** The exact shape opencode sends: an `Index:` preamble and absolute paths. */
const OPENCODE_PATCH = `Index: /work/sandbox/seed.txt
===================================================================
--- /work/sandbox/seed.txt
+++ /work/sandbox/seed.txt
@@ -1,3 +1,4 @@
 alpha
 beta
 gamma
+delta
`;

describe("parseUnifiedDiff", () => {
  it("reads the hunk header and its lines", () => {
    const hunks = parseUnifiedDiff(OPENCODE_PATCH);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.header).toBe("@@ -1,3 +1,4 @@");
    expect(hunks[0]!.lines).toEqual([
      { kind: "context", newNumber: 1, oldNumber: 1, text: "alpha" },
      { kind: "context", newNumber: 2, oldNumber: 2, text: "beta" },
      { kind: "context", newNumber: 3, oldNumber: 3, text: "gamma" },
      { kind: "added", newNumber: 4, oldNumber: null, text: "delta" }
    ]);
  });

  it("drops the preamble rather than rendering it as content", () => {
    const text = parseUnifiedDiff(OPENCODE_PATCH)
      .flatMap((hunk) => hunk.lines)
      .map((line) => line.text);
    expect(text.some((line) => line.includes("Index:"))).toBe(false);
    expect(text.some((line) => line.includes("/work/sandbox"))).toBe(false);
  });

  it("numbers removals on the old side only", () => {
    const hunks = parseUnifiedDiff(
      "@@ -1,3 +1,2 @@\n one\n-two\n three\n"
    );
    expect(hunks[0]!.lines).toEqual([
      { kind: "context", newNumber: 1, oldNumber: 1, text: "one" },
      { kind: "removed", newNumber: null, oldNumber: 2, text: "two" },
      { kind: "context", newNumber: 2, oldNumber: 3, text: "three" }
    ]);
  });

  it("handles several hunks in one file", () => {
    const hunks = parseUnifiedDiff(
      "@@ -1,1 +1,2 @@\n a\n+b\n@@ -10,1 +11,2 @@\n j\n+k\n"
    );
    expect(hunks).toHaveLength(2);
    expect(hunks[1]!.lines[0]).toEqual({
      kind: "context",
      newNumber: 11,
      oldNumber: 10,
      text: "j"
    });
  });

  it("keeps a line that is genuinely blank", () => {
    const hunks = parseUnifiedDiff("@@ -1,2 +1,2 @@\n \n a\n");
    expect(hunks[0]!.lines[0]!.text).toBe("");
  });

  it("ignores the no-newline marker", () => {
    const hunks = parseUnifiedDiff(
      "@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b\n"
    );
    expect(hunks[0]!.lines.map((line) => line.kind)).toEqual(["removed", "added"]);
  });

  it("returns nothing for something that is not a diff", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("just some prose")).toEqual([]);
  });
});
