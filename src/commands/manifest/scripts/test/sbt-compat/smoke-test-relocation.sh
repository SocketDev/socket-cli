#!/usr/bin/env bash
# Run socket-facts.plugin.scala on the relocation fixture and assert a Maven relocation's target keeps
# the parent that declared the relocating module: the project itself (direct) or a build project it
# depends on, never a library that declares it with a scope it does not pass on. Coursier reports the
# target with a caller it leaves out of the report, and gives that caller its declared revision, here
# a version range; an override can move the target off the version the relocation names.
#
# Usage: smoke-test-relocation.sh <sbt-version> <scala-version> [coursier|ivy]   (ivy: sbt 1.x only)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SBT_VERSION="${1:?usage: smoke-test-relocation.sh <sbt-version> <scala-version>}"
SCALA_VERSION="${2:?usage: smoke-test-relocation.sh <sbt-version> <scala-version>}"
RESOLVER="${3:-coursier}"
PLUGIN="$HERE/../../socket-facts.plugin.scala"
PROJECT="$HERE/relocation"
RECORDS="$PROJECT/records.tsv"
# shellcheck source=SCRIPTDIR/../compat-cache.sh
. "$HERE/../compat-cache.sh"
IVY="$SOCKET_COMPAT_CACHE/ivy2"
export COURSIER_CACHE="$SOCKET_COMPAT_CACHE/coursier"

bash "$HERE/../make-stub-repo.sh" "$PROJECT/localrepo" \
  'demo.old:moved:1.0>demo.ext:moved:1.0' \
  'demo.ext:moved:1.0' \
  'demo.ext:moved:1.1' \
  'demo.ext:wrapper:1.0+demo.old:moved:1.0@test'
rm -rf "$IVY/cache/demo.ext" "$IVY/cache/demo.old"

GB="$(mktemp -d)/global-base"
mkdir -p "$GB/plugins"
cp "$PLUGIN" "$GB/plugins/SocketFactsPlugin.scala"
mkdir -p "$PROJECT/project"
echo "sbt.version=$SBT_VERSION" > "$PROJECT/project/build.properties"
echo "scalaVersion in ThisBuild := \"$SCALA_VERSION\"" > "$PROJECT/scala-version.sbt"
if [ "$RESOLVER" = ivy ]; then
  echo 'useCoursier in ThisBuild := false' >> "$PROJECT/scala-version.sbt"
fi
rm -rf "$RECORDS" "$PROJECT/target" "$PROJECT/project/target" "$PROJECT"/*/target

echo "+ sbt $SBT_VERSION (scala $SCALA_VERSION) (relocation, $RESOLVER)"
( cd "$PROJECT" && sbt -Dsbt.global.base="$GB" -Dsbt.server.autostart=false \
    -Dsbt.ivy.home="$IVY" -Dsocket.recordsFile="$RECORDS" --batch socketFacts )

python3 - "$RECORDS" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
root_of = {r[1]: (r[2], r[3]) for r in rows if r[0] == 'root'}
# Coursier leaves the relocating module out, so the target hangs under its declarer; Ivy keeps it as
# an artifact-less node between the two, which counts as the declarer's edge.
moved = {'core': 'demo.ext:moved:jar:1.0', 'app': 'demo.ext:moved:jar:1.1'}
relocating, wrapper = 'demo.old:moved:1.0', 'demo.ext:wrapper:jar:1.0'
errors = []
for rid, (project, config) in root_of.items():
    nodes = {r[2]: r for r in rows if r[0] == 'node' and r[1] == rid}
    target = moved.get(project)
    if target not in nodes:
        continue
    parents_of = lambda c: {r[2] for r in rows if r[0] == 'edge' and r[1] == rid and r[3] == c}
    parents, direct = parents_of(target), nodes[target][8] == '1'
    if relocating in parents:
        parents = (parents - {relocating}) | parents_of(relocating)
        direct = direct or nodes[relocating][8] == '1'
    if project == 'core' and not direct:
        errors.append(f"core/{config}: {target} not direct")
    if project == 'app' and parents != {'core'}:
        errors.append(f"app/{config}: {target} parents {sorted(parents)} != ['core']")
    if wrapper in parents:
        errors.append(f"{project}/{config}: {wrapper} made a parent of {target}")
for project, target in moved.items():
    if not any(r[0] == 'node' and r[2] == target and root_of[r[1]][0] == project for r in rows):
        errors.append(f"{target} missing from {project}")
if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print(f"PASS (relocation): demo.ext:moved direct in core, under core in app (overridden), never under {wrapper}")
PY

assemble_records "$RECORDS"
