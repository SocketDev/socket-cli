#!/usr/bin/env bash
# Regression guard: with the test scope excluded, a node is kept by its own scope, as Maven keeps it,
# and only a node reached solely through excluded ones (managed, deep) is linked to its nearest kept
# ancestors; shared and e keep just the parents Maven resolved. ranged keeps its edge from k2, though
# the excluded testlib's range picks its version.
#
# Usage: smoke-test-excluded-scope.sh <path-to-mvn> <path-to-extension-jar>.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MVN="${1:?usage: smoke-test-excluded-scope.sh <mvn> <extension-jar>}"
JAR="${2:?usage: smoke-test-excluded-scope.sh <mvn> <extension-jar>}"
PROJECT="$HERE/excluded-scope"
RECORDS="$PROJECT/records.tsv"
# shellcheck source=SCRIPTDIR/../compat-cache.sh
. "$HERE/../compat-cache.sh"
M2="$SOCKET_COMPAT_CACHE/m2"

bash "$HERE/../make-stub-repo.sh" "$PROJECT/localrepo" \
  'demo.excl:testlib:1.0+demo.excl:managed:1.0,demo.excl:testdep:1.0,demo.excl:shared:1.0,demo.excl:ranged:RANGE' \
  'demo.excl:managed:1.0' \
  'demo.excl:testdep:1.0' \
  'demo.excl:lib:1.0+demo.excl:mgd-test:1.0,demo.excl:shared:1.0,demo.excl:dtest:1.0' \
  'demo.excl:mgd-test:1.0+demo.excl:deep:1.0' \
  'demo.excl:deep:1.0' \
  'demo.excl:shared:1.0' \
  'demo.excl:dtest:1.0+demo.excl:e:1.0' \
  'demo.excl:k2:1.0+demo.excl:e:1.0,demo.excl:ranged:2.0' \
  'demo.excl:e:1.0' \
  'demo.excl:ranged:1.5' \
  'demo.excl:ranged:2.0' >/dev/null
# A range is a hard constraint whatever the scope declaring it (maven-resolver NearestVersionSelector;
# ConfigurableVersionSelector in 2.x), so Maven resolves ranged 1.5.
sed -i.bak 's|<version>RANGE</version>|<version>[1.0,1.5]</version>|' "$PROJECT/localrepo/demo/excl/testlib/1.0/testlib-1.0.pom"
rm -rf "$M2/demo/excl" "$RECORDS"
echo "+ $("$MVN" -v 2>/dev/null | head -1) (excluded scope)"
( cd "$PROJECT" && "$MVN" --batch-mode -q \
    "-Dmaven.ext.class.path=$JAR" \
    -Dcoana.task=socket-facts \
    "-Dmaven.repo.local=$M2" \
    "-Dstub.repo.url=file://$PROJECT/localrepo" \
    -Dsocket.excludeConfigs=test \
    "-Dsocket.recordsFile=$RECORDS" \
    validate )
python3 - "$RECORDS" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
prod_roots = {r[1] for r in rows if r[0] == 'root' and r[4] == '1'}
name = lambda coord: coord.split(':')[1]
nodes = {}
for r in rows:
    if r[0] == 'node':
        nodes.setdefault(name(r[2]), []).append(r)
parents = {}
for r in rows:
    if r[0] == 'edge':
        parents.setdefault(name(r[3]), set()).add(name(r[2]))
errors = []
for absent in ('testlib', 'testdep', 'mgd-test', 'dtest'):
    if absent in nodes:
        errors.append(f"{absent} is excluded but emitted")
for kept, direct in (('lib', True), ('k2', True), ('managed', True), ('deep', False), ('shared', False), ('e', False), ('ranged', False)):
    rs = nodes.get(kept)
    if not rs:
        errors.append(f"{kept} missing")
        continue
    if not any(r[1] in prod_roots for r in rs):
        errors.append(f"{kept} should be prod")
    if any((r[8] == '1') != direct for r in rs):
        errors.append(f"{kept} should {'' if direct else 'not '}be direct")
if any(r[5] != '1.5' for r in nodes.get('ranged', [])):
    errors.append(f"ranged should resolve 1.5, got {sorted({r[5] for r in nodes['ranged']})}")
for child, expected in (('deep', {'lib'}), ('shared', {'lib'}), ('e', {'k2'}), ('ranged', {'k2'})):
    if parents.get(child, set()) != expected:
        errors.append(f"{child} should have parents {sorted(expected)}, has {sorted(parents.get(child, set()))}")
if errors:
    print("FAIL:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("PASS (excluded scope): managed direct, lib -> deep, shared, e and ranged keep their kept parents")
PY
assemble_records "$RECORDS"
