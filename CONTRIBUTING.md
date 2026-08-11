# Contributing

## Getting set up

You need Node 22+, pnpm, and a Rust toolchain. On Linux you also need Tauri's
system dependencies — see [the Tauri prerequisites][tauri-prereqs]; the exact
apt list Artemis uses is in `.github/workflows/ci.yml`.

```bash
pnpm install
pnpm dev          # the desktop app
pnpm dev:web      # the UI alone in a browser, no Rust host
```

`pnpm dev:web` is quicker for UI work but cannot stream a turn, open a terminal,
read a file or change the app icon — all of that lives in the Rust host. It says
so where it matters rather than failing quietly.

To do anything interesting you need at least one harness installed:
[opencode][opencode], [Codex][codex], or [Claude Code][claude]. Artemis finds
them on `PATH`.

[tauri-prereqs]: https://tauri.app/start/prerequisites/
[opencode]: https://opencode.ai
[codex]: https://developers.openai.com/codex/cli
[claude]: https://claude.com/product/claude-code

## The checks

CI runs these on macOS, Linux and Windows. Run them before pushing:

```bash
pnpm -r typecheck
pnpm test

cd apps/desktop/src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

`clippy -D warnings` is stricter than a bare `cargo clippy`, and the difference
has caught real things. Run it the way CI does.

### The tests that cost money

Some tests run a real agent against a real repository. They are `#[ignore]`d, so
they never run in CI, and they are the only way to catch a harness changing its
output format:

```bash
OPENCODE_BIN=$(command -v opencode) \
  cargo test --test opencode_live -- --ignored --nocapture
```

**If you change an adapter, run one.** Every adapter in this repository was
written from a captured live run, and every time the captured output was checked
against the documentation, the documentation was wrong.

## How changes are expected to look

**Tests first, and watch them fail.** A test that has never been red has not
been shown to test anything. Several bugs here were found because a test passed
when it should not have — including one that asserted a path was relative while
the value was `private/var/folders/…/seed.txt`.

**Verify against the real thing where one exists.** Fixtures prove the parser
handles the shape it was cut from. Only a live run proves that is still the
shape.

**Say what you did not do.** A limitation written down is a known limitation. A
limitation left out is a bug someone else finds. `MILESTONES.md` records
deliberate omissions alongside completed work, and so should a pull request.

**Comments explain why, not what.** The code says what it does. A comment earns
its place by explaining a decision that is not obvious from reading — a
constraint from a harness, a failure mode being avoided, an approach that was
tried and did not work.

## Things to know before you change them

- **`packages/core` is the contract.** Change a type there and you must change
  `src-tauri/src/types.rs` and `tests/contract.rs` too. The duplication is
  deliberate: it makes an accidental rename fail the build.
- **Colours live in `src/styles/tokens.css` and nowhere else.**
  `src/test/tokens.test.ts` fails on any colour literal in another file.
- **Never write to another tool's directory.** Quiver's files under
  `~/.config/swe/` are read-only. Two writers in two languages with no locking
  is a corruption bug waiting to happen.
- **Anything that can destroy work needs a test against real git.** Undo,
  worktree deletion, and picking a comparison winner all delete things. They are
  tested against real repositories, not mocks.

## Where to start

`MILESTONES.md` is the real roadmap, including what is blocked and why.
`docs/ARCHITECTURE.md` explains how the halves fit together. Both are kept
honest — if you find them wrong, that is a bug worth reporting on its own.
