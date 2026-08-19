import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const srcDir = resolve(__dirname, "..");
const tokensPath = join(srcDir, "styles", "tokens.css");

function cssFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return full.endsWith(".css") ? [full] : [];
  });
}

/**
 * Colour literals anywhere except the token sheet. `currentColor`, `inherit`,
 * `transparent`, and `none` are fine: they resolve to something a token set.
 */
const COLOR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(|\boklch\s*\(/;

describe("design tokens", () => {
  it("defines the token sheet", () => {
    expect(() => readFileSync(tokensPath, "utf8")).not.toThrow();
  });

  it("declares the full token contract", () => {
    const css = readFileSync(tokensPath, "utf8");
    // Surfaces, text, borders, state, and the type/space scales. Everything the
    // rest of the app is allowed to reach for.
    const required = [
      "--surface-base",
      "--surface-raised",
      "--surface-overlay",
      "--surface-sunken",
      "--text-primary",
      "--text-secondary",
      "--text-tertiary",
      "--border-subtle",
      "--border-strong",
      "--accent",
      "--state-running",
      "--state-attention",
      "--state-error",
      "--state-idle",
      "--diff-added",
      "--diff-removed",
      "--font-sans",
      "--font-mono",
      "--text-ui",
      "--text-ui-sm",
      "--space-1",
      "--space-2",
      "--space-3",
      "--space-4",
      "--radius-sm",
      "--radius-md",
      "--content-max-width"
    ];
    for (const token of required) {
      expect(css, `${token} must be declared in tokens.css`).toContain(`${token}:`);
    }
  });

  it("ships a dark theme so nothing has to be retrofitted later", () => {
    const css = readFileSync(tokensPath, "utf8");
    expect(css).toMatch(/prefers-color-scheme:\s*dark/);
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain('[data-theme="light"]');
  });

  it("pins light, so a dark-mode OS cannot override the product direction", () => {
    const html = readFileSync(resolve(srcDir, "..", "index.html"), "utf8");
    expect(html).toMatch(/<html[^>]*data-theme="light"/);
  });

  it("lets an explicit theme win over the OS preference", () => {
    const css = readFileSync(tokensPath, "utf8");
    // Unscoped, `@media (prefers-color-scheme: dark) { :root { … } }` would beat
    // `[data-theme="light"]` on any dark-mode machine.
    const darkMedia = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    const selector = darkMedia.slice(0, darkMedia.indexOf("{", darkMedia.indexOf("{") + 1));
    expect(selector).toContain(":root:not([data-theme])");
  });

  it("hardcodes no colour outside the token sheet", () => {
    const offenders: string[] = [];
    for (const file of cssFiles(srcDir)) {
      if (file === tokensPath) continue;
      const contents = readFileSync(file, "utf8");
      contents.split("\n").forEach((line, index) => {
        const withoutComments = line.replace(/\/\*.*?\*\//g, "");
        if (COLOR_LITERAL.test(withoutComments)) {
          offenders.push(`${relative(srcDir, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `colour literals must live in tokens.css:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
