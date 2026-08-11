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

**It was broken on Windows the whole time.** The webview picked the shell, and
picked `/bin/zsh` — a path that does not exist there, so the dock could not open
a plain shell at all. Found once CI could finally run all three platforms. The
choice now belongs to the host, which is the half that knows the operating
system: an empty command means "a shell", resolved to `$SHELL` or `%ComSpec%`.

**Resize is still unverified on Windows.** The test asks the shell for its size
with `stty`, and `cmd.exe` has no equivalent that prints it, so that one case is
`#[cfg(unix)]`. The resize call itself goes through `portable-pty` on both, but
nothing proves a program on the far side sees the new dimensions. Marked rather
than deleted, so the gap is visible instead of implied by an absence.

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

## M8. Conversation surface

Codex's transcript chrome, which the user walked through screenshot by
screenshot. The palette stays ours — light and calm, per the decision of record.
What is being borrowed is the structure, not the theme.

- File chips: a type icon plus the name, tinted, in both user prompts and
  assistant prose. Document, `$` for shell, extensible from the start
- Citations as `name.ext (line N)` chips — rendering only; resolving a click to
  the file is M9
- Inline code spans as pills, distinct from fenced blocks
- User prompt metadata: sent timestamp, copy button
- Long messages truncate to a line budget with **Show more**
- `Worked for 2m 24s` promoted from footer to a collapsible turn header
- Assistant footer: copy, fork, finished-at timestamp. No thumbs up/down — the
  user was explicit that satisfaction tracing is not wanted
- Edit summary card: `Edited N files`, `+87 -0`, one row per file with its own
  counts. Read-only here; the buttons on it are M8b

**Exit:** a transcript reads like Codex's — a prompt with its metadata, a turn
header, prose carrying file chips and code pills, and a summary of what was
edited — without any of it being clickable yet.
**Depends:** M3, M4.

**The parser gap is closed.** Confirmed against a live `opencode run` that
edited two files, and the guess was right: `state` is an object carrying
`status`, `input`, `output` and `metadata.files`, not a status string. Four
things came out of the recording that no amount of reading the docs would have:

- The real tool name is on `tool`; everything was arriving as `"tool"`.
- Flattening the frame collected `state` as a *second* part, so every call was
  duplicated and the duplicate was the unnamed one. The envelope names the real
  part; use it.
- `opencode run --format json` reports each tool **once, already finished**.
  There is no start frame, so the completion has to carry `input` as well.
- `metadata.files` already has per-file `additions`/`deletions`. The summary
  reports those rather than parsing `patchText`, which `apply_patch` sends as a
  single opaque blob.

`relativePath` is not reliably relative — on macOS `/var` symlinks to
`/private/var` and opencode returns a stripped absolute path — so paths are
re-derived against the workspace root. The recording is pinned as a fixture at
`tests/fixtures/opencode-apply-patch.jsonl`, and `tests/opencode_live.rs` has an
ignored test that repeats the whole thing against the real binary.

**Fork ships with a real limitation.** The transcript is copied; the opencode
session id is not, because reusing it would make the fork an alias rather than a
branch — both sides appending to one server-side conversation. So a fork reads
back correctly and its next turn starts a model with no memory of it. Closing
that needs opencode to support seeding a session from a transcript.

## M8b. File diffs, undo and review ✅

The rest of the old M8. Split out because M8 renders the *summary* of an edit
and this renders and reverses the edit itself.

- Per-file patches carried through from `metadata.files[].patch`
- Inline diffs in the transcript, opened from a file's row
- **Undo** — reverse-applies that one file's patch
- **Review** — the whole change set in one dialog, read-only
- Diffstat in the composer bar (already shipped in M2)

**Exit:** met, and verified against a real model's patch rather than a fixture —
`opencode_live.rs::undo_reverses_a_real_edit` runs a live turn, takes the patch
opencode emitted, reverses it, and asserts the file is byte-for-byte back.

**Undo is a reverse patch, not `git checkout -- file`.** The workspace usually
holds the user's own uncommitted work, and restoring from the index would
discard it. Reversing touches only the lines the agent wrote, so an unrelated
edit elsewhere in the same file survives.

