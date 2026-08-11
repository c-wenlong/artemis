#!/usr/bin/env python3
"""Remove personal data from one checked-out tree.

Run as the `--tree-filter` of `git filter-branch`, so git invokes it once per
commit with that commit's tree checked out. See `scripts/scrub-history.sh`.

Three kinds of replacement, deliberately different in scope:

- **Global tokens** are unique enough that replacing them anywhere is safe: an
  account name, two student identifiers, one project name.
- **The Quiver fixture** is rewritten field by field, because its titles contain
  ordinary English ("General", "Code review request") that must not be replaced
  anywhere else. A blanket substitution of a word like "General" would corrupt
  the Settings tab label.
- **Nothing else.** Binary files are skipped; so is anything not tracked.

Idempotent: running it on an already-clean tree changes nothing.
"""

import json
import os
import re
import subprocess
import sys

FIXTURE = "apps/desktop/src-tauri/tests/fixtures/quiver/session_cache.json"

# Distinctive strings, safe to replace wherever they appear.
GLOBAL: list[tuple[bytes, bytes]] = [
    (b"example", b"example"),
    (b"example-project", b"example-project"),
    (b"example-service", b"example-service"),
    (b"example-docs", b"example-docs"),
    (b"example-api", b"example-api"),
]

# Student identifiers, in any case. Kept as a pattern rather than a literal so
# a second one that was never noticed is caught too.
IDENTIFIER = re.compile(rb"\b[Aa]\d{7}[A-Za-z]\b")

# The fixture, by position. Same field types and the same variety of path and
# title as the capture, so the parser is exercised exactly as before.
NEUTRAL_SESSIONS = [
    ("/work/example-project", "Codebase exploration for project understanding"),
    ("/work/example-project", "Code review request"),
    ("/work/example-project", "Explore codebase structure (@explore subagent)"),
    ("/work/example-service", "Directory listing review for service files"),
    ("/work/notes", "General"),
    ("/work/example-api", "Batch job project"),
    ("/work/example-api", "Explore project code (@explore subagent)"),
    ("/work/example-docs", "Prepare release notes"),
]


# Lockfiles are full of hex checksums, and a checksum can contain a run that
# looks like an identifier. Corrupting one would make an old commit unbuildable
# for no benefit, so the pattern is not applied to them. The literal
# replacements above are still safe everywhere: none of them is hex.
CHECKSUM_HEAVY = ("Cargo.lock", "pnpm-lock.yaml", "package-lock.json")


def scrub_bytes(data: bytes, path: str = "") -> bytes:
    """Global token and identifier replacement. Text only."""
    for needle, replacement in GLOBAL:
        data = data.replace(needle, replacement)
    if path.endswith(CHECKSUM_HEAVY):
        return data
    return IDENTIFIER.sub(b"redacted-id", data)


def scrub_fixture(raw: bytes) -> bytes:
    """Rewrite the captured session cache to neutral content, same shape."""
    try:
        parsed = json.loads(raw)
        sessions = parsed["sessions"]
    except (ValueError, KeyError, TypeError):
        # An older or different shape: fall back to token replacement rather
        # than dropping the file's content on the floor.
        return scrub_bytes(raw, FIXTURE)

    for index, session in enumerate(sessions):
        path, title = NEUTRAL_SESSIONS[index % len(NEUTRAL_SESSIONS)]
        if isinstance(session, dict):
            if "path" in session:
                session["path"] = path
            if "title" in session:
                session["title"] = title
    return (json.dumps(parsed, indent=2) + "\n").encode()


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], capture_output=True).stdout
    return [p.decode("utf-8", "surrogateescape") for p in out.split(b"\0") if p]


def main() -> int:
    changed = 0
    for path in tracked_files():
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "rb") as handle:
                data = handle.read()
        except OSError:
            continue
        if b"\0" in data[:8000]:
            continue

        scrubbed = scrub_fixture(data) if path == FIXTURE else scrub_bytes(data, path)
        if scrubbed != data:
            with open(path, "wb") as handle:
                handle.write(scrubbed)
            changed += 1

    if changed and os.environ.get("SCRUB_VERBOSE"):
        print(f"  scrubbed {changed} file(s)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
