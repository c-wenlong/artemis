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

## M0. Tauri shell and Rust host core ✅

Replace the Vite-middleware host with a real one.

- [x] Tauri scaffold; `@artemis/desktop` becomes the webview UI unchanged
- [x] Rust host: harness scanning, settings (`~/.artemis/settings.json`),
      process spawn, git overlay — ported from `packages/host-service/src/node/*`
- [x] Tauri commands replacing the `/api/artemis/*` middleware
- [x] `@artemis/core` types mirrored as Rust structs, with a serde contract test
- [x] TS host retained, dev-only, as the parity reference

**Exit:** met. `pnpm dev` opens the window; the inventory renders from Rust
(12 harnesses, 10 ready, 404 skills, 9 git projects); the TypeScript middleware
is gated behind `ARTEMIS_TS_HOST=1` and never mounts under Tauri.

Decisions taken during the port, each a departure from a faithful translation:

- **Seed data deleted rather than ported.** The TypeScript host returned invented
  MCP servers and providers that were indistinguishable from findings. Skills and
  providers are now discovered for real; MCP returns empty until M10.
- **A non-repository says so.** The old git overlay swallowed failures and fell
  back to a seeded `main`, so any directory displayed `main / 0 changed`.
- **`scanRoot` is an explicit setting.** It was previously derived from the app's
  own location, which made the walk unbounded. Now env → setting → `$HOME`, with
  depth, entry-count, and wall-clock caps on the walk.
- **Cold inventory scan: 7.6s → 1.67s.** The walk was not the bottleneck; ten
  sequential `--version` probes at up to 1.8s each were. They now run
  concurrently, so the cost is the slowest single probe.
- **Chat is deliberately unimplemented in Rust.** M1 replaces the whole
  request/response shape with a streamed event channel; porting the one-shot
  implementation first would be wasted work. It rejects with a clear message.

**Blocks:** everything.

---

# Phase 1 — The core loop

The differentiator, end to end, on one harness. This phase is the product.

## M1. Event streaming ✅

`sendChatMessage` returned a whole turn. The renderer needs deltas.

- [x] Stream `RuntimeEvent`s from Rust to the webview over a Tauri channel
- [x] opencode adapter emits `text.delta`, `reasoning.delta`,
      `tool_call.started/completed/errored`, `turn.*` as they arrive
- [x] Turn cancellation; backpressure on fast streams
- [x] Event-log persistence so a turn can be replayed on reopen

**Exit:** met, and verified against the real binary rather than fixtures —
`tests/opencode_live.rs` (ignored by default) ran a live turn: 3 batches,
4 events, opencode session id captured, log replay matching the stream exactly.

The contract changed shape: `ChatRuntime` is now
`createChatSession` / `streamChatMessage` / `cancelChatTurn` /
`replayChatSession`. The 754-line TypeScript `opencodeChat.ts` was deleted
rather than maintained alongside the Rust one — the reference host reports chat
as unavailable in browser mode instead of shipping a second, divergent parser.

Design notes worth keeping:

- **Deltas are computed, not received.** OpenCode resends each part's whole text
  as it grows, so the parser diffs against the previous value per block. Getting
  this wrong renders every token repeated.
- **The parser is shape-tolerant on purpose.** It walks every object in the JSON
  tree and keeps the ones that look like a content part, rather than modelling
  each envelope. A stricter parser breaks on the next opencode release; this one
  degrades to emitting less.
- **Coalescing is the backpressure.** Consecutive deltas for one block merge
  before crossing the IPC boundary, so a fast model costs one message per 40ms
  flush rather than one per token.
- **The fold is the same code live and replayed.** `reduceEvents` is pure and
  incremental, which is what makes reopening a session show exactly what
  streamed.

Two bugs found while building, both by tests that did more than restate the
implementation:

- **Cancelling did not stop the work.** Killing the child left its grandchildren
  holding the stdout pipe, so a cancelled turn hung until the real process
  exited — 30s in the test. The harness now runs in its own process group and
  cancel signals the group. The suite went from 30s to 0.31s.
