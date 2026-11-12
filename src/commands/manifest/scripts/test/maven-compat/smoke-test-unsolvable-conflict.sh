#!/usr/bin/env bash
# Regression guard: when Maven's conflict resolution throws (hard version ranges no version
# satisfies), Maven resolves no graph for the module. It must be reported unscannable and none of its
# collected dependencies emitted or fetched, however their scopes were left mid-resolution.
#
# Usage: smoke-test-unsolvable-conflict.sh <path-to-mvn> <path-to-extension-jar>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MVN="${1:?usage: smoke-test-unsolvable-conflict.sh <mvn> <extension-jar>}"
JAR="${2:?usage: smoke-test-unsolvable-conflict.sh <mvn> <extension-jar>}"
PROJECT="$HERE/unsolvable-conflict"
RECORDS="$PROJECT/records.tsv"
STUBS="$PROJECT/localrepo"
# shellcheck source=SCRIPTDIR/../compat-cache.sh
. "$HERE/../compat-cache.sh"
M2="$SOCKET_COMPAT_CACHE/m2"

bash "$HERE/../make-stub-repo.sh" "$STUBS" \
  'demo.unsolvable:left:1.0+demo.unsolvable:shared:[1.0]' \
  'demo.unsolvable:right:1.0+demo.unsolvable:shared:[2.0]' \
  'demo.unsolvable:harness:1.0+demo.unsolvable:harness-core:1.0' \
  'demo.unsolvable:harness-core:1.0' \
  'demo.unsolvable:shared:1.0' \
  'demo.unsolvable:shared:2.0'
rm -rf "$M2/demo/unsolvable" "$RECORDS"

echo "+ $("$MVN" -v 2>/dev/null | head -1) (unsolvable conflict)"
( cd "$PROJECT" && "$MVN" --batch-mode -q \
    "-Dmaven.ext.class.path=$JAR" \
    -Dcoana.task=socket-facts \
    -Dsocket.withFiles=true \
    "-Dmaven.repo.local=$M2" \
    "-Dstub.repo.url=file://$STUBS" \
    "-Dsocket.recordsFile=$RECORDS" \
    validate )

python3 - "$RECORDS" "$M2/demo/unsolvable" <<'PY'
import os, sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
module = 'demo:unsolvable-conflict:1.0'
errors = []
if not any(r[0] == 'unscannable' and r[3] == module for r in rows):
    errors.append(f"{module} must be reported unscannable; records={rows}")
nodes = sorted(r[2] for r in rows if r[0] == 'node')
if nodes:
    errors.append(f"Maven resolved no graph, so nothing may be emitted; nodes={nodes}")
jars = sorted(f for _, _, fs in os.walk(sys.argv[2]) for f in fs if f.endswith('.jar'))
if jars:
    errors.append(f"Maven resolved no graph, so nothing may be fetched; jars={jars}")
if errors:
    print("FAIL:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print(f"PASS (unsolvable conflict): {module} unscannable, nothing emitted or fetched")
PY
