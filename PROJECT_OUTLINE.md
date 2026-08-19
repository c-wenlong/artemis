# Artemis Project Outline

> **Historical.** Written 2026-08-05, before any of the work in
> [MILESTONES.md](MILESTONES.md) was done. Kept because it records the reasoning
> behind the module split and the product areas, both of which survived. The
> "next" sections below are all complete or superseded; MILESTONES.md is the
> current roadmap.

## Vision

Artemis is a desktop GUI for orchestrating AI coding agents and managing the local assets they depend on. It should combine Quiver's harness/tool/provider/skill management with a richer workspace interface for launching agents, monitoring sessions, reviewing outputs, and keeping local developer state understandable.

## Reference Inputs

- Quiver: local CLI control plane for harnesses, tools, skills, MCP configs, sessions, model usage, and LLM provider metadata.
- Superset: Electron/Bun orchestration app for launching CLI agents into isolated worktrees, monitoring terminals, managing workspace lifecycle, and reviewing changes.
- Teresa/Theresa: intended reference source, not present in this workspace yet.

## Core Product Areas

- Asset inventory: show installed harnesses, configured tools, skills, MCP servers, provider keys, projects, workspaces, and agent sessions in one place.
- Harness launcher: launch Claude, Codex, Gemini, Cursor, opencode, and custom harnesses with presets, environment setup, and saved prompt templates.
- Workspace orchestration: create, adopt, open, and delete agent workspaces with clear git/worktree state and lifecycle progress.
- Session cockpit: monitor running agents, terminals, logs, attention states, task status, and resumable sessions.
- Review surface: inspect diffs, changed files, generated artifacts, and hand off to external editors or terminals.
- Configuration sync: use Quiver-style primitives to inspect and reconcile MCP, skills, providers, and harness metadata across tools.

## Initial Architecture Direction

- Desktop shell: Electron or Tauri with a React-based operational UI.
- Local host service: separate process that owns workspace lifecycle, PTY management, filesystem watching, git operations, and agent launches.
- Shared core: reuse or port Quiver's registry/discovery logic for harnesses, skills, MCP configs, providers, sessions, and models.
- Local persistence: SQLite-backed state for projects, workspaces, sessions, presets, launch history, and asset inventory snapshots.
- Extension boundary: define adapters for harnesses, providers, MCP formats, and asset catalogs so new tools do not require core UI rewrites.

## First Milestones

1. Product and architecture brief: decide desktop stack, host-service boundary, persistence model, and how Artemis consumes Quiver.
2. Asset inventory prototype: read local harnesses, skills, MCP servers, providers, and recent sessions into a single UI.
3. Launch cockpit prototype: create a project/workspace, start one CLI harness in a terminal, persist its session metadata, and reopen it.
4. Workspace lifecycle: add create/adopt/delete flows for git worktrees with visible progress and failure recovery.
5. Review loop: show file tree, diffs, terminal output, and open-in-editor handoff for an agent workspace.

## Open Questions

- Should Artemis embed Quiver as a Python package/CLI dependency, port core logic to TypeScript, or expose Quiver through a local service API?
- Is the first target macOS-only, or should Linux support constrain architecture from the start?
- Does Artemis need cloud sync early, or should v1 stay fully local-first?
- What asset types beyond harnesses, skills, providers, MCP servers, sessions, and workspaces must be first-class?
- Which Superset concepts should be adopted directly, and which should be simplified for a more personal local control plane?
