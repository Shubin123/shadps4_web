#!/usr/bin/env bash
# Publishes web/ (the page plus any built .wasm/.js artifacts) to the gh-pages branch, which GitHub Pages is configured to serve
# directly (Settings -> Pages -> Deploy from a branch -> gh-pages / root) - no GitHub Actions
# workflow involved. Run from a checkout of main.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE_DIR="$(mktemp -d)"
trap 'git -C "$REPO_ROOT" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true' EXIT

cd "$REPO_ROOT"

if git show-ref --verify --quiet refs/heads/gh-pages || git show-ref --verify --quiet refs/remotes/origin/gh-pages; then
    git worktree add "$WORKTREE_DIR" gh-pages
else
    git worktree add --orphan -b gh-pages "$WORKTREE_DIR"
fi

find "$WORKTREE_DIR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
rsync -a --exclude server.cjs web/ "$WORKTREE_DIR/"
touch "$WORKTREE_DIR/.nojekyll"

cd "$WORKTREE_DIR"
git add -A
if git diff --cached --quiet; then
    echo "gh-pages already up to date with web/"
    exit 0
fi

SOURCE_COMMIT="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
git commit -m "Deploy web/ from main@${SOURCE_COMMIT}"
git push origin gh-pages

echo "Deployed. Enable it once under Settings -> Pages -> Deploy from a branch -> gh-pages / (root)."
