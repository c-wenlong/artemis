# Artemis Implementation Plan

> **Historical.** Written 2026-08-05, before any of the work in
> [MILESTONES.md](MILESTONES.md) was done. Kept because it records the reasoning
> behind the module split and the product areas, both of which survived. The
> "next" sections below are all complete or superseded; MILESTONES.md is the
> current roadmap.

## Direction

Artemis starts as a fresh local-first orchestrator, not a fork of Superset or Pane. It borrows the product lessons from both while keeping its own stable core interfaces.

## Initial Module Split

- `@artemis/core`: domain types and interfaces. This is the stable contract for asset catalogs, workspaces, sessions, and review data.
- `@artemis/host-service`: first local adapter. It owns seeded local data today, then grows into the separate process for git, worktrees, PTYs, filesystem watching, and agent launches.
- `@artemis/desktop`: React operational UI. It consumes the host-service through a small interface and stays independent from implementation details.

## First Vertical Slice

1. Render asset inventory for harnesses, skills, MCP servers, and providers.
2. Render workspaces with git/worktree state and lifecycle status.
3. Render sessions with agent, workspace, attention state, and terminal summary.
4. Render review surface with changed files and artifact placeholders.
5. Keep the UI stateful enough to prove navigation, filtering, and selection.

## Next Milestones

1. Replace seeded host-service data with filesystem scanners.
2. Add SQLite persistence for projects, workspaces, sessions, and launch presets.
3. Add a real terminal host interface with PTY create/input/resize/subscribe.
4. Add git worktree create/adopt/delete flows.
5. Add agent launch adapters for Codex, Claude, Gemini, Cursor, and custom commands.
6. Add an optional Quiver import adapter once the Artemis catalog contract is stable.
