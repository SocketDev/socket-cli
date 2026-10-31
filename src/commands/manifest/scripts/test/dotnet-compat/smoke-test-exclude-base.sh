#!/usr/bin/env bash
# --exclude-paths relative to the scan root (--exclude-base), one level above
# the build root: a `../shared` project outside the build root is excluded by
# its scan-root path, and a nested project by the build root's path in the scan
# root, both from the projects --workspaces follows and from the solution
# members --members lists.
#
# Usage: smoke-test-exclude-base.sh <dotnet> [sdk-version]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DOTNET="${1:?usage: smoke-test-exclude-base.sh <dotnet> [sdk-version]}"
SDK="${2:-}"
# shellcheck source=SCRIPTDIR/lib.sh
. "$HERE/lib.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
copy_fixture "$WORK" exclude-base
SCAN_ROOT="$(cd "$WORK/exclude-base" && pwd -P)"
pin_sdk "$SCAN_ROOT" "$SDK"
echo "+ dotnet SDK $SDK_VERSION (exclude base)"

# The project names --workspaces keeps, or the member paths --members lists.
kept() {
  local mode="$1" entry="$2" pattern="$3"
  run_tool "$SCAN_ROOT/app" --records "$WORK/records.tsv" --entry "$entry" \
    "--$mode" --exclude-paths "$pattern" --exclude-base "$SCAN_ROOT"
  if [ "$mode" = workspaces ]; then
    awk -F'\t' '$1 == "project" { print $4 }' "$WORK/records.tsv"
  else
    awk -F'\t' '$1 == "member" { print $2 }' "$WORK/records.tsv"
  fi | LC_ALL=C sort | tr '\n' ' '
}
check() {
  local got
  got="$(kept "$@")"
  if [ "$got" != "$4" ]; then
    echo "FAIL: --$1 of $2 excluding $3 kept [$got], want [$4]" >&2
    exit 1
  fi
}
check workspaces App.csproj '^(?:shared)(?:/.*)?$' 'App Core '
check workspaces App.csproj '^(?:app/core)(?:/.*)?$' 'App Shared '
# Build-root-relative, so it names nothing under the scan root.
check workspaces App.csproj '^(?:core)(?:/.*)?$' 'App Core Shared '
check members App.sln '^(?:shared)(?:/.*)?$' 'App.csproj core/Core.csproj '
check members App.sln '^(?:app/core)(?:/.*)?$' '../shared/Shared.csproj App.csproj '
check members App.sln '^(?:core)(?:/.*)?$' '../shared/Shared.csproj App.csproj core/Core.csproj '
echo "PASS: projects inside and outside the build root are excluded by their scan-root paths"
