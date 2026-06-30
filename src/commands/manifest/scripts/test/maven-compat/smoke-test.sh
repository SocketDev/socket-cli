#!/usr/bin/env bash
# Load the Coana Maven core extension on a given Maven binary and assert it emits the expected RECORDS
# for the multi-module smoke project (the TS assembler turns these into .socket.facts.json and is
# tested separately in `nx test utils`). Guards, across the supported Maven range, that the extension:
#  - emits the external prod dep commons-io (in a prod root) and the test dep junit + its transitive
#    hamcrest (only in a non-prod root -> the assembler's dev flag);
#  - emits the internal reactor module demo:lib by its bare groupId:artifactId:version id (so the
#    inter-module edge lines up with its `project` record);
#  - materializes resolved external jars under -Dsocket.withFiles;
#  - scopes that materialization to -Dsocket.populateFilesFor (a newline-delimited GAV file).
#
# Usage: smoke-test.sh <path-to-mvn> <path-to-extension-jar>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MVN="${1:?usage: smoke-test.sh <mvn> <extension-jar>}"
JAR="${2:?usage: smoke-test.sh <mvn> <extension-jar>}"
PROJECT="$HERE/project"
RECORDS="$PROJECT/records.tsv"

rm -rf "$RECORDS" "$PROJECT"/*/target "$PROJECT"/target

echo "+ $("$MVN" -v 2>/dev/null | head -1)"
( cd "$PROJECT" && "$MVN" --batch-mode -q \
    "-Dmaven.ext.class.path=$JAR" \
    -Dcoana.task=socket-facts \
    -Dsocket.withFiles=true \
    "-Dsocket.recordsFile=$RECORDS" \
    compile )

python3 - "$RECORDS" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
tool = None
roots, nodes, files, direct = {}, {}, {}, {}
for r in rows:
    if r[0] == 'meta': tool = r[1]
    elif r[0] == 'root': roots[r[1]] = (r[4] == '1')                 # rootId -> prod
    elif r[0] == 'node':
        nodes.setdefault(r[2], set()).add(r[1])                      # coordId -> {rootId}
        if r[8] == '1': direct.setdefault(r[2], set()).add(r[1])     # coordId -> {rootId where direct}
    elif r[0] == 'file': files.setdefault(r[2], set()).add(r[3])     # coordId -> {path}

errors = []
commons = 'commons-io:commons-io:jar:2.11.0'
junit = 'junit:junit:jar:4.13.2'
hamcrest = 'org.hamcrest:hamcrest-core:jar:1.3'
lib = 'demo:lib:1.0'  # internal module: bare id, no ext

if tool != 'maven': errors.append(f"meta tool {tool!r} != 'maven'")

def in_prod(cid): return any(roots.get(rid) for rid in nodes.get(cid, ()))
def has_jar(cid): return any(p.endswith('.jar') for p in files.get(cid, ()))

if commons not in nodes: errors.append("missing external prod dep commons-io")
elif not in_prod(commons): errors.append("commons-io not in a prod root")
if not has_jar(commons): errors.append(f"commons-io jar not materialized: {files.get(commons)}")

if junit not in nodes: errors.append("missing test dep junit")
elif in_prod(junit): errors.append("test dep junit wrongly in a prod root")
if not has_jar(junit): errors.append(f"junit jar not materialized: {files.get(junit)}")
if hamcrest in nodes and in_prod(hamcrest): errors.append("transitive test dep hamcrest wrongly in a prod root")

if lib not in nodes: errors.append("internal module demo:lib not emitted by its bare id")
elif not in_prod(lib): errors.append("internal module demo:lib not in app's prod root")
elif not direct.get(lib): errors.append("internal module demo:lib not marked direct")

if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print(f"PASS: tool=maven; commons-io prod+jar; junit/hamcrest dev; internal demo:lib (bare id, direct)")
PY

# Second run: scope --with-files to a single GAV and assert ONLY that artifact is materialized.
SCOPE="$PROJECT/.populate-for.txt"
printf 'commons-io:commons-io:2.11.0\n' > "$SCOPE"
rm -rf "$RECORDS" "$PROJECT"/*/target "$PROJECT"/target
( cd "$PROJECT" && "$MVN" --batch-mode -q \
    "-Dmaven.ext.class.path=$JAR" \
    -Dcoana.task=socket-facts \
    -Dsocket.withFiles=true \
    "-Dsocket.populateFilesFor=$SCOPE" \
    "-Dsocket.recordsFile=$RECORDS" \
    compile )
rm -f "$SCOPE"

python3 - "$RECORDS" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
files = {}
for r in rows:
    if r[0] == 'file': files.setdefault(r[2], set()).add(r[3])
errors = []
if not any(p.endswith('.jar') for p in files.get('commons-io:commons-io:jar:2.11.0', ())):
    errors.append(f"scoped run: commons-io (in scope) not materialized: {files.get('commons-io:commons-io:jar:2.11.0')}")
if files.get('junit:junit:jar:4.13.2'):
    errors.append(f"scoped run: junit (out of scope) was materialized: {files.get('junit:junit:jar:4.13.2')}")
if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print("PASS (populateFilesFor scoping): commons-io materialized, junit skipped")
PY
