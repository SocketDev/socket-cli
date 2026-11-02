#!/usr/bin/env bash
# --exclude-paths relative to the scan root (-Psocket.excludeBase), one level above the build root:
# a project relocated outside the build root is excluded by its scan-root path, and a nested one
# by the build root's path in the scan root. A project outside the scan root is never excluded,
# even by a wildcard that would match its `../` path.
#
# Usage: smoke-test-exclude-base.sh /path/to/gradle
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GRADLE="${1:?usage: smoke-test-exclude-base.sh <path-to-gradle-binary>}"
INIT="$HERE/../../socket-workspaces.init.gradle"
SCAN_ROOT="$(cd "$HERE/exclude-base" && pwd -P)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT" "$SCAN_ROOT/app/.gradle"' EXIT

echo "+ $("$GRADLE" --version 2>/dev/null | sed -n 's/^Gradle //p' | head -1) (exclude base)"
projects() {
  rm -f "$OUT/records.tsv"
  ( cd "$SCAN_ROOT/app" && "$GRADLE" --no-daemon --offline -g "$OUT/gradle-home" \
      --init-script "$INIT" -Psocket.recordsFile="$OUT/records.tsv" \
      "-Psocket.excludePaths=$1" "-Psocket.excludeBase=${2:-$SCAN_ROOT}" socketWorkspaces -q >&2 )
  # A build that wrote no records keeps nothing, which check reports.
  [ -f "$OUT/records.tsv" ] || return 0
  awk -F'\t' '$1 == "project" { print $2 }' "$OUT/records.tsv" | sort | tr '\n' ' '
}
check() {
  local got
  got="$(projects "$1" "${3:-}")"
  if [ "$got" != "$2" ]; then
    echo "FAIL: excluding $1 from ${3:-$SCAN_ROOT} kept [$got], want [$2]" >&2
    exit 1
  fi
}
check '^(?:shared)(?:/.*)?$' ': :core '
check '^(?:app/core)(?:/.*)?$' ': :shared '
# `**/shared`, scanned from app: ../shared is outside the scan root.
check '^(?:(?:[^/]+/)*shared)(?:/.*)?$' ': :core :shared ' "$SCAN_ROOT/app"
echo "PASS: projects are excluded by their scan-root paths, never outside the scan root"
