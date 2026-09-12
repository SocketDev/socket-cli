#!/usr/bin/env bash
# Load the Coana Maven core extension on a given Maven binary and assert it emits the expected RECORDS
# for the multi-module smoke project (the TS assembler turns these into .socket.facts.json and is
# tested separately in `nx test utils`). Guards, across the supported Maven range, that the extension:
#  - emits the external prod dep demo.ext:tool (in a prod root) and the test dep demo.ext:harness +
#    its transitive demo.ext:harness-core (only in a non-prod root -> the assembler's dev flag);
#  - emits the internal reactor module demo:lib by its bare groupId:artifactId:version id (so the
#    inter-module edge lines up with its `project` record);
#  - materializes resolved external jars under -Dsocket.withFiles;
#  - scopes that materialization to -Dsocket.populateFilesFor (a newline-delimited GAV file).
#
# The three external artifacts are stubs generated into a file-based repo at test time (see
# ../make-stub-repo.sh, shared with the Gradle fixture): the fixture only needs their graph shape, it
# never compiles against or runs them, so nothing here can age into a CVE alert or a version bump.
#
# Assertions match on groupId:artifactId and ignore the version, so changing a fixture pom needs no
# edit here. The poms are the only place a version is written.
#
# Usage: smoke-test.sh <path-to-mvn> <path-to-extension-jar>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MVN="${1:?usage: smoke-test.sh <mvn> <extension-jar>}"
JAR="${2:?usage: smoke-test.sh <mvn> <extension-jar>}"
PROJECT="$HERE/project"
RECORDS="$PROJECT/records.tsv"
STUBS="$PROJECT/localrepo"
# shellcheck source=SCRIPTDIR/../compat-cache.sh
. "$HERE/../compat-cache.sh"
M2="$SOCKET_COMPAT_CACHE/m2"

bash "$HERE/../make-stub-repo.sh" "$STUBS" \
  'demo.ext:tool:1.0' \
  'demo.ext:harness:1.0+demo.ext:harness-core:1.0' \
  'demo.ext:harness-core:1.0'
# Maven's own plugin closure stays cached between runs; the stubs never do, so every run has to
# resolve them from the repo just generated.
rm -rf "$M2/demo" "$RECORDS" "$PROJECT"/*/target "$PROJECT"/target

echo "+ $("$MVN" -v 2>/dev/null | head -1)"
( cd "$PROJECT" && "$MVN" --batch-mode -q \
    "-Dmaven.ext.class.path=$JAR" \
    -Dcoana.task=socket-facts \
    -Dsocket.withFiles=true \
    "-Dmaven.repo.local=$M2" \
    "-Dstub.repo.url=file://$STUBS" \
    "-Dsocket.recordsFile=$RECORDS" \
    compile )

python3 "$HERE/assert-records.py" "$RECORDS"

# Second run: scope --with-files to a single GAV and assert ONLY that artifact is materialized.
# The GAV comes from the records the first run just emitted, so it always matches the fixture pom.
SCOPE="$PROJECT/.populate-for.txt"
python3 - "$RECORDS" > "$SCOPE" <<'PY'
import sys
for l in open(sys.argv[1]):
    r = l.rstrip('\n').split('\t')
    if r[0] == 'node' and r[2].startswith('demo.ext:tool:jar:'):
        print(f'{r[3]}:{r[4]}:{r[5]}')       # groupId:artifactId:version
        break
else:
    sys.exit('no demo.ext:tool node record to scope on')
PY
rm -rf "$RECORDS" "$PROJECT"/*/target "$PROJECT"/target
( cd "$PROJECT" && "$MVN" --batch-mode -q \
    "-Dmaven.ext.class.path=$JAR" \
    -Dcoana.task=socket-facts \
    -Dsocket.withFiles=true \
    "-Dmaven.repo.local=$M2" \
    "-Dstub.repo.url=file://$STUBS" \
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

def jars(prefix):
    return [p for c, ps in files.items() if c.startswith(prefix) for p in ps if p.endswith('.jar')]

if not jars('demo.ext:tool:jar:'):
    errors.append(f"scoped run: demo.ext:tool (in scope) not materialized: {files}")
if jars('demo.ext:harness:jar:'):
    errors.append(f"scoped run: demo.ext:harness (out of scope) was materialized: {jars('demo.ext:harness:jar:')}")
if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print("PASS (populateFilesFor scoping): demo.ext:tool materialized, demo.ext:harness skipped")
PY
