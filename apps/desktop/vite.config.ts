import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { homedir } from "node:os";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { defineConfig, type Plugin } from "vite";
import type {
  AgentLaunchRequest,
  AssetInventorySnapshot,
  HarnessAsset,
  RuntimeSettings
} from "@artemis/core";
import { launchNodeAgent } from "@artemis/host-service/node/agentLauncher";
import {
  getNodeInventorySnapshot,
  getNodeReviewSnapshot,
  listNodeHarnesses,
  listNodeProjects,
  listNodeSessions,
  listNodeWorkspaces
} from "@artemis/host-service/node/snapshot";

const appDir = fileURLToPath(new URL(".", import.meta.url));
const scanRoot =
  process.env.ARTEMIS_SCAN_ROOT ?? resolve(appDir, "../../../..");
const settingsPath =
  process.env.ARTEMIS_SETTINGS_PATH ?? resolve(homedir(), ".artemis/settings.json");

function sendJson(response: import("node:http").ServerResponse, data: unknown) {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data));
}

function readUrl(request: import("node:http").IncomingMessage): URL {
  return new URL(request.url ?? "/", "http://127.0.0.1");
}

function readBody(request: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolveBody(body));
    request.on("error", reject);
  });
}

function readRuntimeSettings(): RuntimeSettings {
  try {
    if (!existsSync(settingsPath)) return {};
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as RuntimeSettings;
    return sanitizeRuntimeSettings(parsed);
  } catch {
    return {};
  }
}

function writeRuntimeSettings(settings: RuntimeSettings): RuntimeSettings {
  const sanitized = sanitizeRuntimeSettings(settings);
  mkdirSync(resolve(settingsPath, ".."), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(sanitized, null, 2));
  return sanitized;
}

function sanitizeRuntimeSettings(settings: RuntimeSettings): RuntimeSettings {
  const opencodeExecutablePath = settings.opencodeExecutablePath?.trim();
  const opencodeDefaultModel = settings.opencodeDefaultModel?.trim();
  return {
    ...(opencodeDefaultModel ? { opencodeDefaultModel } : {}),
    ...(opencodeExecutablePath ? { opencodeExecutablePath } : {})
  };
}

function listConfiguredHarnesses(options: {
  includeVersions?: boolean;
  includeWorkspaceMentions?: boolean;
}): HarnessAsset[] {
  return applyRuntimeSettingsToHarnesses(
    listNodeHarnesses({
      includeVersions: options.includeVersions,
      includeWorkspaceMentions: options.includeWorkspaceMentions,
      workspaceRoot: scanRoot,
      pathEnv: process.env.PATH,
      homeDir: process.env.HOME
    }),
    readRuntimeSettings()
  );
}

function configuredSnapshot(): AssetInventorySnapshot {
  const snapshot = getNodeInventorySnapshot({
    workspaceRoot: scanRoot,
    pathEnv: process.env.PATH,
    homeDir: process.env.HOME
  });
  return {
    ...snapshot,
    harnesses: applyRuntimeSettingsToHarnesses(
      snapshot.harnesses,
      readRuntimeSettings()
    )
  };
}

function applyRuntimeSettingsToHarnesses(
  harnesses: HarnessAsset[],
  settings: RuntimeSettings
): HarnessAsset[] {
  const configuredOpenCodePath = settings.opencodeExecutablePath;
  if (!configuredOpenCodePath) return harnesses;
  return harnesses.map((harness) => {
    if (harness.id !== "opencode") return harness;
    return {
      ...harness,
      executablePath: configuredOpenCodePath,
      health: executableAt(configuredOpenCodePath) ? "ready" : "needs-setup",
      source: "settings"
    };
  });
}

function executableAt(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// The TypeScript host is a browser-mode reference implementation only. Under
// Tauri the Rust host owns every one of these endpoints, so the middleware must
// not be mounted — otherwise `pnpm dev` would silently serve a second,
// divergent host alongside the real one. `pnpm dev:web` opts back in.
const enableTsHost = process.env.ARTEMIS_TS_HOST === "1";

const tsHostPlugin: Plugin = {
  name: "artemis-local-host-api",
  configureServer(server) {
        server.middlewares.use("/api/artemis/settings", async (request, response) => {
          try {
            if (request.method === "GET") {
              sendJson(response, readRuntimeSettings());
              return;
            }
            if (request.method === "POST" || request.method === "PUT") {
              const settings = JSON.parse(await readBody(request)) as RuntimeSettings;
              sendJson(response, writeRuntimeSettings(settings));
              return;
            }
            response.statusCode = 405;
            response.end("Method not allowed");
          } catch (error) {
            response.statusCode = 500;
            response.setHeader("content-type", "application/json; charset=utf-8");
            response.end(
              JSON.stringify({
                error: error instanceof Error ? error.message : String(error)
              })
            );
          }
        });

        server.middlewares.use("/api/artemis/snapshot", (_request, response) => {
          sendJson(response, configuredSnapshot());
        });

        server.middlewares.use("/api/artemis/projects", (_request, response) => {
          sendJson(response, listNodeProjects(scanRoot));
        });

        server.middlewares.use("/api/artemis/workspaces", (request, response) => {
          const url = readUrl(request);
          sendJson(response, listNodeWorkspaces(url.searchParams.get("projectId") ?? undefined));
        });

        server.middlewares.use("/api/artemis/sessions", (request, response) => {
          const url = readUrl(request);
          sendJson(response, listNodeSessions(url.searchParams.get("workspaceId") ?? undefined));
        });

        server.middlewares.use("/api/artemis/review", (request, response) => {
          const url = readUrl(request);
          sendJson(
            response,
            getNodeReviewSnapshot(url.searchParams.get("workspaceId") ?? "ws-artemis-shell")
          );
        });

        server.middlewares.use("/api/artemis/launch", async (request, response) => {
          if (request.method !== "POST") {
            response.statusCode = 405;
            response.end("Method not allowed");
            return;
          }

          try {
            const launchRequest = JSON.parse(
              await readBody(request)
            ) as AgentLaunchRequest;
            const harnesses = listConfiguredHarnesses({
              includeVersions: false,
              includeWorkspaceMentions: false
            });
            const result = await launchNodeAgent({
              harnesses,
              request: launchRequest
            });
            sendJson(response, result);
          } catch (error) {
            response.statusCode = 500;
            response.setHeader("content-type", "application/json; charset=utf-8");
            response.end(
              JSON.stringify({
                error: error instanceof Error ? error.message : String(error)
              })
            );
          }
        });
  }
};

export default defineConfig({
  plugins: [react(), ...(enableTsHost ? [tsHostPlugin] : [])],
  // Tauri surfaces Rust panics and build errors far better than the browser
  // overlay does; keep the dev server quiet and let the shell report.
  clearScreen: false,
  server: {
    port: 4637,
    strictPort: true
  }
});
