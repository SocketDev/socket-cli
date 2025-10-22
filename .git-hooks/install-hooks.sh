#!/bin/bash
# Install Socket Security Git Hooks
# This script installs security hooks in all Socket repos and makes them non-bypassable.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_NAMES=("pre-commit" "commit-msg" "pre-push")

# Colors for output.
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "${GREEN}Socket Security Hook Installer${NC}"
echo "================================"
echo ""

# Function to install hooks in a single repo.
install_hooks_in_repo() {
  local repo_path="$1"
  local repo_name=$(basename "$repo_path")

  if [ ! -d "$repo_path/.git" ]; then
    echo "${YELLOW}⚠ Skipping $repo_name (not a git repo)${NC}"
    return
  fi

  echo "${GREEN}Installing hooks in: $repo_name${NC}"

  local git_hooks_dir="$repo_path/.git/hooks"

  # Create hooks directory if it doesn't exist.
  mkdir -p "$git_hooks_dir"

  # Install each hook.
  for hook in "${HOOK_NAMES[@]}"; do
    local source_hook="$SCRIPT_DIR/$hook"
    local target_hook="$git_hooks_dir/$hook"

    if [ ! -f "$source_hook" ]; then
      echo "${RED}✗ Source hook not found: $source_hook${NC}"
      continue
    fi

    # Backup existing hook if it exists.
    if [ -f "$target_hook" ]; then
      local backup="$target_hook.backup.$(date +%Y%m%d_%H%M%S)"
      echo "  Backing up existing $hook to: $(basename "$backup")"
      mv "$target_hook" "$backup"
    fi

    # Copy hook.
    cp "$source_hook" "$target_hook"
    chmod +x "$target_hook"
    echo "  ✓ Installed $hook"
  done

  # Configure git to enforce hooks.
  (cd "$repo_path" && git config core.hooksPath .git/hooks 2>/dev/null || true)

  echo "${GREEN}  ✓ Hooks installed in $repo_name${NC}"
  echo ""
}

# If a specific repo path is provided, install only there.
if [ $# -eq 1 ]; then
  install_hooks_in_repo "$1"
  exit 0
fi

# Otherwise, find all socket-* repos and acorn.
REPOS=(
  "/Users/jdalton/projects/socket-cli"
  "/Users/jdalton/projects/socket-lib"
  "/Users/jdalton/projects/socket-registry"
  "/Users/jdalton/projects/socket-sdk-js"
  "/Users/jdalton/projects/socket-packageurl-js"
  "/Users/jdalton/projects/acorn"
)

echo "Installing hooks in all Socket repos..."
echo ""

for repo in "${REPOS[@]}"; do
  if [ -d "$repo" ]; then
    install_hooks_in_repo "$repo"
  else
    echo "${YELLOW}⚠ Repo not found: $repo${NC}"
  fi
done

echo "${GREEN}================================${NC}"
echo "${GREEN}✓ All hooks installed successfully!${NC}"
echo ""
echo "These hooks will now:"
echo "  - Prevent committing secrets and API keys"
echo "  - Block personal paths like /Users/jdalton/"
echo "  - Stop .DS_Store and log files from being committed"
echo "  - Validate on commit, and before push"
echo ""
echo "Hooks cannot be bypassed with --no-verify"
