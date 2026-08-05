import type {
  AgentLaunchRequest,
  AgentLaunchResult,
  HarnessAsset
} from "@artemis/core";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

interface LaunchNodeAgentOptions {
  harnesses: HarnessAsset[];
  request: AgentLaunchRequest;
  timeoutMs?: number;
}

interface LaunchCommand {
  args: string[];
  command: string;
}

export async function launchNodeAgent({
  harnesses,
  request,
  timeoutMs = 12_000
}: LaunchNodeAgentOptions): Promise<AgentLaunchResult> {
  const startedAt = new Date().toISOString();
  const cwd = resolve(request.workspacePath, request.startPath ?? ".");
  const harness = harnesses.find((candidate) => candidate.id === request.harnessId);

  if (!harness || harness.health !== "ready" || !harness.executablePath) {
    return failedLaunch({
      cwd,
      error: `Harness ${request.harnessId} is not ready or has no executable path.`,
      request,
      startedAt
    });
  }

  if (!isDirectory(cwd)) {
    return failedLaunch({
      command: harness.executablePath,
      cwd,
      error: `Start path does not exist or is not a directory: ${cwd}`,
      request,
      startedAt
    });
  }

  if (harness.kind === "amp" && !hasAmpCredentials()) {
    return failedLaunch({
      command: harness.executablePath,
      cwd,
      error:
        "Amp is installed, but it is not authenticated for non-interactive launches. Run `amp login` or set AMP_API_KEY, then launch Amp again.",
      request,
      startedAt
    });
  }

  const launch = commandForHarness(harness, request.prompt);
  if (!launch) {
    return failedLaunch({
      command: harness.executablePath,
      cwd,
      error: `No non-interactive launch adapter exists for ${harness.label} yet.`,
      request,
      startedAt
    });
  }

  return runLaunchCommand({
    command: launch.command,
    args: launch.args,
    cwd,
    startedAt,
    timeoutMs: harness.kind === "pi" ? Math.max(timeoutMs, 30_000) : timeoutMs
  });
}

function commandForHarness(
  harness: HarnessAsset,
  prompt: string
): LaunchCommand | null {
  const command = harness.executablePath ?? harness.command;
  switch (harness.kind) {
    case "pi":
      return {
        command,
        args: ["--print", prompt]
      };
    case "amp":
      return {
        command,
        args: ["--no-color", "--no-notifications", "-x", prompt]
      };
    case "codex":
      return {
        command,
        args: ["exec", prompt]
      };
    case "claude":
      return {
        command,
        args: ["-p", prompt]
      };
    case "gemini":
      return {
        command,
        args: ["-p", prompt]
      };
    default:
      return null;
  }
}

function runLaunchCommand({
  args,
  command,
  cwd,
  startedAt,
  timeoutMs
}: {
  args: string[];
  command: string;
  cwd: string;
  startedAt: string;
  timeoutMs: number;
}): Promise<AgentLaunchResult> {
  return new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(command, args, {
      cwd,
      detached: true,
      env: {
        ...process.env,
        NO_COLOR: "1",
        PATH: launchPath()
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      } else {
        child.kill("SIGTERM");
      }
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish({
        errorMessage: error.message,
        exitCode: undefined
      });
    });
    child.on("close", (exitCode) => {
      finish({
        exitCode: exitCode ?? undefined
      });
    });

    function finish({
      errorMessage,
      exitCode
    }: {
      errorMessage?: string;
      exitCode?: number;
    }) {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);

      const authError = stdout.includes("No API key found")
        ? "Amp is installed, but AMP_API_KEY is not configured. Run `amp login` or set AMP_API_KEY before launching Amp."
        : undefined;
      const timeoutError =
        timedOut && requestHarnessLooksLikeAmp(command)
          ? "Amp did not return before the launch timeout. It is likely waiting for `amp login` or AMP_API_KEY; configure Amp, then launch again."
          : undefined;
      const failed = Boolean(errorMessage) || exitCode !== 0 || Boolean(authError);

      resolveResult({
        args,
        command,
        completedAt: new Date().toISOString(),
        cwd,
        error: authError ?? timeoutError ?? errorMessage,
        exitCode,
        ok: !failed && !timedOut,
        startedAt,
        stderr: cleanTerminalText(stderr),
        stdout: cleanTerminalText(stdout),
        timedOut: timedOut || undefined
      }
      );
    }
  });
}

function launchPath(): string {
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/Users/example/.local/bin",
    process.env.PATH ?? ""
  ]
    .filter(Boolean)
    .join(":");
}

function requestHarnessLooksLikeAmp(command: string): boolean {
  return command.endsWith("/amp") || command === "amp";
}

function failedLaunch({
  command,
  cwd,
  error,
  request,
  startedAt
}: {
  command?: string;
  cwd: string;
  error: string;
  request: AgentLaunchRequest;
  startedAt: string;
}): AgentLaunchResult {
  return {
    args: [],
    command: command ?? request.harnessId,
    completedAt: new Date().toISOString(),
    cwd,
    error,
    ok: false,
    startedAt,
    stderr: "",
    stdout: ""
  };
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function hasAmpCredentials(): boolean {
  if (process.env.AMP_API_KEY) return true;
  const homeDir = process.env.HOME;
  if (!homeDir) return false;
  return existsSync(resolve(homeDir, ".config/amp/settings.json"));
}

function cleanTerminalText(value: string): string {
  return value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B[=>][0-9]*[a-zA-Z]/g, "")
    .replace(/authToken=[A-Za-z0-9._-]+/g, "authToken=REDACTED")
    .trim();
}