**It refuses rather than forces.** `git apply --check` runs first, so a patch
that no longer fits leaves the file untouched and the reason is shown. An edit
*inside* the hunk's context is a genuine conflict and is refused; that is the
right way round, because silently reverting across changed context is how an
undo eats work it did not write.

**The paths inside a patch are not trusted.** They come from a model's tool
call, opencode writes them absolute, and `git apply` will follow `../..` out of
the workspace. The headers are rebuilt from the vetted relative path, and a
test drives `../`, `/etc/passwd` and a patch whose header names a different
file than the caller did.

Reverting a *created* file deletes it. opencode writes a creation as an ordinary
patch against an empty original, so reversing it would otherwise leave an empty
file behind.

**Not done here:** approving or landing a change. Review shows; it does not
merge. A dialog that looked like it could approve but only closed would be worse
than one that plainly shows.
**Depends:** M5, M8.

## M8c. Transcript verbosity ✅

Codex shows the output and hides the mechanics. Which is right depends on
whether you are debugging the agent or reading its answer, so it is a setting
rather than a default.

- Settings → Developer: **Everything** / **Output only**
- Applies to tool-call segments and activity groups
- Also a context-cost lever, and the panel says so — a long tool run is the bulk
  of what a transcript holds

**Exit:** met. The same session reads as a full trace or a clean answer, and the
change reflows the transcript already on screen rather than applying to the next
session.

**Defaults to Everything**, and an absent setting means Everything. A settings
file written before this shipped must not silently start hiding output — which
also settles the question M8 left open: the turn header ships expanded, and
"collapsed" is now something you choose rather than something done to you.

**A running turn is never folded.** The streaming footer is otherwise the only
sign of life during a long tool sequence, and the header that would reopen it
does not exist until the turn ends. It folds when the turn finishes, which is
when the trace stops being news.

**The field absorbs a bad value rather than failing.** `settings::read` falls
back to defaults on any parse error, so a strict union here would let one
hand-edited typo discard the model, the executable path and the icon too.
Losing one field is the proportionate failure.
**Depends:** M4, M8.

## M9. Citations ✅

Cursor's pattern, and what makes a hidden-mechanics transcript trustworthy.
M8 draws the chips; this makes them mean something.

- `file:line` and `file (line N)` chips resolve against the workspace
- Clicking opens a window on the file with the cited line marked
- Linkifier fallback for harnesses that don't emit ranges (shipped in M8)

**Exit:** met. A claim in an answer opens the lines it is about.

**A window, not the whole file, and not an external editor.** The question a
citation raises is "does it actually say that there", and a few lines either
side answers it. Opening in the user's editor would need an editor setting and
a guess at the command; that can come later without changing the chip.

**A chip is a control only when there is something to open.** No workspace
selected, or a host with no disk, and it renders as text. Never a disabled
button — that advertises an interaction and then refuses it.

**A stale citation opens anyway.** A line the agent named that a later edit
removed shows the end of the file with nothing highlighted, and says so.
Highlighting whatever now sits at that number would be a fabricated claim.

The path is vetted through the same `paths::vetted` the undo uses — it was
duplicated across the two, and is now one implementation. Binary files are
refused, enormous files are streamed so only the window is read, and a single
enormous line is truncated.

**Not done: `terminal:N-M`.** It was in the original scope, but nothing emits
it — not opencode, not the recorded sessions. Building a resolver for a
reference no harness produces is inventing a feature. It belongs with M11's
adapters, if an adapter turns out to emit one.
**Depends:** M8.

> **v0.3 — auditable.** You can trust what the agent says without reading a log.

---

# Phase 4 — Breadth

## M10. Quiver integration ✅

Per [docs/QUIVER_INTEGRATION.md](docs/QUIVER_INTEGRATION.md) — optional,
file-level, read-only. Shapes pinned in [docs/QUIVER_SCHEMA.md](docs/QUIVER_SCHEMA.md).

- `src/quiver.rs` owns every schema assumption; native scan stays ground truth
- Session history import — **verified at 731 sessions across 19 harnesses**,
  every row carrying its resume id
