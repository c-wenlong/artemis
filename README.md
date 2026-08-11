# Artemis

A desktop app for running AI coding agents and actually reading what they did.

Agents are good and their output is unreadable. A terminal gives you a scrolling
wall in which the answer, the reasoning, forty tool calls and the file edits all
look the same. Artemis renders a turn as structured blocks — the answer first,
the mechanics behind a header, the edits as a diff you can undo — and it does
that for several agents at once, in isolated git worktrees, so you can compare
their answers and keep one.

Local-first. Nothing is sent anywhere except by the agent you launched.

## Requirements

- **Node 22+** and **pnpm**
- A **Rust toolchain** (for the desktop host)
- On Linux, Tauri's system dependencies — see
  [the Tauri prerequisites](https://tauri.app/start/prerequisites/); the exact
  apt list is in `.github/workflows/ci.yml`
- At least one agent on your `PATH`: [opencode](https://opencode.ai),
  [Codex](https://developers.openai.com/codex/cli), or
  [Claude Code](https://claude.com/product/claude-code)

## Quick start

```bash
pnpm install
pnpm dev
```

`pnpm dev:web` runs the interface alone in a browser — faster for UI work, but
it cannot stream a turn, open a terminal or read a file, because all of that
lives in the Rust host. It says so where it matters rather than failing quietly.

![A finished turn in Artemis: the prompt with its timestamp, a "Worked for 40s"
header, collapsed reasoning and tool activity, the answer, and a card showing
one file edited +27 −2 with Undo and Review.](docs/images/transcript.png)

*A real turn, recorded against a throwaway repository. opencode was asked to add
retry logic; the transcript shows what it thought, what it ran, what it said,
and what it changed.*

## What it does

**Reads a turn properly.** Prose is the answer; tool calls fold behind a
`Worked for 2m 24s` header. File references in the text become chips you can
click to see the lines they name. Long prompts collapse behind *Show more*.

![A file opened at a cited line: retry.py, lines 18 to 30 of 45, with line 24
marked as the one the answer referred to.](docs/images/peek.png)

*Following a citation reads the file from disk. A citation whose line no longer
exists still opens the file, and says so rather than highlighting whatever moved
into its place.*

**Shows what changed, and takes it back.** Every turn ends with what it edited
and by how much. Opening a file shows its diff; **Undo** reverse-applies that
one file's patch — so an unrelated edit of yours in the same file survives,
which restoring from git would not. If the file has moved on since, the undo is
refused with a reason rather than forced.

![An inline diff with old and new line numbers in separate gutters, additions
tinted green and the removal tinted red.](docs/images/diff.png)

**Runs several agents on one prompt.** Each gets its own git worktree off the
same commit, so they cannot see each other's work. You read the diffs side by
side and keep one; the rest are discarded.

![The Compare harnesses dialog: one prompt field, and a checklist of Claude
Code, Codex CLI and OpenCode with their versions.](docs/images/compare.png)

*Only harnesses Artemis can parse are offered here — the rest run in the
terminal dock instead.*

**Speaks three protocols.** opencode, Codex and Claude Code each stream a
different JSON dialect. A harness Artemis cannot parse is not broken — it runs
for real in the terminal dock instead of being shown half-rendered.

**Forks a conversation.** Branch at any turn into a new session carrying
everything up to that point.

**Imports your history.** If you use [Quiver](https://github.com/c-wenlong/quiver),
Artemis reads its session cache and offers past conversations across every
harness you have used. Optional, read-only, and absent without it.

![Settings, Appearance tab: a grid of eleven app icons with Olympian
selected.](docs/images/settings-appearance.png)

*The icon applies to the running app immediately. The one Finder shows is baked
in at build time, and the panel says so rather than letting you wonder.*

## Status

Everything above works. Two things do not, and both are written down rather than
implied:

- **No signed builds.** A downloaded `.app` is quarantined by macOS and will not
  open, because signing needs an Apple Developer ID. Build it yourself, or see
  [docs/RELEASING.md](docs/RELEASING.md).
- **Linux and Windows are compiled and tested, never run.** CI builds all three
  platforms; nobody has yet launched it on two of them.

## Documentation

- [MILESTONES.md](MILESTONES.md) — the real roadmap. What is done, what is
  deliberately not being built, and what is blocked on something external.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the Rust host and the
  webview fit together.
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to run the checks, and what a change
  is expected to look like.
- [docs/RELEASING.md](docs/RELEASING.md) — what CI does, and which credentials
  the rest needs.
- [docs/QUIVER_SCHEMA.md](docs/QUIVER_SCHEMA.md) — the on-disk shapes Artemis
  reads from Quiver.

## A note on how this was built

Every harness adapter was written from a **captured live run**, never from
documentation — and every time the two were compared, the documentation was
wrong. opencode nests tool data under `state` and sends each call once, already
finished. Codex reads its prompt from stdin and hangs forever without it. Claude
reports tool output as a user-role message.

The tests reflect that. Anything that can destroy work is tested against real
git repositories, and the tests that run actual agents are `#[ignore]`d rather
than mocked away, because a fixture only proves the parser handles the shape it
was cut from.

## Licence

MIT. See [LICENSE](LICENSE).
