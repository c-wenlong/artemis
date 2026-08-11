# Quiver's on-disk shapes

The contract between Artemis and Quiver is these files, not Quiver's Python.
`apps/desktop/src-tauri/src/quiver.rs` is the only place in Artemis that knows
them, and `tests/fixtures/quiver/` holds trimmed copies of the real thing so a
drift breaks a test rather than a user's inventory.

Read from a live install on 2026-08-11. Every field is treated as optional in
code regardless of what is written here: this is a hand-editable file set.

## `~/.config/swe/tools.json` — the harness registry

An **object keyed by tool id**, not a list. 29 entries on the machine this was
read from.

```json
{
  "claude": {
    "command": "claude",
    "description": "Claude Code by Anthropic — agentic coding assistant",
    "version": "2.1.126",
    "tags": ["agentic", "coding", "byok"],
    "aliases": ["cc"]
  }
}
```

Artemis uses `aliases`, `description`, and `version` — and only where its own
scan found nothing. The scan decides what exists and what version answered;
this file is curated by hand and can name a binary that has been uninstalled.

## `~/.config/swe/session_cache.json` — parsed history

**The reason to integrate at all.** 731 sessions across 19 harnesses: amp,
antigravity, claude, cline, codex, continue, copilot, crush, droid, forge,
freebuff, gemini, grok, hermes, kimi, mimo, opencode, pi, tau.

```json
{
  "cached_at": 1785818904.9,
  "sessions": [
    {
      "timestamp": 1771974850400.0,
      "agent": "OpenCode",
      "path": "/Users/you/Projects/example-project",
      "title": "Codebase exploration for project understanding",
      "session_id": "ses_36e15853affenKV8GjzJMPpBJq",
      "tool_name": "opencode"
    }
  ]
}
```

- `timestamp` is **milliseconds** since the epoch, as a float.
- `session_id` is the harness's own id — what makes a row resumable. Artemis
  drops rows without one; history that cannot be reopened is not what this file
  is read for.
- `tool_name` is the registry id (`opencode`); `agent` is the display name
  (`OpenCode`).
- Older Quiver wrote a bare array instead of `{ cached_at, sessions }`. Both
  are parsed.

## `~/.config/swe/providers.json`

Object keyed by provider id. Credential-free metadata: `name`, `description`,
`url`, `key_filename`, `env_vars`, `aliases`. Not yet consumed — Artemis's own
provider scan covers what the inventory needs.

## `~/.config/swe/rate_limits_cache.json`

`{ cached_at, updated_at, limits: { <tool>: { used_percent, limit_reached,
reset_at, plan_type, … } } }`. Not yet consumed.

## `~/.config/swe/skill_links.json`

`{ updated, links: [ { label, path, target, kind } ] }` — the harness symlink
layout. Not yet consumed; Artemis scans the skill roots itself.

## `swe mcp discover --json` — the one thing that needs a subprocess

```json
[
  {
    "name": "dv__github",
    "tools": ["claude", "codex", "copilot", "droid", "opencode"],
    "status": "new",
    "source_tool": "codex",
    "summary": "…"
  }
]
```

`tools` is the cross-tool reconciliation — every harness the server is
registered in. Artemis has no native equivalent, because that registration
lives in each harness's own config in its own format.

Off unless `quiverCliEnabled` is set. Any failure — missing binary, non-zero
exit, timeout, unparseable output — means an empty list, never an error.

## Corrections to `QUIVER_INTEGRATION.md`

Found while implementing, against the live install:

- **`swe --version` is not a command.** It prints `Unknown command: '--version'`
  and exits non-zero, so the "version-probe once per launch" rule in the
  assessment cannot be implemented as written. Artemis treats "the command ran
  and returned parseable JSON" as the capability check instead.
- The assessment says "20+ harnesses" in the history. It is 19.
- `tools.json` is an object keyed by id, not a list of tools.
