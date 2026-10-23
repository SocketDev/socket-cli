#!/usr/bin/env bash
# Regression guard: an unresolvable dependency must be reported, never emitted, and must not take the
# rest of the project down with it. ok must still be emitted; every module named in a failure record
# must be absent from the nodes. Which modules sbt names depends on its resolver: Ivy (sbt 0.13) names
# the declared dependencies whose parent POM is missing (lib, testlib), coursier (sbt 1.3+) names the
# missing parent POM itself; both name ghost. Each failure's detail is its own module's message.
#
# A second run with files: a jar that cannot be fetched (nojar; lib/testlib's under coursier; ok's
# tests classifier, test-scoped) must be reported and marked `unfetched` under its full coordinate,
# in the configurations that requested it, while pomonly (and under coursier doctype, whose POM
# declares a DOCTYPE) stays an artifactless module and pkwar keeps its war. Coursier's update report gives no cause for a
# missing artifact, so none is claimed for it. Coursier skips a missing jar silently and lists one for every Maven module whatever its
# packaging; Ivy's own resolution report names what it failed to download.
#
# Then ../artifact-failure, whose only failure is ok's missing tests jar, without and with files: an
# artifact failure names no module, yet sbt's update fails on it, so it must be reported in both runs
# and must not make core or its dependent app unscannable.
#
# Usage: smoke-test-failure.sh <sbt-version> <scala-version> [coursier|ivy]   (ivy: sbt 1.x only)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SBT_VERSION="${1:?usage: smoke-test-failure.sh <sbt-version> <scala-version>}"
SCALA_VERSION="${2:?usage: smoke-test-failure.sh <sbt-version> <scala-version>}"
RESOLVER="${3:-coursier}"
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
mkdir -p "$REPO/demo/fail/nojar/1.0" "$REPO/demo/fail/pomonly/1.0" "$REPO/demo/fail/pkwar/1.0" "$REPO/demo/fail/doctype/1.0"
cat > "$REPO/demo/fail/pkwar/1.0/pkwar-1.0.pom" <<'POM'
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>demo.fail</groupId>
  <artifactId>pkwar</artifactId>
  <version>1.0</version>
  <packaging>war</packaging>
</project>
POM
cp "$REPO/demo/fail/ok/1.0/ok-1.0.jar" "$REPO/demo/fail/pkwar/1.0/pkwar-1.0.war"
cat > "$REPO/demo/fail/nojar/1.0/nojar-1.0.pom" <<'POM'
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>demo.fail</groupId>
  <artifactId>nojar</artifactId>
  <version>1.0</version>
</project>
POM
cat > "$REPO/demo/fail/pomonly/1.0/pomonly-1.0.pom" <<'POM'
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>demo.fail</groupId>
  <artifactId>pomonly</artifactId>
  <version>1.0</version>
  <packaging>pom</packaging>
</project>
POM
cat > "$REPO/demo/fail/doctype/1.0/doctype-1.0.pom" <<'POM'
<?xml version="1.0"?>
<!DOCTYPE project>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>demo.fail</groupId>
  <artifactId>doctype</artifactId>
  <version>1.0</version>
  <packaging>pom</packaging>
</project>
POM
rm -rf "$IVY/cache/demo.fail"

GB="$(mktemp -d)/global-base"
mkdir -p "$GB/plugins"
cp "$PLUGIN" "$GB/plugins/SocketFactsPlugin.scala"

mkdir -p "$PROJECT/project"
echo "sbt.version=$SBT_VERSION" > "$PROJECT/project/build.properties"
echo "scalaVersion in ThisBuild := \"$SCALA_VERSION\"" > "$PROJECT/scala-version.sbt"
if [ "$RESOLVER" = ivy ]; then
  echo 'useCoursier in ThisBuild := false' >> "$PROJECT/scala-version.sbt"
fi
rm -rf "$RECORDS" "$PROJECT/target" "$PROJECT/project/target"

run() {
  local dir="$1"
  shift
  ( cd "$dir" && sbt -Dsbt.global.base="$GB" -Dsbt.server.autostart=false \
      -Dsbt.ivy.home="$IVY" "$@" --batch socketFacts )
}

echo "+ sbt $SBT_VERSION (scala $SCALA_VERSION) (failure)"
run "$PROJECT" -Dsocket.recordsFile="$RECORDS"

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

rm -rf "$RECORDS" "$PROJECT/target" "$PROJECT/project/target"
echo "+ sbt $SBT_VERSION (scala $SCALA_VERSION) (failure, with files)"
run "$PROJECT" -Dsocket.withFiles=true -Dsocket.recordsFile="$RECORDS"

IVY_RESOLVER=false
if [ "$RESOLVER" = ivy ] || [ "${SBT_VERSION%%.*}" = 0 ]; then
  IVY_RESOLVER=true
fi
python3 - "$RECORDS" "$IVY_RESOLVER" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
ivy = sys.argv[2] == 'true'
nodes = {r[2]: r for r in rows if r[0] == 'node'}
unfetched = {r[2] for r in rows if r[0] == 'unfetched'}
failed = {r[1] for r in rows if r[0] == 'failure'}
config_of = {r[1]: r[3] for r in rows if r[0] == 'root'}
unfetched_configs = {(r[2], config_of[r[1]]) for r in rows if r[0] == 'unfetched'}
files = {r[2] for r in rows if r[0] == 'file'}
errors = []

if 'demo.fail:pomonly:1.0' not in nodes:
    errors.append(f"pomonly is pom-packaged, so it must be emitted without an artifact; nodes={sorted(nodes)}")
# Ivy's POM reader declares a DOCTYPE of its own, so it fails on doctype's; coursier reads it.
if ivy and 'demo.fail:doctype:1.0' not in failed:
    errors.append(f"Ivy cannot read doctype's POM, so it must be reported; failures={sorted(failed)}")
