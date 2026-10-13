#!/usr/bin/env bash
# Load the Coana Maven workspaces participant (CoanaWorkspacesLifecycleParticipant, the lightweight
# sibling of the facts participant) on a given Maven binary and assert it emits exactly the
# expected reactor project records - no dependency graph at all. Guards, across the same Maven
# compat matrix as the facts extension, that the participant registers and fires correctly.
#
# Usage: smoke-test-workspaces.sh <path-to-mvn> <path-to-extension-jar>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MVN="${1:?usage: smoke-test-workspaces.sh <mvn> <extension-jar>}"
JAR="${2:?usage: smoke-test-workspaces.sh <mvn> <extension-jar>}"
PROJECT="$HERE/project"
RECORDS="$PROJECT/workspaces-records.tsv"

rm -rf "$RECORDS" "$PROJECT"/*/target "$PROJECT"/target

echo "+ $("$MVN" -v 2>/dev/null | head -1) (workspaces)"
( cd "$PROJECT" && "$MVN" --batch-mode -q \
    "-Dmaven.ext.class.path=$JAR" \
    -Dcoana.task=socket-workspaces \
    "-Dsocket.recordsFile=$RECORDS" \
    validate )

python3 - "$RECORDS" "$(cd "$PROJECT" && pwd -P)" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
errors = []
tool = None
build_root = None
projects = {}
build_files = set()
for r in rows:
    if r[0] == 'meta':
        tool = r[1]
    elif r[0] == 'buildRoot':
        build_root = r[1]
    elif r[0] == 'project':
        projects[r[3]] = r  # keyed by artifactId
    elif r[0] == 'projectBuild':
        build_files.add(r[2])
    else:
        errors.append(f"unexpected record kind {r[0]!r} - workspaces must never resolve dependencies")

if tool != 'maven':
    errors.append(f"meta tool {tool!r} != 'maven'")
if build_root != sys.argv[2]:
    errors.append(f"buildRoot {build_root!r} != {sys.argv[2]!r}")
expected_build_files = {'pom.xml', 'lib/pom.xml', 'app/pom.xml'}
if build_files != expected_build_files:
    errors.append(f"projectBuild files {sorted(build_files)} != {sorted(expected_build_files)}")
expected = {'root', 'lib', 'app'}
if set(projects) != expected:
    errors.append(f"expected reactor modules {sorted(expected)}, got {sorted(projects)}")
for artifact in expected & set(projects):
    group = projects[artifact][2]
    if group != 'demo':
        errors.append(f"{artifact} group {group!r} != 'demo'")

if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print(f"PASS: tool=maven; reactor modules {sorted(projects)}, no dependency-resolution records")
PY
