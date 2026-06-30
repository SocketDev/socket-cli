#!/usr/bin/env bash
# Run socket-facts.init.gradle against the hermetic local-repo project on a given Gradle binary and
# assert it emits the expected RECORDS (the script's only output now — the TS assembler turns these
# into .socket.facts.json and is tested separately in `nx test utils`). Guards, across the supported
# Gradle range, that the reflective old-Gradle shims (findProperty / canBeResolved /
# firstLevelModuleDependencies) keep producing correct facts:
#  - exactly the two expected dependency nodes, demo.lib:foo + demo.test:bar;
#  - foo (prod) appears in a prod root, bar (test) only in non-prod roots -> the assembler's dev flag;
#  - every resolved dependency gets an on-disk jar `file` record under -Psocket.withFiles (incl. the
#    production dep reached via the legacy `compile` config on old Gradle);
#  - -Psocket.populateFilesFor scopes materialization to a single GAV.
#
# Usage: smoke-test.sh /path/to/gradle
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GRADLE="${1:?usage: smoke-test.sh <path-to-gradle-binary>}"
INIT="$HERE/../../socket-facts.init.gradle"
PROJECT="$HERE/project"
GUH="$HERE/.gradle-home"   # isolated Gradle user home -> hermetic, no global init scripts
RECORDS="$PROJECT/records.tsv"

bash "$HERE/make-localrepo.sh"
rm -rf "$GUH" "$RECORDS" "$PROJECT/.gradle" "$PROJECT/build"

echo "+ $("$GRADLE" --version 2>/dev/null | sed -n 's/^Gradle //p' | head -1)"
( cd "$PROJECT" && "$GRADLE" --no-daemon --offline -g "$GUH" \
    --init-script "$INIT" -Psocket.withFiles=true -Psocket.recordsFile="$RECORDS" socketFacts -q )

python3 - "$RECORDS" 'full' <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
scoped = sys.argv[2] == 'scoped'
roots, nodes, files = {}, {}, {}
for r in rows:
    if r[0] == 'root':  roots[r[1]] = (r[4] == '1')                 # rootId -> prod
    elif r[0] == 'node': nodes.setdefault(r[2], set()).add(r[1])    # coordId -> {rootId}
    elif r[0] == 'file': files.setdefault(r[2], set()).add(r[3])    # coordId -> {path}
errors = []

foo, bar = 'demo.lib:foo:jar:1.0', 'demo.test:bar:jar:1.0'
if sorted(nodes) != [foo, bar]:
    errors.append(f"nodes {sorted(nodes)} != expected {[foo, bar]}")
# prod/dev is derived by the assembler from which roots a node appears in: foo in a prod root,
# bar only in non-prod (test) roots.
if foo in nodes and not any(roots.get(rid) for rid in nodes[foo]):
    errors.append("production dep foo not present in any prod root")
if bar in nodes and any(roots.get(rid) for rid in nodes[bar]):
    errors.append("test dep bar wrongly present in a prod root")

def has_jar(cid): return any(p.endswith('.jar') for p in files.get(cid, ()))
# foo is always materialized; bar only on the unscoped run.
if not has_jar(foo):
    errors.append(f"foo missing materialized jar under --with-files: {files.get(foo)}")
if scoped:
    if has_jar(bar): errors.append(f"scoped run: bar (out of scope) was materialized: {files.get(bar)}")
else:
    if not has_jar(bar): errors.append(f"bar missing materialized jar under --with-files: {files.get(bar)}")

if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print(f"PASS ({'scoped' if scoped else 'full'}): nodes {sorted(nodes)}; foo prod+jar; bar dev"
      + ("; bar skipped" if scoped else "; bar jar"))
PY

# Second run: scope --with-files to a single GAV and assert ONLY that artifact is materialized.
SCOPE="$HERE/.populate-for.txt"
printf 'demo.lib:foo:1.0\n' > "$SCOPE"
rm -rf "$GUH" "$RECORDS" "$PROJECT/.gradle" "$PROJECT/build"
( cd "$PROJECT" && "$GRADLE" --no-daemon --offline -g "$GUH" \
    --init-script "$INIT" -Psocket.withFiles=true -Psocket.populateFilesFor="$SCOPE" -Psocket.recordsFile="$RECORDS" socketFacts -q )
rm -f "$SCOPE"

python3 - "$RECORDS" 'scoped' <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
files = {}
for r in rows:
    if r[0] == 'file': files.setdefault(r[2], set()).add(r[3])
errors = []
if not any(p.endswith('.jar') for p in files.get('demo.lib:foo:jar:1.0', ())):
    errors.append(f"scoped run: foo (in scope) not materialized: {files.get('demo.lib:foo:jar:1.0')}")
if files.get('demo.test:bar:jar:1.0'):
    errors.append(f"scoped run: bar (out of scope) was materialized: {files.get('demo.test:bar:jar:1.0')}")
if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print("PASS (populateFilesFor scoping): foo materialized, bar skipped")
PY