- Registry enrichment with provenance — `QuiverCatalog` only when Quiver really
  contributed
- Quiver CLI (opt-in, off by default) for MCP cross-tool reconciliation
- Fixtures cut from the live files, plus ignored tests that run against the
  real install

**Exit:** met, and checked against the real thing rather than fixtures.
`real_quiver_still_has_the_shape_we_parse` reads `~/.config/swe/` and reports
29 tools and 731 resumable sessions; `degrades_to_native_when_quiver_is_broken`
corrupts every file and asserts all 12 scanned harnesses come back byte-identical,
with provenance unchanged.

**No `AssetSource` trait.** The assessment proposed one interface with three
implementations. There is exactly one Quiver and one native scanner, and the
choice between them is a boolean, not polymorphism — so what shipped is the
*substance* of that design (one module owning every schema assumption, native
establishing ground truth, Quiver layering on top with provenance) without the
dyn-dispatch ceremony. Deliberate deviation, not an oversight.

**Enrichment is additive only.** Quiver never sets health, never sets an
executable path, and never overrides a version the scan probed — its registry
is hand-curated and can name a binary that has since been uninstalled.

**Not yet consumed:** `providers.json`, `rate_limits_cache.json`,
`skill_links.json`. All three parse and all three are documented; Artemis's own
scans already cover what the inventory needs, and importing them now would be
duplicate data with no consumer.
**Depends:** M7.

## M11. Harness adapters ✅

- `HarnessAdapter` trait; opencode, Codex and Claude Code implementations
- Conformance suite — the same assertions over every adapter's own capture
- Per-harness argv, including how each one is resumed
- Degradation to the terminal dock when an adapter is absent

**Exit:** met. Three harnesses render as segments; a fourth — Amp, installed and
perfectly usable — routes to the dock instead, with the Run control withheld
rather than offered and then refused.

**A trait, unlike M10.** Here there really are several implementations chosen at
runtime by the harness the user picked, and a fourth harness legitimately has
none. That is polymorphism; the Quiver source was a boolean.

**Captured, not documented.** `codex.jsonl` is a real `codex exec --json` run
that edited a file. Claude Code's OAuth had expired on this machine, so its
fixture pairs the envelope from a real `--output-format stream-json` run with
content-block shapes read out of Claude Code's own session logs — every key and
type observed, the prose invented. **Still owed: a live Claude turn**, once its
session is re-authenticated, following `opencode_live.rs`.

What the captures taught, none of which was in any documentation:

- Codex reads its prompt from **stdin** and hangs forever without it. It also
  emits `file_change` as a first-class item — the only harness that does —
  though it names files without diffing them, so there is nothing to count and
  nothing for M8b's Undo to reverse.
- Claude reports tool output as a **`user`-role** message, because that is how
  the Messages API models it. Read naively, the model's own tool results appear
  in the transcript as things the human said.
- Claude's hook frames (`hook_started`, `hook_response`) are machinery, not
  conversation.
- `codex exec resume <ID>` and `claude --resume <ID>`, both read off `--help`.

**Verified live:** `a_real_codex_turn_streams_and_edits` runs a Codex turn
through the actual run loop — 12 events, thread id captured, file really edited.
**Depends:** M3, M6.

## M11b. Sub-agents — met for opencode

A harness that fans work out to sub-agents rendered as an undifferentiated run
of tool calls.

- ✅ Sub-agent chips inline in the transcript — name, per-agent colour,
  `started working` state
- ✅ Clicking a chip opens that agent's work; the main thread stays collapsed
- ✅ `agent?: AgentRef` on the three `tool_call` events, omitted when absent
- ⛔ Codex and Claude attribution — neither capture shows a sub-agent frame

**What a sub-agent actually is, in opencode.** Not a nested stream. Delegation
goes through a single tool named `task`, and the child runs in a **separate
session** whose `parent_id` points back at the caller; none of its own tool calls
appear in the parent's `run --format json` output. So the `task` call is the
whole of what a transcript can attribute, and the panel shows what came back
rather than how it was reached.

