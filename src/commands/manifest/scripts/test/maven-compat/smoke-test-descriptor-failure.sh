#!/usr/bin/env bash
# Regression guard for failures Maven's resolver hides from a plain resolution result:
# - A POM that failed once is cached build-wide, so a later module gets the dependency without an
#   error. It must still fail there, in that module's scope (broken: test in b, compile in a), but
#   not where a range resolved to another version (rebroken: 1.0 in b, [2.0,3.0) in a).
# - A missing POM is tolerated by Maven's default descriptor policy, losing the dependency's own
#   dependencies. It must fail; the dependency stays emitted with its jar (nopom), and one whose jar
#   is missing too gets no file (nothing).
# - A system-scope jar gets its file; a missing systemPath fails, under the full coordinate.
# - A failure absent from the graph fails in the scope it would have had: rangedchild under the
#   test-scoped testparent is test; before Maven 3.9 and on Maven 4 the position is unknown (no scope).
#   It is placed even when the collector met its parent first where that parent lost a conflict
#   (sharedchild), and a scope the module manages is kept, not derived (managedchild: compile).
# - A version-conflict loser (conflict 1.0) is on no classpath and must not fail; Maven 3.2 drops
#   a failed POM's node, so there it cannot be told apart and has no scope.
#
# Runs offline: the POMs are seeded straight into the local repository.
#
# Usage: smoke-test-descriptor-failure.sh <path-to-mvn> <path-to-extension-jar>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MVN="${1:?usage: smoke-test-descriptor-failure.sh <mvn> <extension-jar>}"
JAR="${2:?usage: smoke-test-descriptor-failure.sh <mvn> <extension-jar>}"
PROJECT="$HERE/descriptor-failure"
RECORDS="$PROJECT/records.tsv"
# shellcheck source=SCRIPTDIR/../compat-cache.sh
. "$HERE/../compat-cache.sh"
M2="$SOCKET_COMPAT_CACHE/m2"
REPO="$M2/demo/descfail"
SYS_DIR="$SOCKET_COMPAT_CACHE/descfail-sys"

pom() {
  # $1 artifactId, $2 version, $3 extra POM body.
  mkdir -p "$REPO/$1/$2"
  cat > "$REPO/$1/$2/$1-$2.pom" <<POM
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>demo.descfail</groupId>
  <artifactId>$1</artifactId>
  <version>$2</version>
  $3
</project>
POM
}

jar_for() {
  mkdir -p "$REPO/$1/$2/empty"
  ( cd "$REPO/$1/$2" && jar cf "$1-$2.jar" -C empty . && rm -r empty )
}

dep() {
  echo "<dependencies><dependency><groupId>demo.descfail</groupId><artifactId>$1</artifactId><version>$2</version></dependency></dependencies>"
}

rm -rf "$REPO" "$SYS_DIR"
pom ok 1.0 ''
jar_for ok 1.0
pom broken 1.0 '<parent><groupId>demo.descfail</groupId><artifactId>absent-parent</artifactId><version>1.0</version></parent>'
jar_for broken 1.0
jar_for nopom 1.0
pom testparent 1.0 "$(dep rangedchild '[5.0,6.0)')"
jar_for testparent 1.0
pom rebroken 1.0 '<parent><groupId>demo.descfail</groupId><artifactId>absent-parent</artifactId><version>1.0</version></parent>'
jar_for rebroken 1.0
pom rebroken 2.0 ''
jar_for rebroken 2.0
cat > "$REPO/rebroken/maven-metadata-local.xml" <<'XML'
<metadata>
  <groupId>demo.descfail</groupId>
  <artifactId>rebroken</artifactId>
  <versioning><versions><version>1.0</version><version>2.0</version></versions></versioning>
