#!/usr/bin/env bash
# Regression guard: a scope outside Maven 3's five must not drop the dependency or its subtree.
# Maven 3 puts the jar of a scope it does not know (`import`, or a typo, in <dependencies>) on every
# classpath, so it is prod. Maven 4's compile-only, test-only and test-runtime are dev, and its none
# is on no path: in the SBOM, but only in roots marked noClasspath.
#
# Usage: smoke-test-scopes.sh <path-to-mvn> <path-to-extension-jar>.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MVN="${1:?usage: smoke-test-scopes.sh <mvn> <extension-jar>}"
JAR="${2:?usage: smoke-test-scopes.sh <mvn> <extension-jar>}"
# shellcheck source=SCRIPTDIR/../compat-cache.sh
. "$HERE/../compat-cache.sh"
M2="$SOCKET_COMPAT_CACHE/m2"
VERSION="$("$MVN" -v 2>/dev/null | head -1)"

# $1: fixture; then one `artifact:prod:onClasspath[:extra]` expectation per direct dependency, each
# of which has a child `<artifact>-dep` expected alike, and, with `extra`, also that child.
check_fixture() {
  local project="$HERE/$1" records="$HERE/$1/records.tsv" specs=() expectation artifact
  shift
  for expectation in "$@"; do
    IFS=: read -r artifact _ _ extra <<<"$expectation"
    specs+=("demo.scopes:$artifact:1.0+demo.scopes:$artifact-dep:1.0${extra:+,demo.scopes:$extra:1.0}")
    specs+=("demo.scopes:$artifact-dep:1.0")
  done
  bash "$HERE/../make-stub-repo.sh" "$project/localrepo" "${specs[@]}" >/dev/null
  rm -rf "$M2/demo/scopes" "$records"
  ( cd "$project" && "$MVN" --batch-mode -q \
      "-Dmaven.ext.class.path=$JAR" \
      -Dcoana.task=socket-facts \
      "-Dmaven.repo.local=$M2" \
      "-Dstub.repo.url=file://$project/localrepo" \
      "-Dsocket.recordsFile=$records" \
      validate )
  python3 - "$records" "$@" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
prod_roots = {r[1] for r in rows if r[0] == 'root' and r[4] == '1'}
off_classpath = {r[1] for r in rows if r[0] == 'noClasspath'}
roots_of = {}
for r in rows:
    if r[0] == 'node':
        roots_of.setdefault(r[2].split(':')[1], set()).add(r[1])
edges = {(r[2].split(':')[1], r[3].split(':')[1]) for r in rows if r[0] == 'edge'}
errors = []
for expectation in sys.argv[2:]:
    artifact, prod, on_classpath, *extra = expectation.split(':')
    for child in [f'{artifact}-dep', *extra]:
        if (artifact, child) not in edges:
            errors.append(f"edge {artifact} -> {child} missing")
    for name in (artifact, f'{artifact}-dep'):
        roots = roots_of.get(name)
        if not roots:
            errors.append(f"{name} missing")
        elif bool(roots & prod_roots) != (prod == 'prod'):
            errors.append(f"{name} should be {prod}")
        elif bool(roots - off_classpath) != (on_classpath == 'classpath'):
            errors.append(f"{name} should be on {on_classpath}")
if errors:
    print("FAIL:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print(f"PASS (scopes): {', '.join(sys.argv[2:])}")
PY
}

echo "+ $VERSION (scopes)"
check_fixture unknown-scopes imported:prod:classpath mistyped:prod:classpath
case "$VERSION" in
  *"Maven 4."*)
    # none also depends on lib-dep, which lib keeps on the classpath.
    check_fixture maven4-scopes \
      compile-only:dev:classpath test-only:dev:classpath test-runtime:dev:classpath \
      none:dev:no-classpath:lib-dep lib:prod:classpath ;;
esac