- **Replay could never have worked.** The UI replayed under the workspace id
  while the host keyed its event log by the chat session id. The fake host was
  ignoring the argument, so every test passed. Session ids are now deterministic
  per workspace, the fake honours the id it is given, and a regression test
  asserts the key.

**Depends:** M0.

## M2. Design system ✅

Do this before writing renderers, not after — retrofitting tokens is the
expensive order.

- [x] Light palette, elevation scale, typography, spacing; theme tokens
      throughout (dark ships complete, but nothing hardcodes a colour)
- [x] Shell: left rail (projects → workspaces, status dots) + centred
      conversation + composer; narrow content column, generous whitespace
- [x] Composer as status bar: repo · branch · diffstat above, harness and model
      below
- [x] Collapse the five sections — Settings is a modal, inventory moved inside
      it, Review reduced to the composer diffstat until M8 makes it a segment

**Exit:** met. Rail, conversation and composer render against the Rust host; the
five-section nav is gone; 42 front-end tests plus 11 Rust contract tests pass.

Built test-first. `src/test/tokens.test.ts` is the load-bearing one: it fails the
build on any colour literal outside `tokens.css`, which is what stops M3's
renderers from hardcoding their own palette. `src/test/shell.test.tsx` encodes
the M2 requirements as assertions; `src/test/components.test.tsx` locks in
behaviour the implementation settled.

Three defects found by looking at the running app rather than the tests:

- **Light was not actually shipping.** An unscoped
  `@media (prefers-color-scheme: dark)` overrode the chosen direction on a
  dark-mode machine. The document now pins `data-theme="light"`, the media query
  is scoped to `:root:not([data-theme])`, and two tests hold that in place.
- **Conversation and composer were misaligned by 2rem** — each owned its own
  gutter and `box-sizing: border-box` took the padding out of one but not the
  other. The shell owns the gutter now; both columns constrain inside it.
- **Settings sections scrolled independently**, clipping the Scan root field.
  One scroll container for the form.

Deferred deliberately: the dark theme is complete in tokens but has no toggle —
that is UI work with no home until there is a settings surface worth extending.

**Depends:** M0.

## M3. Segment renderer ✅

- [x] `SegmentCard` (bordered, top-level, three tones) and `SegmentRow`
      (borderless, nested) — Traycer's primitives, whole-header click target, no
      chevron when the header says everything
- [x] Renderers for the four existing block kinds: `text` (markdown),
      `reasoning`, `tool_call`, `error`
- [x] Streaming states: in-progress indicator, elapsed heartbeat, working verb
- [x] User message as bordered full-width box; `Worked for 27s` turn footer

**Exit:** met. `BlockSegment` dispatches over the union with no default text
fallback, and a test asserts every kind resolves to its own renderer.

Notes:

- **Markdown is `react-markdown` with raw HTML left off.** Model output is
  untrusted input arriving straight from a harness; embedded markup renders as
  text. A test asserts an `<img onerror>` never becomes an element.
- **Reasoning collapses by default.** It is context for the answer, not the
  answer — a transcript that leads with the model's deliberation buries what was
  asked for.
- **Tool headers summarise rather than dump.** JSON input is reduced to its most
  identifying string value (the path, the command) and truncated; the full input
  and output stay one click away.
- **The working verb is seeded per turn and never changes mid-turn.** Text that
  churns while you read it is worse than text that says nothing.

Two bugs found during implementation:

- **A replayed unfinished turn animated a live heartbeat.** A log whose terminal
  event was never written replays as `status: "running"`, so the transcript
  ticked a timer for work that had stopped. The live footer now requires the
  session to actually be streaming *and* the turn to be the last one.
- **Elapsed was computed against the host's timestamp**, which read as tens of
  minutes on a freshly opened window. It now counts from when the footer
  mounted — a live turn only ever gets a footer at the moment it starts, so the
  two agree where it matters and clock differences cannot leak in.

Not visually verified end-to-end: browser mode cannot render a transcript
because M1 made chat Tauri-only, and driving the desktop window was out of
scope for this pass. Structure is covered by tests; how it *looks* with a real
opencode turn is worth a look on the next run.

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