That was read off **164 real `task` calls** in opencode's own session store, and
two things came out of it that a guess would have missed:

- **`state.metadata.sessionId` is the child session id** — it resolved to a real
  child session in all 164. That is the identity worth carrying, because two
  `explore` workers running at once share a name *and* a tool name, and differ
  only here. Grouping is on id for the same reason.
- **`subagent_type` is always present.** An earlier reading said it was
  sometimes missing; that was a truncated row, not a missing field. The parser
  still refuses to attribute a `task` call without one rather than inventing a
  name.

**Verified against a real recorded part**, not a transcription of one:
`tests/fixtures/opencode-task.json` is lifted out of the store with only its
free text replaced. It carries `state.title` and `state.time`, which the
hand-written case above it does not — reading a truncated row is how you miss a
field, so the fixture is there to catch that.

**Not verified live.** Three `opencode run` captures were started and none
produced a byte: `--format json` buffers to the end of the turn, and each was
killed after 12–35 minutes. The shape is real, from opencode's own database; the
end-to-end path is not exercised, and there is no screenshot of a chip in a live
transcript. Closing that needs one completed live turn, following
`record_demo_log.rs`.

**Colour is hashed from the agent id**, not assigned by order of appearance, so
one agent keeps its accent across a reload. Six accents: past that, a fan-out has
a legibility problem no palette fixes, and hashing into a larger set puts
near-identical hues side by side.

**Exit: partly met.** A fan-out reads as named agents and either can be opened —
for opencode. For Codex and Claude the field stays absent, which renders exactly
as it did before, because attributing a call to an agent that did not make it is
worse than not attributing it.
**Depends:** M8c, M11.

## M12. Multi-harness comparison ✅

The wedge. No competitor does this across vendors.

- One prompt fans out to N harnesses, each in its own worktree from the same commit
- Tabs per harness with status; the transcript and diff read one at a time
- Keep one: the winner's worktree survives, the rest are discarded

**Exit:** met, and proven with real agents rather than fixtures.
`live_comparison_of_two_real_harnesses` runs opencode and Codex on one prompt
and asserts each edited only its own worktree — two independent `seed.txt +1`
diffs — then keeps one and checks the other is gone.

**Resolution is the one place Artemis destroys work on purpose.** Discarding the
losers throws away uncommitted changes an agent spent real time and money on,
with no undo. Three guards: an unrecognised winner is refused outright rather
than read as "discard everything"; nothing outside the comparison is ever
touched (there is a test with a bystander worktree); and the UI names the
harnesses about to be discarded before it asks.

**No `force` parameter on resolve**, deliberately. A loser always has
uncommitted work — that is what an agent produces — so a flag would be required
every time, which teaches the caller to pass it blindly. The winner's identity
is the guard instead.

**A model belongs to one harness, never to a run.** Found the hard way: the
first live attempt passed opencode's model id to Codex, whose model refresh then
timed out and took the whole entry down. The comparison sends only a prompt.
Per-harness model choice is the natural follow-up.

**Not done:** per-tab diffstat in the tab strip itself, and reading two diffs
side by side rather than one at a time. Tabs were the deliberate choice — three
transcripts abreast are unreadable at any window width — but a compact
diffstat per tab would help pick which to read first.
**Depends:** M11, M5.

> **v0.4 — the reason Artemis exists** rather than Superset or Pane.

---

# Phase 5 — Release

## M13. Cross-platform and packaging — partly blocked

- ✅ Path assumptions audited out of the scanners, with tests
- ✅ CI matrix on macOS, Linux and Windows
- ✅ Bundling job for all three, on demand
- ⛔ Signed macOS builds and notarization — needs an Apple Developer ID
- ⛔ Auto-update — needs a keypair, an endpoint, and a version scheme

**Exit: not met, and cannot be from inside this repository.** A stranger cannot
install the macOS artifact today: unsigned, it is quarantined by Gatekeeper and
refuses to open. That needs a paid Apple Developer Program membership and
notarization credentials. Everything up to that point is done, and
[docs/RELEASING.md](docs/RELEASING.md) says exactly which secrets close it.

