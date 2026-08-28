#!/usr/bin/env bash
# Regression guard: a dependency reachable only through a repository declared by a SIBLING reactor
# module must still be materialized under -Dsocket.withFiles.
#
# The fixture mirrors the shape that broke in the field: `liba` declares the only repository serving
# demo.scoped:widget, and `libb` reaches that artifact transitively through its reactor dependency on
# liba. Maven resolves each dependency node against the repositories that node's own descriptor
# lineage contributes, so widget resolves for libb too. Resolving instead against libb's own
# repository list — the module the walk started from — finds nothing, and (because Aether's local
# repository records which repository each cached file came from) not even an already-downloaded copy
# in ~/.m2 is considered available.
#
# Runs at `validate`, the phase the CLI's runner uses: no reactor module is packaged and none is
# installed, so this also guards that a reactor sibling's own jar is never requested.
#
# Usage: smoke-test-repo-inheritance.sh <path-to-mvn> <path-to-extension-jar>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MVN="${1:?usage: smoke-test-repo-inheritance.sh <mvn> <extension-jar>}"
JAR="${2:?usage: smoke-test-repo-inheritance.sh <mvn> <extension-jar>}"
PROJECT="$HERE/repo-inheritance"
RECORDS="$PROJECT/records.tsv"
STUBS="$PROJECT/localrepo"
# shellcheck source=SCRIPTDIR/../compat-cache.sh
. "$HERE/../compat-cache.sh"
M2="$SOCKET_COMPAT_CACHE/m2"

bash "$HERE/../make-stub-repo.sh" "$STUBS" 'demo.scoped:widget:1.0'
# The stub never stays cached: every run has to resolve it through the repository liba declares.
rm -rf "$M2/demo/scoped" "$RECORDS"

echo "+ $("$MVN" -v 2>/dev/null | head -1) (repo inheritance)"
( cd "$PROJECT" && "$MVN" --batch-mode -q \
    "-Dmaven.ext.class.path=$JAR" \
    -Dcoana.task=socket-facts \
    -Dsocket.withFiles=true \
    "-Dmaven.repo.local=$M2" \
    "-Dstub.repo.url=file://$STUBS" \
    "-Dsocket.recordsFile=$RECORDS" \
    validate )

python3 - "$RECORDS" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
roots, nodes, files, edges, failures = {}, {}, {}, set(), []
for r in rows:
    if r[0] == 'root': roots[r[1]] = r[2]                            # rootId -> projectKey
    elif r[0] == 'node': nodes.setdefault(r[2], set()).add(r[1])     # coordId -> {rootId}
    elif r[0] == 'file': files.setdefault(r[2], set()).add(r[3])     # coordId -> {path}
    elif r[0] == 'edge': edges.add((r[1], r[2], r[3]))               # (rootId, parent, child)
    elif r[0] == 'failure': failures.append(r[1:])

WIDGET = 'demo.scoped:widget:jar:1.0'
LIBA = 'demo:liba:1.0'
errors = []

if failures:
    errors.append(f"expected no failure records, got {failures}")

def roots_for(project_key):
    return {rid for rid, key in roots.items() if key == project_key}

for project_key in ('liba', 'libb'):
    rids = roots_for(project_key)
    if not rids:
        errors.append(f"no root record for module {project_key!r}")
        continue
    if not (nodes.get(WIDGET, set()) & rids):
        errors.append(f"{WIDGET} missing from {project_key}'s graph")

# The point of the fixture: libb reaches widget only through the reactor module liba.
if not any(rid in roots_for('libb') and p == LIBA and c == WIDGET for rid, p, c in edges):
    errors.append(f"no {LIBA} -> {WIDGET} edge in libb's root")

jars = [p for p in files.get(WIDGET, ()) if p.endswith('.jar')]
if not jars:
    errors.append(f"{WIDGET} jar not materialized: {files.get(WIDGET)}")

# A reactor sibling reports its dirs through its `project` record, never a `file` record.
if files.get(LIBA):
    errors.append(f"reactor module {LIBA} should have no file records, got {files[LIBA]}")

if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print(f"PASS (repo inheritance): {WIDGET} resolved for liba and libb via liba's repository; jar materialized")
PY

# Second run, the other half of the contract: fail CLOSED. With the artifact gone from every
# repository — central mirrored to the same, now widget-less, stub repo so nothing crosses a network
# — a dependency that cannot be materialized MUST surface as a failure record. A silently missing jar
# would leave the reachability analysis blind to whatever it contains and under-report reachability.
SETTINGS="$PROJECT/.mirror-settings.xml"
cat >"$SETTINGS" <<XML
<settings>
  <mirrors>
    <mirror>
      <id>socket-no-network</id>
      <mirrorOf>central</mirrorOf>
      <url>file://$STUBS</url>
    </mirror>
  </mirrors>
</settings>
XML
rm -rf "$STUBS/demo/scoped" "$M2/demo/scoped" "$RECORDS"
( cd "$PROJECT" && "$MVN" --batch-mode -q \
    "-Dmaven.ext.class.path=$JAR" \
    -Dcoana.task=socket-facts \
    -Dsocket.withFiles=true \
    "-Dmaven.repo.local=$M2" \
    "-Dstub.repo.url=file://$STUBS" \
    -s "$SETTINGS" \
    "-Dsocket.recordsFile=$RECORDS" \
    validate )
rm -f "$SETTINGS"

python3 "$HERE/assert-fail-closed.py" "$RECORDS"
