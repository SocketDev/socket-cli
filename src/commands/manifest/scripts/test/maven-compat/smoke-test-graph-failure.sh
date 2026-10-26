#!/usr/bin/env bash
# Regression guard: a dependency that fails while Maven collects the graph must be reported as that
# dependency, in the module it was collected for, and never emitted as a node. It fails in its own
# scope, and an excluded scope drops it; one the graph lacks (an unsatisfiable range, or a failed POM
# on Maven 3.2) fails in the scope it is declared with. The module itself must never be reported as
# the failure. Under --with-files, every healthy dependency must still get its file, and a jar that
# cannot be fetched is reported under its full coordinate, with the cause rather than a wrapper.
#
# Runs offline: the POMs are seeded straight into the local repository, so their missing parent and
# the absent versions of ranged can only fail to resolve.
#
# Usage: smoke-test-graph-failure.sh <path-to-mvn> <path-to-extension-jar>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MVN="${1:?usage: smoke-test-graph-failure.sh <mvn> <extension-jar>}"
JAR="${2:?usage: smoke-test-graph-failure.sh <mvn> <extension-jar>}"
PROJECT="$HERE/graph-failure"
RECORDS="$PROJECT/records.tsv"
# shellcheck source=SCRIPTDIR/../compat-cache.sh
. "$HERE/../compat-cache.sh"
M2="$SOCKET_COMPAT_CACHE/m2"

rm -rf "$M2/demo/graphfail"
for lib in lib testlib; do
  mkdir -p "$M2/demo/graphfail/$lib/1.0"
  cat > "$M2/demo/graphfail/$lib/1.0/$lib-1.0.pom" <<POM
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>demo.graphfail</groupId>
    <artifactId>lib-parent</artifactId>
    <version>1.0</version>
  </parent>
  <artifactId>$lib</artifactId>
</project>
POM
done
for lib in ok nojar; do
  mkdir -p "$M2/demo/graphfail/$lib/1.0"
  cat > "$M2/demo/graphfail/$lib/1.0/$lib-1.0.pom" <<POM
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>demo.graphfail</groupId>
  <artifactId>$lib</artifactId>
  <version>1.0</version>
</project>
POM
done
( cd "$M2/demo/graphfail/ok/1.0" && mkdir -p empty && jar cf ok-1.0.jar -C empty . && rm -r empty )

run() {
  rm -f "$RECORDS"
  ( cd "$PROJECT" && "$MVN" --batch-mode -q -o \
      "-Dmaven.ext.class.path=$JAR" \
      -Dcoana.task=socket-facts \
      "-Dmaven.repo.local=$M2" \
      "-Dsocket.recordsFile=$RECORDS" \
      "$@" \
      validate )
}

# $1: expected scope per coord (null: excluded).
check() {
  python3 - "$RECORDS" "$1" <<'PY'
import json, sys
def read(path):
    return [l.rstrip('\n').split('\t') for l in open(path) if l.strip()]
rows = read(sys.argv[1])
expected = json.loads(sys.argv[2])
emitted = {f"{r[3]}:{r[4]}:{r[5]}" for r in rows if r[0] == 'node'}
errors = []
if 'demo.graphfail:ok:1.0' not in emitted:
    errors.append(f"ok resolved, so it must be emitted; nodes={sorted(emitted)}")
failures = [r[1:] for r in rows if r[0] == 'failure']
unscannable = [r[1:] for r in rows if r[0] == 'unscannable']
module = 'demo:graph-failure:1.0'

for coord, scope in expected.items():
    found = [f for f in failures if f[0] == coord]
    if coord in emitted:
        errors.append(f"{coord} failed to resolve, so it must not be emitted as a node")
    if scope is None:
        if found:
            errors.append(f"{coord} is in an excluded scope and must not be reported, got {found}")
    elif not found:
        errors.append(f"{coord} emitted no failure record; failures={failures}")
    elif any(f[2] != scope or f[3] != module for f in found):
        errors.append(f"{coord} should fail in scope {scope!r} of {module}, got {found}")
invented = [f for f in failures if f[0] == module]
if invented:
    errors.append(f"the module itself must not be reported as the unresolved dependency: {invented}")
if unscannable:
    errors.append(f"each collection error names its artifact, so nothing is unscannable: {unscannable}")

if errors:
    print("FAIL:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print(f"PASS (graph failure): {expected}")
PY
}

check_files() {
  python3 - "$RECORDS" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
files = {r[2] for r in rows if r[0] == 'file'}
failures = {(r[1], r[3]) for r in rows if r[0] == 'failure'}
details = {r[2] for r in rows if r[0] == 'failure' and r[1] == 'demo.graphfail:nojar:jar:1.0'}
unfetched = {r[2] for r in rows if r[0] == 'unfetched'}
errors = []
if 'demo.graphfail:ok:jar:1.0' not in files:
    errors.append(f"ok resolved, so its jar must be materialized despite the collection errors; files={sorted(files)}")
if ('demo.graphfail:nojar:jar:1.0', 'compile') not in failures:
    errors.append(f"nojar's jar cannot be fetched, so it must be reported; failures={sorted(failures)}")
if any('One or more requests failed' in d for d in details):
    errors.append(f"nojar's failure must give the cause, not the batch wrapper; details={sorted(details)}")
if unfetched != {'demo.graphfail:nojar:jar:1.0'}:
    errors.append(f"only nojar's jar is unfetched; unfetched={sorted(unfetched)}")
if errors:
    print("FAIL:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("PASS (graph failure, with files)")
PY
}

VERSION="$("$MVN" -v 2>/dev/null | head -1)"
echo "+ $VERSION (graph failure)"
run
check '{"demo.graphfail:lib:1.0": "compile", "demo.graphfail:testlib:1.0": "test", "demo.graphfail:ranged:[1.0,2.0)": "compile"}'
run -Dsocket.excludeConfigs=test
check '{"demo.graphfail:lib:1.0": "compile", "demo.graphfail:testlib:1.0": null, "demo.graphfail:ranged:[1.0,2.0)": "compile"}'
run -Dsocket.withFiles=true
check '{"demo.graphfail:lib:1.0": "compile", "demo.graphfail:testlib:1.0": "test", "demo.graphfail:ranged:[1.0,2.0)": "compile"}'
check_files
