#!/usr/bin/env bash
# --exclude-paths relative to the scan root (-Dsocket.excludeBase), one level above the build root:
# a subproject is excluded by its scan-root path, not its build-root one. sbt refuses projects
# outside the build root, so only the nested case exists.
#
# Usage: smoke-test-exclude-base.sh <sbt-version> <scala-version>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SBT_VERSION="${1:?usage: smoke-test-exclude-base.sh <sbt-version> <scala-version>}"
SCALA_VERSION="${2:?usage: smoke-test-exclude-base.sh <sbt-version> <scala-version>}"
PLUGIN="$HERE/../../socket-workspaces.plugin.scala"
SCAN_ROOT="$(cd "$HERE/exclude-base" && pwd -P)"
PROJECT="$SCAN_ROOT/app"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT" "$PROJECT/project" "$PROJECT/target" "$PROJECT/core" "$PROJECT/scala-version.sbt"' EXIT

mkdir -p "$OUT/global-base/plugins" "$PROJECT/project"
cp "$PLUGIN" "$OUT/global-base/plugins/SocketWorkspacesPlugin.scala"
echo "sbt.version=$SBT_VERSION" > "$PROJECT/project/build.properties"
echo "scalaVersion in ThisBuild := \"$SCALA_VERSION\"" > "$PROJECT/scala-version.sbt"

echo "+ sbt $SBT_VERSION (scala $SCALA_VERSION) (exclude base)"
projects() {
  ( cd "$PROJECT" && sbt -Dsbt.global.base="$OUT/global-base" -Dsbt.server.autostart=false \
      "-Dsocket.recordsFile=$OUT/records.tsv" \
      "-Dsocket.excludePaths=$1" "-Dsocket.excludeBase=$SCAN_ROOT" --batch socketWorkspaces >/dev/null )
  awk -F'\t' '$1 == "project" { print $2 }' "$OUT/records.tsv" | sort | tr '\n' ' '
}
check() {
  local got
  got="$(projects "$1")"
  if [ "$got" != "$2" ]; then
    echo "FAIL: excluding $1 kept [$got], want [$2]" >&2
    exit 1
  fi
}
check '^(?:app/core)(?:/.*)?$' 'root '
# Build-root-relative, so it names nothing under the scan root.
check '^(?:core)(?:/.*)?$' 'core root '
echo "PASS: subprojects are excluded by their scan-root paths"
