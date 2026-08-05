import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { HarnessAsset } from "@artemis/core";
import { harnessByToken, knownHarnesses } from "../../harnessCatalog.ts";

interface WorkspaceMention {
  harnessId: string;
  path: string;
}

const extraBinDirs = [
  "~/.local/bin",
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "~/.npm-global/bin",
  "~/go/bin"
];

const workspaceConfigNames = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "CODEX.md",
  "WARP.md",
  ".mcp.json",
  "opencode.json",
  "package.json",
  "pnpm-workspace.yaml",
  "pyproject.toml"
]);

const ignoredDirs = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-electron",
  "build",
  ".next",
  ".turbo",
  "__pycache__"
]);

function expandHome(path: string, homeDir: string): string {
  return path.startsWith("~/") ? join(homeDir, path.slice(2)) : path;
}

function pathDirs(pathEnv: string, homeDir: string): string[] {
  const seen = new Set<string>();
  const raw = [...pathEnv.split(":"), ...extraBinDirs.map((dir) => expandHome(dir, homeDir))];
  const dirs: string[] = [];
  for (const entry of raw) {
    if (!entry) continue;
    const normalized = resolve(entry);
    if (seen.has(normalized)) continue;
    try {
      if (statSync(normalized).isDirectory()) {
        seen.add(normalized);
        dirs.push(normalized);
      }
    } catch {
      // Ignore stale PATH entries.
    }
  }
  return dirs;
}

function executableAt(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function resolveExecutable(command: string, dirs: string[]): string | undefined {
  if (command.includes("/") && executableAt(command)) {
    return command;
  }
  for (const dir of dirs) {
    const candidate = join(dir, command);
    if (executableAt(candidate)) return candidate;
  }
  return undefined;
}

function readVersion(commandPath: string, versionArgs: string[]): string | undefined {
  try {
    const output = execFileSync(commandPath, versionArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1800
    }).trim();
    return output.split(/\r?\n/)[0]?.slice(0, 80) || undefined;
  } catch {
    return undefined;
  }
}

function scanWorkspaceMentions(rootPath: string): WorkspaceMention[] {
  const mentions: WorkspaceMention[] = [];
  const stack = [rootPath];

  while (stack.length > 0 && mentions.length < 200) {
    const current = stack.pop();
    if (!current) continue;

    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry);
      let isDirectory = false;
      try {
        const stat = statSync(fullPath);
        isDirectory = stat.isDirectory();
        if (!isDirectory && stat.size > 250_000) continue;
      } catch {
        continue;
      }

      if (isDirectory) {
        if (!ignoredDirs.has(entry)) stack.push(fullPath);
        continue;
      }

      if (!workspaceConfigNames.has(entry) && !entry.endsWith(".md")) continue;

      let text = "";
      try {
        text = readFileSync(fullPath, "utf8").toLowerCase();
      } catch {
        continue;
      }

      for (const harness of knownHarnesses) {
        const tokens = [harness.id, harness.command, ...harness.aliases].filter(
          (token) => token.length > 1
        );
        if (tokens.some((token) => text.includes(token.toLowerCase()))) {
          mentions.push({
            harnessId: harness.id,
            path: fullPath.replace(`${rootPath}/`, "")
          });
        }
      }
    }
  }

  return mentions;
}

function uniqueMentionPaths(
  mentions: WorkspaceMention[],
  harnessId: string
): string[] {
  return [
    ...new Set(
      mentions
        .filter((mention) => mention.harnessId === harnessId)
        .map((mention) => mention.path)
    )
  ].slice(0, 6);
}

export interface ScanHarnessesOptions {
  includeWorkspaceMentions?: boolean;
  includeVersions?: boolean;
  pathEnv?: string;
  homeDir?: string;
  workspaceRoot: string;
}

export function scanHarnesses(options: ScanHarnessesOptions): HarnessAsset[] {
  const pathEnv = options.pathEnv ?? "";
  const homeDir = options.homeDir ?? "";
  const dirs = pathDirs(pathEnv, homeDir);
  const mentions = options.includeWorkspaceMentions !== false && existsSync(options.workspaceRoot)
    ? scanWorkspaceMentions(options.workspaceRoot)
    : [];

  const assets: HarnessAsset[] = knownHarnesses.map((harness) => {
    const executablePath = resolveExecutable(harness.command, dirs);
    const workspaceMentions = uniqueMentionPaths(mentions, harness.id);
    const foundInWorkspace = workspaceMentions.length > 0;
    const version = executablePath && options.includeVersions !== false
      ? readVersion(executablePath, harness.versionArgs)
      : undefined;

    return {
      id: harness.id,
      kind: harness.kind,
      label: harness.label,
      command: harness.command,
      aliases: harness.aliases,
      description: harness.description,
      executablePath,
      health: executablePath ? "ready" : foundInWorkspace ? "needs-setup" : "missing",
      source: executablePath
        ? "path"
        : foundInWorkspace
          ? "workspace-config"
          : "quiver-catalog",
      version,
      workspaceMentions
    };
  });

  const knownCommands = new Set(knownHarnesses.map((harness) => harness.command));
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (knownCommands.has(entry)) continue;
      if (!entry.endsWith("-code") && !["aider", "factory", "warp"].includes(entry)) {
        continue;
      }
      const executablePath = join(dir, entry);
      if (!executableAt(executablePath)) continue;
      const known = harnessByToken(entry);
      if (known) continue;
      assets.push({
        id: `path-${entry}`,
        kind: "custom",
        label: basename(entry),
        command: entry,
        aliases: [],
        description: "Discovered executable on PATH",
        executablePath,
        health: "ready",
        source: "path",
        version:
          options.includeVersions === false
            ? undefined
            : readVersion(executablePath, ["--version"])
      });
    }
  }

  return assets.sort((a, b) => {
    const healthRank = { ready: 0, "needs-setup": 1, unknown: 2, missing: 3 };
    return healthRank[a.health] - healthRank[b.health] || a.label.localeCompare(b.label);
  });
}