</metadata>
XML
pom conflict 2.0 ''
jar_for conflict 2.0
pom conflict 1.0 '<parent><groupId>demo.descfail</groupId><artifactId>absent-parent</artifactId><version>1.0</version></parent>'
pom loserparent 1.0 "$(dep conflict 1.0)"
jar_for loserparent 1.0
for parent in viaq:q q:shared nearb:shared; do
  pom "${parent%%:*}" 1.0 "$(dep "${parent#*:}" 1.0)"
  jar_for "${parent%%:*}" 1.0
done
pom shared 1.0 "$(dep sharedchild '[5.0,6.0)')"
jar_for shared 1.0
pom managedparent 1.0 "$(dep managedchild 1.0)"
jar_for managedparent 1.0
mkdir -p "$SYS_DIR/empty"
( cd "$SYS_DIR" && jar cf sys.jar -C empty . && rm -r empty )

run() {
  rm -f "$RECORDS"
  ( cd "$PROJECT" && "$MVN" --batch-mode -q -o \
      "-Dmaven.ext.class.path=$JAR" \
      -Dcoana.task=socket-facts \
      "-Dmaven.repo.local=$M2" \
      "-Ddescfail.sysDir=$SYS_DIR" \
      "-Dsocket.recordsFile=$RECORDS" \
      -Dsocket.withFiles=true \
      "$@" \
      validate )
}

# $1: whether test scope is scanned.
check() {
  python3 - "$RECORDS" "$1" "$STEPS" "$KEEPS_FAILED" <<'PY'
import sys
with_test, steps, keeps_failed = (a == 'true' for a in sys.argv[2:5])
a, b = 'demo:a:1.0', 'demo:b:1.0'
expected = {
    ('demo.descfail:broken:1.0', 'compile', a),
    ('demo.descfail:nopom:1.0', 'compile', a),
    ('demo.descfail:nothing:1.0', 'compile', a),
    ('demo.descfail:nothing:jar:1.0', 'compile', a),
    ('demo.descfail:sysmissing:jar:1.0', 'system', a),
}
if not keeps_failed:
    expected.add(('demo.descfail:conflict:1.0', '', a))
expected.add(('demo.descfail:rebroken:1.0', 'compile', b))
if with_test:
    expected.add(('demo.descfail:broken:1.0', 'test', b))
if with_test or not steps:
    expected.add(('demo.descfail:rangedchild:[5.0,6.0)', 'test' if steps else '', a))
expected.add(('demo.descfail:sharedchild:[5.0,6.0)', 'compile' if steps else '', a))
expected.add(('demo.descfail:managedchild:[7.0,8.0)', 'compile' if steps else '', a))
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
failures = [r[1:] for r in rows if r[0] == 'failure']
actual = {(f[0], f[2], f[3]) for f in failures}
nodes = {r[2] for r in rows if r[0] == 'node'}
files = {r[2] for r in rows if r[0] == 'file'}
unfetched = {r[2] for r in rows if r[0] == 'unfetched'}
unscannable = [r[1:] for r in rows if r[0] == 'unscannable']
errors = []
if actual != expected:
    errors.append(f"failures differ: missing={sorted(expected - actual)} unexpected={sorted(actual - expected)}")
for f in failures:
    if 'One or more requests failed' in f[1]:
        errors.append(f"{f[0]} reports the batch wrapper, not its cause: {f[1]!r}")
if any(n.startswith('demo.descfail:broken:') for n in nodes):
    errors.append(f"broken's POM failed, so it must not be emitted; nodes={sorted(nodes)}")
for coord in ('demo.descfail:ok:jar:1.0', 'demo.descfail:nopom:jar:1.0', 'demo.descfail:sys:jar:1.0',
              'demo.descfail:rebroken:jar:2.0'):
    if coord not in files:
        errors.append(f"{coord} must be emitted with its jar; files={sorted(files)}")
if unfetched != {'demo.descfail:nothing:jar:1.0', 'demo.descfail:sysmissing:jar:1.0'}:
    errors.append(f"only nothing's and sysmissing's jars are unfetched; unfetched={sorted(unfetched)}")
if any(f.startswith(('demo.descfail:nothing:', 'demo.descfail:sysmissing:')) for f in files):
    errors.append(f"a jar that is missing must get no file; files={sorted(files)}")
if unscannable:
    errors.append(f"every failure names its artifact, so nothing is unscannable: {unscannable}")
if errors:
    print("FAIL:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print(f"PASS (descriptor failure): {len(actual)} failure(s)")
PY
}

VERSION="$("$MVN" -v 2>/dev/null | head -1)"
echo "+ $VERSION (descriptor failure)"
case "$VERSION" in
  *"Maven 3.2."*) STEPS=false; KEEPS_FAILED=false ;;
  *"Maven 3.9."*) STEPS=true; KEEPS_FAILED=true ;;
  *) STEPS=false; KEEPS_FAILED=true ;;
esac

run
check true
run -Dsocket.excludeConfigs=test
check false
