#!/usr/bin/env bash
# Regression guard: an unresolvable dependency must be reported, never emitted, and must not take the
# rest of the project down with it. ok must still be emitted; every module named in a failure record
# must be absent from the nodes. Which modules sbt names depends on its resolver: Ivy (sbt 0.13) names
# the declared dependencies whose parent POM is missing (lib, testlib), coursier (sbt 1.3+) names the
# missing parent POM itself; both name ghost. Each failure's detail is its own module's message.
#
# Usage: smoke-test-failure.sh <sbt-version> <scala-version>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SBT_VERSION="${1:?usage: smoke-test-failure.sh <sbt-version> <scala-version>}"
SCALA_VERSION="${2:?usage: smoke-test-failure.sh <sbt-version> <scala-version>}"
PLUGIN="$HERE/../../socket-facts.plugin.scala"
PROJECT="$HERE/failure"
RECORDS="$PROJECT/records.tsv"
REPO="$PROJECT/localrepo"
# shellcheck source=SCRIPTDIR/../compat-cache.sh
. "$HERE/../compat-cache.sh"
IVY="$SOCKET_COMPAT_CACHE/ivy2"
export COURSIER_CACHE="$SOCKET_COMPAT_CACHE/coursier"

bash "$HERE/../make-stub-repo.sh" "$REPO" 'demo.fail:ok:1.0'
for lib in lib testlib; do
  mkdir -p "$REPO/demo/fail/$lib/1.0"
  cat > "$REPO/demo/fail/$lib/1.0/$lib-1.0.pom" <<POM
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>demo.fail</groupId>
    <artifactId>missing-parent</artifactId>
    <version>1.0</version>
  </parent>
  <artifactId>$lib</artifactId>
</project>
POM
done
rm -rf "$IVY/cache/demo.fail"

GB="$(mktemp -d)/global-base"
mkdir -p "$GB/plugins"
cp "$PLUGIN" "$GB/plugins/SocketFactsPlugin.scala"

mkdir -p "$PROJECT/project"
echo "sbt.version=$SBT_VERSION" > "$PROJECT/project/build.properties"
echo "scalaVersion in ThisBuild := \"$SCALA_VERSION\"" > "$PROJECT/scala-version.sbt"
rm -rf "$RECORDS" "$PROJECT/target" "$PROJECT/project/target"

echo "+ sbt $SBT_VERSION (scala $SCALA_VERSION) (failure)"
( cd "$PROJECT" && sbt -Dsbt.global.base="$GB" -Dsbt.server.autostart=false \
    -Dsbt.ivy.home="$IVY" \
    -Dsocket.recordsFile="$RECORDS" --batch socketFacts )

python3 - "$RECORDS" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
nodes = {f"{r[3]}:{r[4]}:{r[5]}" for r in rows if r[0] == 'node'}
failure_rows = [r for r in rows if r[0] == 'failure']
failed = {r[1] for r in failure_rows}
unscannable = [r[1:] for r in rows if r[0] == 'unscannable']
errors = []

if 'demo.fail:ok:1.0' not in nodes:
    errors.append(f"ok resolved, so it must be emitted; nodes={sorted(nodes)}")
if 'demo.fail:ghost:1.0' not in failed:
    errors.append(f"ghost does not exist, so it must be reported; failures={sorted(failed)}")
if not ({'demo.fail:lib:1.0', 'demo.fail:testlib:1.0'} <= failed or 'demo.fail:missing-parent:1.0' in failed):
    errors.append(f"neither lib/testlib nor their missing parent was reported; failures={sorted(failed)}")
emitted = failed & nodes
if emitted:
    errors.append(f"reported failures must not be emitted as nodes: {sorted(emitted)}")
# Each failure carries its own module's message, not the whole batch.
for r in failure_rows:
    for other in failed - {r[1]}:
        org, name, rev = other.split(':')
        if any(k in r[2] for k in (f"{org}:{name}:{rev}", f"{org}#{name};{rev}", f"/{name}/{rev}/")):
            errors.append(f"{r[1]}'s detail also describes {other}: {r[2][:200]}")
if unscannable:
    errors.append(f"the failures name their modules, so the project must not be unscannable: {unscannable}")

if errors:
    print("FAIL:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print(f"PASS (failure): reported {sorted(failed)}; ok still emitted")
PY
