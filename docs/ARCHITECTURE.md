# Architecture

Artemis is a desktop app that runs coding agents and renders what they do as a
readable transcript instead of a wall of terminal output.

Two halves: a **Rust host** that owns everything touching the machine, and a
**React webview** that owns everything the user reads. They meet at one place —
`@artemis/core`, a set of TypeScript types the Rust side mirrors exactly.

```
apps/desktop/src            React 19 + Vite. The window.
apps/desktop/src-tauri      Rust. Processes, git, sqlite, the filesystem.
packages/core               The contract. Types only, no behaviour.
packages/host-service       A browser-mode reference host, for `pnpm dev:web`.
```

## Why Tauri

Considered against Electron. Tauri won on three counts that mattered here: the
process work is Rust rather than Node (agents are subprocesses, and killing a
process group correctly matters), the bundle is tens of megabytes rather than
hundreds, and the privileged surface is an explicit list of commands rather than
a Node runtime with the filesystem in reach.

The cost is that anything the webview needs from the machine has to be a
command. That is a feature: `src-tauri/src/lib.rs` is the complete list of what
the UI can do.

## The contract

`packages/core` declares the wire types. `src-tauri/src/types.rs` mirrors them,
and `src-tauri/tests/contract.rs` pins the serialized shape by hand:

```rust
assert_eq!(to_json(&change), json!({ "path": "seed.txt", "additions": 1, … }));
```

Transcribed deliberately rather than generated. Changing the contract should
require touching both sides, which is what makes an accidental rename fail the
build instead of silently rendering an empty panel.

## A turn, end to end

1. The composer sends a prompt. `useChat` calls `streamChatMessage`.
2. `ChatStore::send_message` resolves the harness, builds its argv through the
   adapter layer, and spawns it in the workspace's worktree.
3. Output is read line by line. A **`HarnessAdapter`** turns each line into
   `RuntimeEvent`s — the only shape the rest of the app knows.
4. Events are appended to a JSONL **event log** and pushed to the webview in
   batches over a Tauri channel. Batched because a fast model emits a line per
   token, and one IPC message each would cost a render each.
5. `reduce.ts` folds events into a transcript of typed blocks. Renderers
   dispatch on block type; nothing falls through to raw text.

Reopening a session replays its log through the same reducer, so a live turn and
a replayed one are the same code path.

## Adapters

`src-tauri/src/chat/adapters/`. opencode, Codex and Claude Code each stream a
JSON dialect of their own invention, sharing no field names and no envelope.

Every adapter was written from a **captured live run**, not from documentation,
because documentation was wrong every time it was checked:

- opencode nests everything under `state`, sends each tool exactly once already
  finished, and computes per-file line counts itself.
- Codex reads its prompt from **stdin** and hangs forever without it.
- Claude reports tool output as a **`user`-role** message, because that is how
  the Messages API models it.

`tests/adapters.rs` runs the same conformance over all three against their own
fixtures. A harness with no adapter is not broken — `supports_streaming` is
false and the UI routes it to the terminal dock, which runs the real tool.

## State, and where it lives

| What | Where | Why there |
|---|---|---|
| Sessions, launch presets | `~/.artemis/artemis.sqlite` | Needs queries and migrations |
| Transcripts | `~/.artemis/sessions/*.jsonl` | Append-only; a crash mid-turn keeps what arrived |
| Settings | `~/.artemis/settings.json` | Hand-editable on purpose |
| Worktrees | `~/.artemis/worktrees/` | One per workspace |

Nothing is written to another tool's directory. Quiver's files under
`~/.config/swe/` are **read only**, ever.

## Worktrees

Every workspace is a git worktree, so two agents can work on one repository
without seeing each other's edits. Multi-harness comparison is the same idea
taken further: one prompt, N worktrees off the same commit, N diffs, keep one
and discard the rest.

Deleting the losers is the only operation in Artemis that deliberately destroys
work. It refuses anything it does not recognise rather than guessing, and never
touches a worktree outside the comparison.

## Undo

An agent's edit is reversed by reverse-applying the patch the harness reported,
not by restoring from git. The workspace usually holds the user's own
uncommitted work too, and `git checkout -- file` would take that with it.

`git apply --check` runs first, so an edit that no longer matches the file is
refused with a reason rather than forced. The paths inside a patch come from a
model and are rebuilt from a vetted relative path before use.

## Design system

`src/styles/tokens.css` is the only file allowed to contain a colour literal —
enforced by `src/test/tokens.test.ts`, which fails the build on any other. Light
and dark ship together.

## Testing

- **Rust** — real git repositories in temp directories, real processes, real
  files. Anything that can destroy work is tested against the real thing.
- **Front end** — vitest and Testing Library, driven through `App` with a fake
  host that mirrors the real client exactly.
- **Ignored tests** run actual agents and cost money. They exist because
  fixtures only prove the parser handles the shape it was cut from.

```bash
cargo test -- --ignored --nocapture   # needs the harnesses installed
```