**Three real bugs found and fixed**, each of which alone would have made Artemis
find *no harnesses at all* on Windows:

- `PATH` was split on `':'`, which shreds `C:\tools;C:\bin` into four fragments
  naming nothing. Now `std::env::split_paths`.
- Nothing on a Windows `PATH` is called plain `opencode`. Now every `PATHEXT`
  extension is tried, and a command that already has one is left alone.
- `contains('/')` was the test for "this is a path", so `C:\tools\opencode.exe`
  was hunted for on `PATH` as a bare command name.

Empty `PATH` entries are now dropped too. A shell reads one as the working
directory, which would let a repository choose which binary Artemis runs.

**What is verified and what is not.** The `#[cfg(windows)]` code compiles for
`x86_64-pc-windows-msvc` — checked by lifting it into a standalone crate,
because a full cross-build cannot be done from macOS (`libsqlite3-sys` compiles
C and needs the MSVC toolchain). CI is what actually builds all three.
**Linux and macOS now pass.** Making the repository public gave it free Actions
minutes, which is what unblocked CI after five runs that had died on billing
without executing a step. The first run that actually ran caught three things,
all real and none in the feature being built at the time:

- **Three streaming tests were POSIX-only.** The fake harness was `/bin/sh -c`
  with a `printf` script, and that shell does not exist on Windows. The code
  under test was correct. Now a compiled `src/bin/fake_harness.rs`, which cargo
  builds for whatever target runs.
- **The privacy audit failed everywhere.** It derives the username from `$HOME`
  so it protects whoever runs it, but a CI runner's home directory is named
  after the service account, and that name appears legitimately in the workflow
  file and in lockfile paths. Service accounts are now skipped. (Writing the
  literal path into this file made the audit fail a second time, on the
  home-directory check — which is the rule working.)
- **A worktree test asserted bytes on Windows.** `core.autocrlf` is on by
  default there, so a correct checkout of `alpha\n` reads back `alpha\r\n`. The
  test now asserts what it means — that every worktree holds identical content.

**Open, and not yet investigated: what CRLF does to a comparison.** If a Windows
checkout is CRLF and an agent writes LF, a diff could report every touched line
as changed, which would make the diff view and Undo noisy rather than wrong.
Nothing here tests that, and no Windows machine has run the app.

Earlier, CI also caught a `fmt` violation and an `unused_mut` that only exists
off Windows, both under `clippy -D warnings`.
**Depends:** everything.
**Depends:** v0.4.

## M14. Open-source readiness — done except going public

- ✅ README rewritten, CONTRIBUTING, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), MIT LICENSE
- ✅ Issue and PR templates; this file is the public roadmap
- ✅ A privacy audit that runs over every tracked file
- ✅ Screenshot — a real turn, captured from the running desktop app
- ⛔ Repo public — the user's call, deliberately deferred
- ⛔ CI required — needs a run on GitHub first; CI has still never executed

**Four real leaks found and fixed** before any of this could be published. The
audit in `tests/repo.rs` reads every file git tracks:

- A hardcoded `~/.local/bin` in the browser host's launcher — a privacy leak and
  a portability bug in one, since it only ever worked on one machine.
- Seed data with an absolute path to a personal projects directory.
- A real project name in a Quiver documentation example.
- An opencode fixture captured in a scratch directory whose *flattened* name
  embedded the account name: `-Users-someone-Desktop-…`. No slashes, so a
  `/Users/` search missed it entirely.

That last one is why the test derives the current username from `$HOME` rather
than searching for path shapes. It also means the check protects whoever runs
it, not just the person who wrote it — and it does not need the name written
into a file that is about to be published.

**Exit: not met.** The documentation half is done — a stranger can build, run
and land a change. The repository is still private by choice, and CI has never
run, so "green and required" is unverified.

**The screenshot is a real turn**, not a mock: opencode was asked to add retry
logic to a throwaway repository, and `tests/record_demo_log.rs` recorded what it
actually emitted. Captured by window id rather than screen region — a region
capture picked up an unrelated window sitting over the app, twice.
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
