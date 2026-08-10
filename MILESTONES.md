# Artemis Milestones

Sequential path from the current prototype to a 1.0 open-source release.
Each milestone states what it unlocks and how you know it's done. Nothing later
is startable until its dependencies land.

Companion docs: [docs/UI_DIRECTION.md](docs/UI_DIRECTION.md) (design references),
[docs/QUIVER_INTEGRATION.md](docs/QUIVER_INTEGRATION.md) (asset sourcing).

## Decisions of record

Settled 2026-08-10.

| Decision | Choice |
|---|---|
| End state | Open-source release — public repo, cross-platform builds, install story |
| Desktop shell | **Tauri** |
| v1 message rendering | opencode deep; every other harness runs in the terminal dock |
| Terminal | Right-side dock, in v1 |
| Visual direction | Light and calm — Cursor Web's register, not Superset's |
| Multi-harness comparison | Post-v1, after adapters exist |
| Quiver | Optional file-level enrichment; never a runtime dependency |

### The Tauri consequence

Tauri was chosen over my recommendation, which is fine — but it changes M0 from
a port into a rewrite, and that needs stating plainly rather than buried.

`@artemis/host-service`'s Node layer — `harnessScanner`, `agentLauncher`,
`opencodeChat`, `snapshot` — cannot run inside Tauri's Rust core. Two options:

- **Node sidecar.** Keep the TypeScript host, ship Node alongside. Preserves all
  existing work, but adds ~60MB to the bundle, which is most of the reason to
  pick Tauri over Electron in the first place.
- **Port to Rust.** ~8 files, scanners being the bulk. Perhaps a week. Keeps
  binaries small and puts PTY in `portable-pty`, where Tauri is genuinely strong.

**Recommendation: port to Rust.** A Node sidecar buys back Electron's costs while
keeping Tauri's disadvantages. The existing TypeScript host stays alive as the
dev-time reference implementation until the Rust side reaches parity, so no
milestone is blocked while porting.

`@artemis/core` is types-only and survives either way — it stays the contract,
mirrored in Rust.

---

# Phase 0 — Foundations

## M0. Tauri shell and Rust host core

Replace the Vite-middleware host with a real one.

- Tauri scaffold; `@artemis/desktop` becomes the webview UI unchanged
- Rust host: harness scanning, settings (`~/.artemis/settings.json`), process
  spawn, git overlay — ported from `packages/host-service/src/node/*`
- Tauri commands replacing the `/api/artemis/*` middleware
- `@artemis/core` types mirrored as Rust structs, with a serde contract test
- TS host retained, dev-only, as the parity reference

**Exit:** `pnpm tauri dev` opens a window; asset inventory renders from the Rust
host; no Vite middleware remains in the runtime path.
**Blocks:** everything.

---

# Phase 1 — The core loop

The differentiator, end to end, on one harness. This phase is the product.

## M1. Event streaming

`sendChatMessage` currently returns a whole turn. The renderer needs deltas.

- Stream `RuntimeEvent`s from Rust to the webview over Tauri's event channel
- opencode adapter emits `text.delta`, `reasoning.delta`,
  `tool_call.started/completed/errored`, `turn.*` as they arrive
- Turn cancellation; backpressure on fast streams
- Event-log persistence so a turn can be replayed on reopen

**Exit:** a prompt to opencode streams token-by-token; stopping mid-turn leaves
consistent state; reopening the session replays the turn.
**Depends:** M0.

## M2. Design system

Do this before writing renderers, not after — retrofitting tokens is the
expensive order.

- Light palette, elevation scale, typography, spacing; theme tokens throughout
  (dark ships later, but nothing hardcodes a color)
- Shell: left rail (projects → workspaces, status dots) + centered conversation
  + composer; narrow content column, generous whitespace
- Composer as status bar: repo · branch · diffstat above, model and effort below
- Collapse the five sections — Settings becomes a modal, inventory moves into
  the launcher, Review becomes a segment type

**Exit:** the shell renders with real data and reads as deliberate. No section
nav remains.
**Depends:** M0.

## M3. Segment renderer

- `SegmentCard` (bordered, top-level, three tones) and `SegmentRow` (borderless,
  nested) — Traycer's primitives, whole-header click target, no chevron when the
  header says everything
- Renderers for the four existing block kinds: `text` (markdown), `reasoning`,
  `tool_call`, `error`
- Streaming states: in-progress indicator, elapsed heartbeat, working verb
- User message as bordered full-width box; `Worked for 27s` turn footer

**Exit:** a full opencode turn renders as typed segments with no raw text
fallback anywhere.
**Depends:** M1, M2.

## M4. Activity grouping

- Consecutive tool/command segments collapse into one group with a past-tense
  summary (`Ran 3 commands, used 2 tools ›`)
- Reasoning promoted out of groups, rendered inline
- Elapsed heartbeat on the collapsed header while active

**Exit:** a 30-tool-call turn reads as roughly five lines of prose.
**Depends:** M3.

