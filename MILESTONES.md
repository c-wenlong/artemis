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

## M4. Activity grouping ✅

- [x] Consecutive tool calls collapse into one group with a past-tense summary
      (`Ran 4 tools · bash · read`)
- [x] Reasoning promoted out of groups, rendered inline
- [x] Elapsed heartbeat on the collapsed header while active

**Exit:** met, and confirmed against a recorded live turn rather than fixtures.
A real ten-call turn now reads:

```
[prompt]
› Thought for a moment
› Ran 4 tools   tool · bash
› Thought for a moment
› Ran 6 tools   bash · read
› Thought for a moment
Files under apps/desktop/src-tauri/src/ (line counts): …
Worked for 41s
```

Rules, mostly Traycer's:

- **A run of one is not a group** — same information, one more layer to open.
- **Reasoning splits a run.** It renders inline, so folding across it would put
  the group's second half above reasoning that preceded it.
- **The group is the card, its calls are rows.** That is what the two primitives
  are for; nesting cards would make thirty calls look like thirty events of
  equal weight.
- **A group never hides a failure.** It says `2 failed`, takes the destructive
  tone, and opens itself.

Verification changed shape this milestone. Rather than skip the visual check
again, `tests/record_demo_log.rs` records a real opencode turn into a session
log, and the reference host gained a replay endpoint that reads it. Browser mode
still cannot stream, but it can now render a turn that actually happened — which
is how the next two bugs were found.

Bugs found:

- **`defaultOpen` only fires at mount**, so a call that failed *after* the group
  appeared — the normal case mid-run — stayed folded shut around the error.
  `SegmentCard` takes controlled open state now, and the group opens on the
  transition into failure while still letting the reader close it.
- **Dangling tool calls never resolved.** Real opencode emits `tool_call.started`
  without a matching completion often enough to be the normal case; three of ten
  calls in the recorded turn had none. The transcript showed `Running 4 tools`
  with a heartbeat climbing past the turn's own recorded duration. Calls still
  running when a turn ends now resolve to whatever happened to the turn.

**Depends:** M3.

> **v0.1 — the vertical slice.** One agent, fully rendered, in a shell you'd
> choose to look at. Everything after this is breadth.

---

# Phase 2 — Workspaces and terminal

## M5. Projects and worktrees ✅

- [x] Real project scanning, replacing the seeded rows *(landed early, in M0)*
- [x] Git worktree create / adopt / delete with visible progress and failure
      recovery
- [x] Workspace status: branch, diffstat, attention state — the rail's status
      dots *(landed in M2)*
- [x] Fix the silent-fallback bug: a non-repo directory reads as "not a git
      repository" *(landed early, in M0)*

**Exit:** met. `tests/workspace_lifecycle.rs` drives the whole round trip
against a real repository — create, appear in the list under the id create
returned, refuse a dirty delete, force it, and fail cleanly on a duplicate
branch.

Design decisions worth keeping:

- **Git's list is the source of truth, not a registry.** A registry drifts:
  worktrees made with `git worktree add` on the command line would be invisible
  and ones deleted by hand would linger. Reading `git worktree list --porcelain`
  means adoption needs no code at all.
- **Worktrees live outside the repository** (`~/.artemis/worktrees/<project>/`).
  Inside, they show up in the repo's own `git status`, in editor file trees, and
  in every glob the agent runs.
- **Deleting refuses uncommitted work by default.** This is the one operation
  Artemis has that can destroy something with no copy anywhere else. The host
  refuses, the UI relays the refusal, and discarding is a *separate* button —
  never an automatic retry with `--force`, which would turn a safety check into
  a speed bump.
- **A failed create prunes.** A half-finished `worktree add` otherwise leaves
  metadata pointing at a directory that does not exist, and every later call has
  to work around it.
- **"Is this the project's own checkout" is decided by path**, not by an id
  convention. An id convention is invisible coupling — the host could change how
  it builds ids and the UI would quietly start offering to delete repositories.

One thing tightened along the way: rail rows announced as
"artemis: ready artemis 4" — the status dot's label, the name, and the change
count concatenated. The row now carries just the name; the dot keeps its own.