for name in ('pomonly',) if ivy else ('pomonly', 'doctype'):
    if f'demo.fail:{name}:1.0' not in nodes:
        errors.append(f"{name} is pom-packaged, so it must be emitted without an artifact; nodes={sorted(nodes)}")
    if any(name in u for u in unfetched) or f'demo.fail:{name}:1.0' in failed:
        errors.append(f"{name} has no jar to fetch; unfetched={sorted(unfetched)} failures={sorted(failed)}")
for name in ('nojar', 'ok'):
    if f'demo.fail:{name}:1.0' not in failed:
        errors.append(f"{name}'s jar cannot be fetched, so it must be reported; failures={sorted(failed)}")
if 'demo.fail:nojar:jar:1.0' not in unfetched:
    errors.append(f"nojar must be emitted as an unfetched jar; unfetched={sorted(unfetched)}")
if 'demo.fail:ok:jar:1.0' not in files:
    errors.append("ok's own jar resolved, so its missing tests jar must not cost it its file")
tests_configs = {c for (u, c) in unfetched_configs if u == 'demo.fail:ok:jar:tests:1.0'}
if not tests_configs or any('test' not in c.lower() for c in tests_configs):
    errors.append(f"ok's tests jar is requested only in Test, so only test configs may miss it: {sorted(tests_configs)}")
for name in ('nojar', 'lib', 'testlib'):
    if f'demo.fail:{name}:1.0' in nodes:
        errors.append(f"{name} has a jar-packaged POM, so it must not look artifactless")
    if f'demo.fail:{name}:jar:1.0' in nodes and f'demo.fail:{name}:jar:1.0' not in unfetched:
        errors.append(f"{name} is emitted without its jar, so it must be marked unfetched; unfetched={sorted(unfetched)}")
if 'demo.fail:pkwar:war:1.0' not in files:
    errors.append(f"pkwar's war resolved, so it must keep its file; nodes={sorted(n for n in nodes if 'pkwar' in n)}")
if any('pkwar' in f for f in failed):
    errors.append(f"pkwar's packaging is war, so a missing jar is expected; failures={sorted(failed)}")
details = [r[2] for r in rows if r[0] == 'failure' and r[1] == 'demo.fail:nojar:1.0']
# Ivy's report names the cause; coursier's update report does not, so none may be claimed.
expected_cause = 'not found' if ivy else 'could not be fetched'
if len(set(details)) != 1 or expected_cause not in details[0]:
    errors.append(f"nojar's jar is absent, so it must be reported once as {expected_cause!r}: {sorted(set(details))}")
stray = unfetched - {f'demo.fail:{n}:jar:1.0' for n in ('nojar', 'lib', 'testlib')} - {'demo.fail:ok:jar:tests:1.0'}
if stray:
    errors.append(f"only the jars that are missing may be unfetched: {sorted(stray)}")

if errors:
    print("FAIL:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print(f"PASS (failure, with files): unfetched {sorted(unfetched)}; pomonly artifactless")
PY

ARTIFACT="$HERE/artifact-failure"
mkdir -p "$ARTIFACT/project"
echo "sbt.version=$SBT_VERSION" > "$ARTIFACT/project/build.properties"
cp "$PROJECT/scala-version.sbt" "$ARTIFACT/scala-version.sbt"
rm -rf "$ARTIFACT/records.tsv" "$ARTIFACT/target" "$ARTIFACT"/*/target "$ARTIFACT/project/target"
echo "+ sbt $SBT_VERSION (scala $SCALA_VERSION) (artifact failure)"
run "$ARTIFACT" -Dsocket.recordsFile="$ARTIFACT/records.tsv"

python3 - "$ARTIFACT/records.tsv" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
unscannable = [r[1:] for r in rows if r[0] == 'unscannable']
failed = {r[1] for r in rows if r[0] == 'failure'}
errors = []
if unscannable:
    errors.append(f"a missing artifact names no module, but must not make a project unscannable: {unscannable}")
if failed != {'demo.fail:ok:1.0'}:
    errors.append(f"sbt's update fails on ok's missing tests jar, so it must be reported without files too; failures={sorted(failed)}")
if errors:
    print("FAIL:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("PASS (artifact failure): ok's missing tests jar reported without files")
PY

rm -rf "$ARTIFACT/records.tsv"
echo "+ sbt $SBT_VERSION (scala $SCALA_VERSION) (artifact failure, with files)"
run "$ARTIFACT" -Dsocket.withFiles=true -Dsocket.recordsFile="$ARTIFACT/records.tsv"

python3 - "$ARTIFACT/records.tsv" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
unscannable = [r[1:] for r in rows if r[0] == 'unscannable']
project_of = {r[1]: r[2] for r in rows if r[0] == 'root'}
unfetched_by = {}
for r in rows:
    if r[0] == 'unfetched':
        unfetched_by.setdefault(project_of[r[1]], set()).add(r[2])
failed = {r[1] for r in rows if r[0] == 'failure'}
errors = []
if unscannable:
    errors.append(f"a missing artifact names no module, but must not make a project unscannable: {unscannable}")
for p in ('core', 'app'):
    if unfetched_by.get(p) != {'demo.fail:ok:jar:tests:1.0'}:
        errors.append(f"{p} reaches ok's missing tests jar, so only it may be unfetched: {sorted(unfetched_by.get(p, ()))}")
if failed != {'demo.fail:ok:1.0'}:
    errors.append(f"only ok's tests jar is missing; failures={sorted(failed)}")
if errors:
    print("FAIL:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("PASS (artifact failure, with files): ok's tests jar unfetched in core and app; nothing unscannable")
PY
