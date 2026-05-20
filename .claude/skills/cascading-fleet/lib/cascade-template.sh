#!/usr/bin/env bash
# Fleet cascade — propagate a socket-wheelhouse/template/ SHA to every fleet
# repo. Bash3-safe (works on macOS default bash). Uses the FLEET_SYNC=1
# sentinel to bypass the no-revert-guard / overeager-staging-guard hooks
# without per-repo Allow-bypass phrases.
#
# Usage:
#   bash .claude/skills/cascading-fleet/lib/cascade-template.sh <template-sha>
#
# The script reads the canonical fleet-repo list from
# `<this-dir>/fleet-repos.txt`. Each repo's worktree is created off
# `origin/<default-branch>`, the wheelhouse sync-scaffolding CLI runs,
# the resulting changes are committed, and the script tries a direct
# push first, falling back to opening a PR on rejection.

set -uo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <template-sha>" >&2
  exit 2
fi

TEMPLATE_SHA="$1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FLEET_REPOS_FILE="$SCRIPT_DIR/fleet-repos.txt"
PROJECTS="${PROJECTS:-$HOME/projects}"
# socket-hook: allow cross-repo
WH_SCRIPT="${PROJECTS}/socket-wheelhouse/scripts/sync-scaffolding/cli.mts"

# Prepend the active Node version's bin dir to PATH so the `node` invoked by
# the wheelhouse CLI matches the operator's expected toolchain (avoids the
# pre-commit hook's "wrong Node" fallback). Honors NVM_BIN when set; otherwise
# leaves PATH alone so a Volta / homebrew / system Node still resolves.
if [ -n "$NVM_BIN" ]; then
  PATH="$NVM_BIN:$PATH"
fi

if [ ! -f "$FLEET_REPOS_FILE" ]; then
  echo "fleet-repos.txt not found at $FLEET_REPOS_FILE" >&2
  exit 2
fi
if [ ! -f "$WH_SCRIPT" ]; then
  echo "wheelhouse sync-scaffolding CLI not found at $WH_SCRIPT" >&2
  echo "set PROJECTS=<dir containing socket-wheelhouse> before retrying" >&2
  exit 2
fi

RESULTS=()
LOG_FILE="/tmp/cascade-${TEMPLATE_SHA}.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "══ Cascade ${TEMPLATE_SHA} ══"
echo "Log: $LOG_FILE"
echo

# Resolve a canonical fleet repo name to a local primary checkout.
# Mirrors scripts/sync-scaffolding/discover.mts directoryAliasesFor():
# canonical `socket-<x>` also resolves to `~/projects/<x>/`; canonical
# `<x>` (no socket- prefix — sdxgen, stuie, ultrathink) also resolves
# to `~/projects/socket-<x>/`. First primary checkout wins. Echoes
# the resolved absolute path, or empty when no primary checkout exists.
resolveLocalCheckout() {
  local canonical="$1"
  local candidate
  # Exact canonical name first.
  candidate="${PROJECTS}/${canonical}"
  if [ -d "${candidate}/.git" ]; then
    echo "$candidate"
    return 0
  fi
  # Alias: socket-<x> ⇄ <x>.
  case "$canonical" in
    socket-*)
      candidate="${PROJECTS}/${canonical#socket-}"
      ;;
    *)
      candidate="${PROJECTS}/socket-${canonical}"
      ;;
  esac
  if [ -d "${candidate}/.git" ]; then
    echo "$candidate"
    return 0
  fi
  return 1
}

while IFS= read -r repo; do
  [ -z "$repo" ] && continue
  case "$repo" in '#'*) continue ;; esac

  src="$(resolveLocalCheckout "$repo")"
  wt="/tmp/cascade-${repo}-$$"
  echo "── ${repo} ──"

  if [ -z "$src" ]; then
    RESULTS+=("${repo}|skip:no-git")
    continue
  fi

  # All cleanup commands run from $src so a mid-loop crash leaves the
  # worktree-orphaned state recoverable (the next run pre-cleans by name).
  cd "${src}" || { RESULTS+=("${repo}|fail:cd"); continue; }

  base=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
  [ -z "$base" ] && git show-ref --verify --quiet refs/remotes/origin/main && base=main
  [ -z "$base" ] && git show-ref --verify --quiet refs/remotes/origin/master && base=master
  base="${base:-main}"

  git fetch origin "$base" --quiet
  branch="chore/sync-${TEMPLATE_SHA}"

  git worktree remove --force "$wt" 2>/dev/null
  git branch -D "$branch" 2>/dev/null

  if ! git worktree add -b "$branch" "$wt" "origin/$base" 2>&1 | tail -1; then
    RESULTS+=("${repo}|fail:worktree")
    continue
  fi
  cd "$wt" || { RESULTS+=("${repo}|fail:cd-wt"); continue; }

  node "$WH_SCRIPT" --target "$wt" --fix 2>&1 | tail -3

  ahead=$(git rev-list --count "origin/$base..HEAD" 2>/dev/null || echo 0)
  if [ "$ahead" -eq 0 ]; then
    if [ -z "$(git status --porcelain)" ]; then
      RESULTS+=("${repo}|noop")
      cd /tmp
      git -C "$src" worktree remove --force "$wt" 2>/dev/null
      git -C "$src" branch -D "$branch" 2>/dev/null
      continue
    fi
    FLEET_SYNC=1 git add --update
    if ! FLEET_SYNC=1 CI=true git commit --no-verify -m "chore(sync): cascade fleet template@${TEMPLATE_SHA}" 2>&1 | tail -2; then
      RESULTS+=("${repo}|fail:commit")
      cd /tmp
      git -C "$src" worktree remove --force "$wt" 2>/dev/null
      git -C "$src" branch -D "$branch" 2>/dev/null
      continue
    fi
  fi

  if FLEET_SYNC=1 git push --no-verify origin "HEAD:$base" 2>&1 | tail -2; then
    RESULTS+=("${repo}|push:${base}")
  else
    if FLEET_SYNC=1 git push --no-verify -u origin "$branch" 2>&1 | tail -2; then
      pr_url=$(gh pr create --repo "SocketDev/${repo}" --base "$base" --head "$branch" --title "chore(sync): cascade fleet template@${TEMPLATE_SHA}" --body "Auto-cascade of socket-wheelhouse@${TEMPLATE_SHA}." 2>&1 | tail -1)
      RESULTS+=("${repo}|pr:${pr_url}")
    else
      RESULTS+=("${repo}|fail:push+pr")
    fi
  fi

  cd /tmp
  git -C "$src" worktree remove --force "$wt" 2>/dev/null
  git -C "$src" branch -D "$branch" 2>/dev/null
done < "$FLEET_REPOS_FILE"

echo
echo "════ RESULTS ════"
for entry in "${RESULTS[@]}"; do
  printf "  %s\n" "$entry"
done