> **v0.1 — the vertical slice.** One agent, fully rendered, in a shell you'd
> choose to look at. Everything after this is breadth.

---

# Phase 2 — Workspaces and terminal

## M5. Projects and worktrees

- Real project scanning, replacing the seeded rows
- Git worktree create / adopt / delete with visible progress and failure recovery
- Workspace status: branch, diffstat, attention state — the rail's status dots
- Fix the current silent-fallback bug: a non-repo directory must read as "not a
  repo", not inherit a seeded `main`

**Exit:** create a worktree, run an agent in it, delete it — no seeded data left
in the workspace path.
**Depends:** M0.

## M6. Terminal dock

- PTY via `portable-pty`; xterm.js in a closable right dock, tabbed
- Non-opencode harnesses launch here
- Scrollback retention; PTYs survive UI reload

**Exit:** launch Claude Code into a workspace terminal, reload the window, find
the session alive.
**Depends:** M0, M5.

## M7. Persistence

- SQLite for projects, workspaces, sessions, launch presets, event log
- Migrations; crash recovery marks orphaned running sessions as stopped

**Exit:** quit mid-turn, reopen, and the app restores to a truthful state.
**Depends:** M1, M5.

> **v0.2 — a usable cockpit.** Real workspaces, a terminal for everything else,
> state that survives a restart.

---

# Phase 3 — Review and trust

## M8. File changes and review

- `file_change` / `file_change_group` block kinds and their renderers
- Inline diffs in the transcript; revert affordance
- Diffstat in the composer bar; changed-file list per workspace

**Exit:** an agent edit appears as a diff in the conversation and can be reverted
from there.
**Depends:** M3, M5.

## M9. Citations

Cursor's pattern, and what makes a hidden-mechanics transcript trustworthy.

- `file:line` chips in rendered markdown, resolving to the workspace
- Click opens the file at the range; `terminal:N-M` resolves to dock output
- Linkifier fallback for harnesses that don't emit ranges

**Exit:** claims in an answer carry clickable references that land in the right
file at the right line.
**Depends:** M3, M8.

> **v0.3 — auditable.** You can trust what the agent says without reading a log.

---

# Phase 4 — Breadth

## M10. Quiver integration

Per [docs/QUIVER_INTEGRATION.md](docs/QUIVER_INTEGRATION.md) — optional, file-level,
read-only.

- `AssetSource` interface; `NativeAssetSource` + `QuiverFileSource`
- Session history import — 731 sessions, 20+ harnesses, resume ids included
- Registry enrichment with provenance on merged fields
- `QuiverCliSource` (opt-in, off by default) for MCP cross-tool reconciliation
- Schema fixtures pinned in tests

**Exit:** Artemis works identically with Quiver absent; with it present, session
history and MCP reconciliation appear. Corrupting `tools.json` degrades to native
with a warning, never a crash.
**Depends:** M7.

## M11. Harness adapters

- `RuntimeEvent` adapters for Claude Code and Codex
- Adapter conformance test suite — one fixture set, every adapter
- Graceful degradation to the terminal dock when an adapter is absent

**Exit:** three harnesses render as segments; the fourth still works, in the dock.
**Depends:** M3, M6.

## M12. Multi-harness comparison

The wedge. No competitor does this across vendors.

- One prompt fans out to N harnesses in isolated worktrees
- Tabbed results, Cursor's model-tabs pattern; per-tab status and diffstat
- Pick a winner: keep one branch, discard the rest

**Exit:** one prompt, three harnesses, three diffs, one kept.
**Depends:** M11, M5.

> **v0.4 — the reason Artemis exists** rather than Superset or Pane.

---

# Phase 5 — Release

## M13. Cross-platform and packaging

- Linux and Windows builds; path assumptions audited out of the scanners
- Signed macOS builds, notarization; auto-update
- CI matrix on all three platforms

**Exit:** a stranger installs from a release artifact on all three OSes.
**Depends:** v0.4.

## M14. Open-source readiness

- README with real screenshots, CONTRIBUTING, architecture docs, LICENSE
- Issue and PR templates; public roadmap
- Test coverage on core contracts; CI green and required
- Repo flipped public

**Exit:** someone who has never seen the codebase can build, run, and land a PR.
**Depends:** M13.

> **v1.0.**

---

## Sequencing notes

- **M2 before M3** is deliberate. Writing renderers against hardcoded colors and
  then retrofitting tokens costs several times what doing it in order costs.
- **M5 and M6 can run parallel to Phase 1** if there's capacity — they depend
  only on M0. Nothing else forks.
- **M10 is placed after M7** because session import needs somewhere to land. It
  could move earlier if the resume-any-session feature turns out to matter more
  than persistence.
- **The riskiest milestone is M0.** A Rust port of the host is the only place
  where the estimate could be wrong by a factor rather than a margin. If it runs
  long, the Node-sidecar fallback exists and is reversible.
