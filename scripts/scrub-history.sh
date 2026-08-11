#!/usr/bin/env bash
#
# Remove personal data from every commit, not just the working tree.
#
# The 2026-08-11 pre-public audit found the author's home directory, real
# project names, and two student identifiers in commits from before they were
# cleaned up. Nothing in history is a credential — every blob was scanned — but
# a git history is permanent once published, so it is worth removing first.
#
#   ./scripts/scrub-history.sh          # rewrite locally, verify, stop
#   ./scripts/scrub-history.sh --push   # …and force-push when clean
#
# This rewrites every commit SHA. That is safe here only because the repository
# is private with no other collaborators. If that has changed, stop: anyone with
# a clone will have to re-clone.
#
# A backup branch is made first, so the old history is one command away:
#   git reset --hard backup/pre-scrub && git push --force
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty. Commit or stash first." >&2
  exit 1
fi

BACKUP="backup/pre-scrub-$(git rev-parse --short HEAD)"
echo "==> backing up current history to ${BACKUP}"
git branch -f "$BACKUP"

BEFORE_TREE="$(git rev-parse HEAD^{tree})"

echo "==> rewriting $(git rev-list --all --count) commits"
FILTER_BRANCH_SQUELCH_WARNING=1 \
  git filter-branch -f \
    --tree-filter "python3 '$PWD/scripts/scrub_tree.py'" \
    --prune-empty -- --all

echo
echo "==> verifying"

# 1. The current tree must be untouched: this removes history, not work.
AFTER_TREE="$(git rev-parse HEAD^{tree})"
if [[ "$BEFORE_TREE" != "$AFTER_TREE" ]]; then
  echo "error: HEAD's tree changed. Expected the working state to be identical." >&2
  echo "       restore with: git reset --hard ${BACKUP}" >&2
  exit 1
fi
echo "    HEAD tree unchanged (${AFTER_TREE:0:10})"

# 2. Nothing personal may survive anywhere in the rewritten history.
python3 - <<'PY'
import re, subprocess, sys

def sh(a): return subprocess.run(a, capture_output=True).stdout

PATTERNS = {
    "account name": re.compile(rb"example"),
    "identifier":   re.compile(rb"\b[Aa]\d{7}[A-Za-z]\b"),
    "project name": re.compile(rb"example-project|example-api|GESS1025|cs3211"),
    "home dir":     re.compile(rb"/(Users|home)/(?!you/|user/|example/)[A-Za-z0-9._-]{2,}/"),
}

blobs = {}
for commit in sh(["git", "rev-list", "--all"]).decode().split():
    for line in sh(["git", "ls-tree", "-r", commit]).decode().splitlines():
        meta, path = line.split("\t", 1)
        blobs.setdefault(meta.split()[2], path)

bad = []
for sha, path in blobs.items():
    data = sh(["git", "cat-file", "blob", sha])
    if not data or b"\0" in data[:8000]:
        continue
    # Lockfile checksums contain hex runs shaped like an identifier.
    skip = path.endswith(("Cargo.lock", "pnpm-lock.yaml", "package-lock.json"))
    for label, pattern in PATTERNS.items():
        if label == "identifier" and skip:
            continue
        if pattern.search(data):
            bad.append(f"{label}: {path}")

if bad:
    print("    RESIDUE REMAINS:", file=sys.stderr)
    for row in sorted(set(bad))[:20]:
        print(f"      {row}", file=sys.stderr)
    raise SystemExit(1)
print(f"    {len(blobs)} reachable blobs, none carrying personal data")
PY

echo
if [[ "${1:-}" == "--push" ]]; then
  echo "==> force-pushing"
  git push --force origin HEAD
  echo "    done. Old history is still at ${BACKUP} locally."
else
  echo "Rewrite complete and verified. Nothing has been pushed."
  echo "  inspect: git log --oneline | head"
  echo "  publish: git push --force origin HEAD"
  echo "  undo:    git reset --hard ${BACKUP}"
fi
