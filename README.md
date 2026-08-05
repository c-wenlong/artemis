# Artemis

A local-first desktop control plane for AI coding agents.

Artemis puts the assets agents depend on — harnesses, skills, MCP servers,
providers, projects, workspaces, and sessions — behind one operational UI, then
lets you launch agents against them and review what they changed.

> **Status: early prototype.** The harness scanner, agent launcher, opencode
> chat runtime, and settings store run against your real machine. Projects,
> workspaces, sessions, and review data are still partly seeded. See
> [What's real today](#whats-real-today).

## Why

Running more than one AI coding CLI means every tool has its own launch flags,
its own session format, its own MCP config, and its own idea of where skills
live. [Quiver](https://github.com/c-wenlong/quiver) solves the CLI half of that
problem. Artemis is the GUI half: a cockpit for launching agents into workspaces,
watching them run, and reviewing the diff.

Artemis is a fresh design, not a fork. It borrows product lessons from Superset
(host-service boundary, workspace lifecycle) and Pane (terminal-first ergonomics,
panel model) while keeping its own stable core contracts.

## Quick start

Requires Node 22+ and pnpm 10.

```bash
pnpm install
```

```bash
pnpm dev
```

The app serves on `http://127.0.0.1:4637`.

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `ARTEMIS_SCAN_ROOT` | the workspace two levels above the repo | Root directory scanned for projects and agent config files |
| `ARTEMIS_SETTINGS_PATH` | `~/.artemis/settings.json` | Where runtime settings are persisted |

## Architecture

Three packages, with a deliberate boundary between contract, implementation, and UI:

```
@artemis/core           domain contracts — no runtime, types only
   ▲
@artemis/host-service   local adapter — scanners, launcher, chat, seed data
   ▲
@artemis/desktop        React operational UI
```

**`@artemis/core`** defines the interfaces every other package codes against:
`AssetCatalog`, `WorkspaceRuntime`, `AgentRuntime`, `ChatRuntime`,
`RuntimeSettingsRuntime`, and `ReviewRuntime`. It ships types only, so the UI
never depends on how the host is implemented.

**`@artemis/host-service`** implements those interfaces twice. `createLocalHostService`
is an in-process mock used for UI work without a machine scan.
`src/node/*` holds the real implementations — harness scanner, agent launcher,
opencode chat runtime, git-aware snapshot — and `createHttpHostClient` is the
browser-side client that talks to them over HTTP.

**`@artemis/desktop`** is a React 19 + Vite app with five sections: Workbench,
Projects, Chat, Review, and Settings.

### Transport

The Node-side host currently runs as **Vite dev-server middleware**, defined in
`apps/desktop/vite.config.ts`, exposing:

```
GET  /api/artemis/snapshot            asset inventory
GET  /api/artemis/projects            projects under the scan root
GET  /api/artemis/workspaces          workspaces (?projectId=)
GET  /api/artemis/sessions            sessions (?workspaceId=)
GET  /api/artemis/review              review snapshot (?workspaceId=)
GET  /api/artemis/settings            runtime settings
POST /api/artemis/settings            persist runtime settings
POST /api/artemis/launch              launch an agent
POST /api/artemis/chat/sessions       create a chat session
POST /api/artemis/chat/sessions/:id/messages   send a turn
```

This means the API only exists under `pnpm dev`. A production `vite build` +
`preview` serves the UI with no host behind it. Extracting the host into its own
process is the next structural milestone.

## What's real today

| Area | State |
|---|---|
| Harness discovery | **Real.** Scans `PATH` plus `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.npm-global/bin`, `~/go/bin`; resolves versions and finds workspace config mentions (`AGENTS.md`, `CLAUDE.md`, `.mcp.json`, `opencode.json`, …). Knows 12 harnesses: pi, claude, codex, gemini, cursor, opencode, copilot, amp, droid, aider, swe, runpane. |
| Agent launch | **Real.** Spawns the resolved executable in the workspace directory with a 12s timeout; refuses harnesses that aren't `ready`. |
| Chat | **Real, opencode only.** Shells out to `opencode run` with JSON output, parses blocks and tool calls, threads `--session` for continuity. |
| Settings | **Real.** Persisted to `~/.artemis/settings.json`; currently opencode executable path and default model, which override the scanner's result. |
| Workspaces | **Partly real.** Rows are seeded, but `branch` and `changedFileCount` are read from live `git`. |
| Projects | **Seeded**, with `rootPath` pointed at the real scan root. |
| Sessions, review | **Seeded.** |
| Skills, MCP servers, providers | **Seeded** in the inventory snapshot. |

## Roadmap

1. Replace remaining seeded catalogs with filesystem scanners.
2. Extract the host out of Vite middleware into a standalone local service.
3. SQLite persistence for projects, workspaces, sessions, and launch presets.
4. A real terminal host: PTY create / input / resize / subscribe.
5. Git worktree create / adopt / delete flows with visible progress.
6. Launch adapters for Codex, Claude, Gemini, Cursor, and custom commands.
7. An optional Quiver import adapter, once the catalog contract is stable.

See [PROJECT_OUTLINE.md](PROJECT_OUTLINE.md) for product scope and open
questions, and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the module
split and vertical slice.

## Scripts

```bash
pnpm dev         # desktop app + local host API on :4637
pnpm build       # typecheck and build every package
pnpm typecheck   # typecheck only
pnpm clean       # remove build output
```