**Depends:** M0.

## M6. Terminal dock ✅

- [x] PTY via `portable-pty`; xterm.js in a closable right dock, tabbed
- [x] Non-opencode harnesses launch here
- [x] Scrollback retention; PTYs survive UI reload

**Exit:** met at the host level, which is where it is decided. The PTY belongs
to the host process, so a webview reload drops the *subscriber*, not the
terminal — `output_survives_a_subscriber_going_away` detaches mid-run, keeps
writing, reattaches, and finds both the earlier output in the replayed
scrollback and the process still alive. On the UI side, the dock adopts whatever
`listTerminals` reports rather than starting fresh.

Design:

- **The PTY lives in the host, the window is only a subscriber.** Everything
  else follows from that: reload survival, output accumulating while nobody
  listens, and a reader thread per terminal that runs regardless of subscribers.
- **The backlog is returned from `subscribe`, not pushed through the sink.**
  xterm writes it in one call; replaying a hundred kilobytes chunk by chunk
  makes a reconnect visibly crawl.
- **Scrollback is bounded to 256KB, keeping the tail** — a terminal shows the
  end, and a runaway process should not be able to exhaust memory.
- **Only the visible tab is mounted.** A dozen xterm instances rendering
  off-screen costs real frame time; the PTY keeps running either way.
- **Hiding is not closing.** The composer toggle collapses the dock and leaves
  every process running.

Tested against `/bin/sh` rather than a mock, because a PTY is not a pipe — it
echoes, it has a window size, it delivers signals. `stty size` confirms a resize
actually reaches the program, which a mock could never show.

One design gap the tests surfaced: the composer button was a toggle, so there
was no way to open a *second* terminal. Splitting it — toggle on the composer,
"+" inside the dock — is what Superset and Pane both do, for the same reason.

Not manually driven: opening a terminal in the running desktop app and reloading
the window. The app was confirmed to build and run stably; the survival
behaviour is covered by the host tests, and the reconnect path by the UI tests.

**Depends:** M0, M5.

> **v0.2 — a usable cockpit.** Real workspaces, a terminal for everything
> else, and turns that survive a reload. Persistence (M7) is what is still
> missing.

## M7. Persistence ✅

- [x] SQLite for sessions and launch presets, with migrations
- [x] Crash recovery marks orphaned running sessions as stopped
- [ ] Projects, workspaces, event log — **deliberately not stored**, see below

**Exit:** met. A session left `running` by a hard quit is corrected to `stopped`
on the next launch, and `opencode_session_id` survives the restart so the
conversation resumes with its context instead of starting over.

### What is stored, and what is not

Three of the five things this milestone originally listed are deliberately
absent, which is a narrowing of scope and worth stating plainly rather than
quietly dropping:

- **Projects and workspaces are derived** — from the filesystem scan and from
  `git worktree list`. Storing them would create a second answer that drifts
  from the first, and the first is always right. A worktree deleted on the
  command line would linger in a table; a repository cloned outside Artemis
  would be missing from one.
- **The event log stays as JSONL.** It is append-only, a crash truncates the
  last line rather than corrupting a file, and nothing has needed to query it.
  Moving it into SQLite is churn with a real regression surface and no benefit
  yet. If M8 or M9 needs indexed queries over events, that is when to move it.

What is left is what genuinely cannot be recomputed: `opencode_session_id`,
without which a restart forgets the conversation, and launch presets, so a
workspace reopens with the harness and model it was last used with.

Two bugs, both in the same place and both about the difference between *loading*
a preset and *choosing* one:

- **Saving was gated on the load having finished**, so a model typed in the
  first moments after opening a workspace was silently discarded. The gate is
  structural now: the loader only calls internal setters, the exported setters
  only run from user input, so no timing is involved.
- **The load re-ran when settings arrived a tick later**, resetting the
  "user has chosen" flag and overwriting what had just been typed. The effect
  now reloads when the workspace changes and only then.

Both surfaced as *flaky* tests rather than failing ones, which is the more
dangerous shape — the first two fixes made the flake move rather than go away.

**Depends:** M1, M5.

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
