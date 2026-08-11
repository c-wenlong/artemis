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
#   git reset --hard backup/pre-scrub-<sha> && git push --force
#
# A force-push does NOT remove the old commits from GitHub. They stay fetchable
# by SHA until GitHub garbage-collects, which can take a long time. Before going
# public, either ask GitHub support to GC the repository, or push the rewritten
# history to a freshly created one. This script cleans your history; only that
# last step cleans the remote's.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty. Commit or stash first." >&2
  exit 1
fi

TOKENS="${SCRUB_TOKENS:-$PWD/scripts/scrub-tokens.txt}"
if [[ ! -f "$TOKENS" ]]; then
  echo "error: no token file at ${TOKENS}" >&2
  echo "       copy scripts/scrub-tokens.example to it and fill it in." >&2
  echo "       it is gitignored: it holds the data being removed." >&2
  exit 1
fi
export SCRUB_TOKENS="$TOKENS"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" == "HEAD" ]]; then
  echo "error: detached HEAD. Check out the branch you want rewritten." >&2
  exit 1
fi

BACKUP="backup/pre-scrub-$(git rev-parse --short HEAD)"
echo "==> backing up ${BRANCH} to ${BACKUP}"
git branch -f "$BACKUP"

BEFORE_TREE="$(git rev-parse HEAD^{tree})"
BEFORE_COUNT="$(git rev-list --count "$BRANCH")"

# Only the current branch is rewritten. `-- --all` would rewrite *every* ref,
# including the backup branch created a moment ago, leaving nothing to go back
# to. `refs/original/` would still hold the originals, but a backup you have to
# know that about is not a backup.
echo "==> rewriting ${BEFORE_COUNT} commits on ${BRANCH}"
FILTER_BRANCH_SQUELCH_WARNING=1 \
  git filter-branch -f \
    --tree-filter "python3 '$PWD/scripts/scrub_tree.py'" \
    --prune-empty -- "$BRANCH"

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

# 2. Say which commits `--prune-empty` dropped.
#
# A commit whose entire diff was personal data scrubs down to nothing and is
# removed, message and all. That is usually what you want, but it should never
# be silent. Subjects are compared rather than SHAs, because every SHA changed;
# two commits sharing a subject would report imprecisely, which is why the count
# is authoritative and the list is only there to name them.
AFTER_COUNT="$(git rev-list --count "$BRANCH")"
PRUNED=$(( BEFORE_COUNT - AFTER_COUNT ))
if (( PRUNED > 0 )); then
  echo "    ${PRUNED} commit(s) became empty and were pruned:"
  comm -13 \
    <(git log --format='%s' "$BRANCH" | sort) \
    <(git log --format='%s' "$BACKUP" | sort) | sed 's/^/      /'
else
  echo "    no commits pruned (${AFTER_COUNT} kept)"
fi

# 3. Nothing personal may survive anywhere in the rewritten history.
#
# Scoped to the rewritten branch on purpose: the backup branch and
# `refs/original/` still point at the old commits, and are supposed to.
SCRUB_BRANCH="$BRANCH" python3 - <<'PY'
import os, re, subprocess, sys

BRANCH = os.environ["SCRUB_BRANCH"]

def sh(a): return subprocess.run(a, capture_output=True).stdout

# The personal strings come from the gitignored token file, so this script can
# be published without spelling them out. The two generic shapes are patterns,
# not data, and stay here.
TOKENS = [
    line.split("\t", 1)[0]
    for line in open(os.environ["SCRUB_TOKENS"], encoding="utf-8").read().splitlines()
    if line.strip() and not line.lstrip().startswith("#") and "\t" in line
]

PATTERNS = {
    "token":      re.compile(b"|".join(re.escape(t.encode()) for t in TOKENS)),
    "identifier": re.compile(rb"\b[Aa]\d{7}[A-Za-z]\b"),
    "home dir":   re.compile(rb"/(Users|home)/(?!you/|user/|example/)[A-Za-z0-9._-]{2,}/"),
}

blobs = {}
for commit in sh(["git", "rev-list", BRANCH]).decode().split():
    for line in sh(["git", "ls-tree", "-r", commit]).decode().splitlines():
        meta, path = line.split("\t", 1)
        blobs.setdefault(meta.split()[2], path)

bad = []
for sha, path in blobs.items():
    data = sh(["git", "cat-file", "blob", sha])
    if not data:
        continue
    # Binary blobs are searched too. Skipping them is what let a committed
    # `.pyc` — carrying every literal this script removes — pass as clean.
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
  git push --force origin "$BRANCH"
  echo "    done. Old history is still at ${BACKUP} locally."
  echo
  echo "    The old commits remain fetchable by SHA on GitHub until it"
  echo "    garbage-collects. Before making this repository public, ask GitHub"
  echo "    support to GC it, or push to a freshly created repository instead."
else
  echo "Rewrite complete and verified. Nothing has been pushed."
  echo "  inspect: git log --oneline | head"
  echo "  publish: git push --force origin ${BRANCH}"
  echo "  undo:    git reset --hard ${BACKUP}"
fi
