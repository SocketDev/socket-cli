#!/usr/bin/env bash
# Run socket-workspaces.plugin.scala (the lightweight workspace-enumeration sibling of
# socket-facts.plugin.scala) against the smoke project on a given sbt version and assert it emits
# exactly the expected project record - no dependency resolution at all. Guards, across the same
# sbt/scala compat matrix as the facts plugin, that SocketWorkspacesPlugin registers and runs.
#
# The plugin is activated exactly as run.ts does it: dropped into a fresh sbt global base's plugins/.
# Usage: smoke-test-workspaces.sh <sbt-version> <scala-version>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SBT_VERSION="${1:?usage: smoke-test-workspaces.sh <sbt-version> <scala-version>}"
SCALA_VERSION="${2:?usage: smoke-test-workspaces.sh <sbt-version> <scala-version>}"
PLUGIN="$HERE/../../socket-workspaces.plugin.scala"
PROJECT="$HERE/project"
RECORDS="$PROJECT/workspaces-records.tsv"

GB="$(mktemp -d)/global-base"
mkdir -p "$GB/plugins"
cp "$PLUGIN" "$GB/plugins/SocketWorkspacesPlugin.scala"

# Pin the sbt + scala versions for this matrix entry (the launcher downloads the sbt version).
# `project/` (the meta-build dir) is an empty dir in git, so it's absent on a fresh checkout.
mkdir -p "$PROJECT/project"
echo "sbt.version=$SBT_VERSION" > "$PROJECT/project/build.properties"
echo "scalaVersion in ThisBuild := \"$SCALA_VERSION\"" > "$PROJECT/scala-version.sbt"
rm -rf "$RECORDS" "$PROJECT/target" "$PROJECT/project/target"

echo "+ sbt $SBT_VERSION (scala $SCALA_VERSION) (workspaces)"
( cd "$PROJECT" && sbt -Dsbt.global.base="$GB" -Dsbt.server.autostart=false \
    -Dsocket.recordsFile="$RECORDS" --batch socketWorkspaces )

python3 - "$RECORDS" "$SCALA_VERSION" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
# CrossVersion.apply appends _<binary-version> (major.minor) to the artifact name - the same
# identity computation socket-facts.plugin.scala's rootIdOf already does, so this isn't optional.
binary_version = '.'.join(sys.argv[2].split('.')[:2])
expected_name = f"sbt-compat-smoke_{binary_version}"
errors = []
tool = None
projects = []
for r in rows:
    if r[0] == 'meta':
        tool = r[1]
    elif r[0] == 'project':
        projects.append(r)
    else:
        errors.append(f"unexpected record kind {r[0]!r} - workspaces must never resolve dependencies")

if tool != 'sbt':
    errors.append(f"meta tool {tool!r} != 'sbt'")
if len(projects) != 1:
    errors.append(f"expected exactly 1 project record, got {len(projects)}: {projects}")
else:
    _, _ref, org, name, _ver, dir_ = projects[0]
    if org != 'demo': errors.append(f"root project org {org!r} != 'demo'")
    if name != expected_name: errors.append(f"root project name {name!r} != {expected_name!r}")
    if dir_ != '.': errors.append(f"root project dir {dir_!r} != '.'")

if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print("PASS: tool=sbt; 1 project record, no dependency-resolution records")
PY
