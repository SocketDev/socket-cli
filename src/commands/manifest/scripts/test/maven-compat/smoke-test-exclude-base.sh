#!/usr/bin/env bash
# --exclude-paths relative to the scan root (-Dsocket.excludeBase), one level above the build root:
# a `<module>../shared</module>` outside the build root is excluded by its scan-root path, and a
# nested module by the build root's path in the scan root.
#
# Usage: smoke-test-exclude-base.sh <path-to-mvn> <path-to-extension-jar>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MVN="${1:?usage: smoke-test-exclude-base.sh <mvn> <extension-jar>}"
JAR="${2:?usage: smoke-test-exclude-base.sh <mvn> <extension-jar>}"
SCAN_ROOT="$(cd "$HERE/exclude-base" && pwd -P)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT" "$SCAN_ROOT"/app/target "$SCAN_ROOT"/app/core/target "$SCAN_ROOT"/shared/target' EXIT

echo "+ $("$MVN" -v 2>/dev/null | head -1) (exclude base)"
modules() {
  ( cd "$SCAN_ROOT/app" && "$MVN" --batch-mode -q \
      "-Dmaven.ext.class.path=$JAR" \
      -Dcoana.task=socket-workspaces \
      "-Dsocket.recordsFile=$OUT/records.tsv" \
      "-Dsocket.excludePaths=$1" "-Dsocket.excludeBase=$SCAN_ROOT" \
      validate >/dev/null )
  awk -F'\t' '$1 == "project" { print $4 }' "$OUT/records.tsv" | sort | tr '\n' ' '
}
check() {
  local got
  got="$(modules "$1")"
  if [ "$got" != "$2" ]; then
    echo "FAIL: excluding $1 kept [$got], want [$2]" >&2
    exit 1
  fi
}
check '^(?:shared)(?:/.*)?$' 'app core '
check '^(?:app/core)(?:/.*)?$' 'app shared '
echo "PASS: modules inside and outside the build root are excluded by their scan-root paths"
