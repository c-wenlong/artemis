# Quiver Integration

Assessment of `orchestrators/quiver` (19,172 LOC Python, stdlib-only) as an
asset source for Artemis, and how to consume it without inheriting its
failure modes.

## What Quiver actually has

Read at `5373a2e`. The parts that matter to Artemis:

| Capability | Where | Value to Artemis |
|---|---|---|
| **Harness registry**: 29 tools with command, version, tags, aliases | `~/.config/swe/tools.json` | High. Curated and user-edited; strictly better than a PATH scan. |
| **Session history: 731 parsed sessions across 20+ harnesses** | `~/.config/swe/session_cache.json` | **Highest.** See below. |
| **Session parsers** | `sessions/parsers.py` | opencode, claude, codex, copilot, cursor, amp, droid, pi, kimi, tau, crush, cline, continue, forge, mimo, grok, hermes, freebuff. Three storage engines (json, jsonl, sqlite). |
| **MCP discovery + cross-tool reconciliation** | `swe mcp discover --json` | High. Reports which harnesses each server is registered in: exactly Artemis's "configuration sync" product area. |
| **Skills discovery** | `swe skills discover --json`, `skill_links.json` | Medium. Catalogs, scopes, and the harness symlink layout. |
| **Providers + API key metadata** | `~/.config/swe/providers.json` | Medium. Credential-free provider metadata. |
| **Rate limits** | `rate_limits_cache.json` | Medium. Quota remaining per harness: a genuinely nice cockpit widget. |
| Reports, follow-ups, setup wizard, shell completion | `reports/`, `setup/` | None. CLI-shaped, out of scope. |

### The session cache is the prize

```json
{
  "timestamp": 1771974850400.0,
  "agent": "OpenCode",
  "path": "/work/example-project",
  "title": "Codebase exploration for project understanding",
  "session_id": "ses_36e15853affenKV8GjzJMPpBJq",
  "tool_name": "opencode"
}
```

That `session_id` is precisely what `ChatSession.opencodeSessionId` needs to
resume a conversation. Quiver has already solved reading 20+ proprietary session
formats: the single most tedious, least differentiating problem Artemis would
otherwise face. Reimplementing it is weeks of work against undocumented,
drifting formats.

**Artemis's "resume any session from any agent" comes essentially free.**

## Why the three options I originally offered were all wrong

I framed this as embed-vs-shell-out-vs-independent. The real structure is
different, because **Quiver's state is plain JSON files on disk.** There is no
API to call and no runtime to embed. Reading `tools.json` costs nothing and
couples to nothing.

That splits into two very different integration surfaces:

- **Static state** (`tools.json`, `session_cache.json`, `providers.json`,
  `skill_links.json`, `rate_limits_cache.json`): plain files. Read them
  directly. No Python, no subprocess, no version coupling.
- **Live computation** (`swe mcp discover --json`, `swe skills discover --json`,
  `swe harness discover --json`): requires running Quiver. Only these need a
  subprocess.

Note `swe harness discover --json` returns `[]` here, because it reports only
*unregistered* harnesses. Discovery commands answer "what's new", not "what
exists": the latter is the registry file. Easy to get wrong.

## Recommended integration

**Quiver is an optional enrichment source, never a dependency.** Artemis must
work fully with Quiver absent. When present, Artemis gets better data.

### One interface, three implementations

```
packages/core/src/catalog/AssetSource
  ├─ NativeAssetSource    always present:  Artemis's own scanners
  ├─ QuiverFileSource     reads ~/.config/swe/*.json  (no subprocess)
  └─ QuiverCliSource      shells `swe … --json`       (opt-in, off by default)
```

Merge policy, in precedence order: native scan establishes ground truth (is the
binary actually on disk and executable), Quiver layers on top (aliases, tags,
descriptions, curated versions, rate limits, session history). Every merged
field carries provenance: Artemis's `HarnessAsset.source` field already exists
for exactly this, currently carrying `"settings"`.

### The decoupling rules

1. **Parse defensively, at the boundary.** One `quiver/` module owns every
   schema assumption. A Quiver release that renames a field breaks one file, and
   that file falls back to native rather than throwing.
2. **Never write to `~/.config/swe/`.** Read-only, always. Artemis writing to
   Quiver's state creates a two-writer problem across two languages with no
   locking protocol. Mutations go through the CLI or not at all.
3. **Treat every field as optional.** Validate shape on read; drop unknown
   entries; never let a malformed row fail a whole load.
4. **Subprocess is opt-in and always cancellable.** `QuiverCliSource` stays off
   until the user enables it, runs with a timeout, and treats non-zero exit as
   "no data" rather than an error state.
5. **Version-probe once per launch.** `swe --version` into a capability record.
   Unknown or unsupported version → file source only.
6. **Copy, don't reference, for anything on a hot path.** Session history is
   read into Artemis's own store at import time. Artemis must not re-read
   Quiver's files on every render.
7. **The contract is the JSON files, not the Python.** Never import Quiver as a
   library, never depend on its internals: only the documented on-disk shapes,
   pinned in `docs/QUIVER_SCHEMA.md` with a fixture per file for tests.

### What Artemis should own outright

Anything in the live agent loop: harness readiness, process launch, PTY,
streaming events, workspace/git state. These need sub-second latency and precise
error semantics; a stale JSON cache or a Python subprocess has no place in them.
Quiver's role is **catalog and history**: the cold path.

## Verdict

Worth integrating, at file level, for three things in priority order: **session
history** (very high value, near-zero cost, saves weeks), **MCP cross-tool
reconciliation** (high value, needs the CLI), and **registry enrichment**
(moderate value, near-zero cost).

Deliberately *not* integrated: reports, follow-ups, the setup wizard, and
anything that would make `swe` a runtime requirement of Artemis.
