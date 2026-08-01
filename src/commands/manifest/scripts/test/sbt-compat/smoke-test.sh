#!/usr/bin/env bash
# Run socket-facts.plugin.scala against the smoke project on a given sbt version and assert it emits
# the expected RECORDS (the plugin's only output now — the TS assembler turns these into
# .socket.facts.json and is tested separately in `nx test utils`). Guards, across the supported sbt
# range (0.13.x .. 1.x), that the reflective version shims (ResolveException / ExclusionRule /
# ConfigRef, updateFull-vs-update) keep producing correct facts:
#  - the two expected dependency nodes are present (demo.ext:tool prod, demo.ext:harness test);
#  - tool appears in a prod root, harness only in non-prod roots -> the assembler's dev flag;
#  - both get an on-disk jar `file` record under -Dsocket.withFiles.
#
# Both deps are stubs generated into project/localrepo at test time (../make-stub-repo.sh, shared with
# the Gradle and Maven fixtures), so neither can age into a CVE alert or a version bump.
#
# The plugin is activated exactly as run.ts does it: dropped into a fresh sbt global base's plugins/.
# Usage: smoke-test.sh <sbt-version> <scala-version>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SBT_VERSION="${1:?usage: smoke-test.sh <sbt-version> <scala-version>}"
SCALA_VERSION="${2:?usage: smoke-test.sh <sbt-version> <scala-version>}"
PLUGIN="$HERE/../../socket-facts.plugin.scala"
PROJECT="$HERE/project"
RECORDS="$PROJECT/records.tsv"
# shellcheck source=SCRIPTDIR/../compat-cache.sh
. "$HERE/../compat-cache.sh"
IVY="$SOCKET_COMPAT_CACHE/ivy2"
export COURSIER_CACHE="$SOCKET_COMPAT_CACHE/coursier"

bash "$HERE/../make-stub-repo.sh" "$PROJECT/localrepo" 'demo.ext:tool:1.0' 'demo.ext:harness:1.0'
# scala-library and friends stay cached between runs; the stubs never do, so every run has to
# resolve them from the repo just generated. Only Ivy caches them — coursier reads a `file:`
# repository in place.
rm -rf "$IVY/cache/demo.ext"

GB="$(mktemp -d)/global-base"
mkdir -p "$GB/plugins"
cp "$PLUGIN" "$GB/plugins/SocketFactsPlugin.scala"

# Pin the sbt + scala versions for this matrix entry (the launcher downloads the sbt version).
# `project/` (the meta-build dir) is an empty dir in git, so it's absent on a fresh checkout.
mkdir -p "$PROJECT/project"
echo "sbt.version=$SBT_VERSION" > "$PROJECT/project/build.properties"
echo "scalaVersion in ThisBuild := \"$SCALA_VERSION\"" > "$PROJECT/scala-version.sbt"
rm -rf "$RECORDS" "$PROJECT/target" "$PROJECT/project/target"

echo "+ sbt $SBT_VERSION (scala $SCALA_VERSION)"
( cd "$PROJECT" && sbt -Dsbt.global.base="$GB" -Dsbt.server.autostart=false \
    -Dsbt.ivy.home="$IVY" \
    -Dsocket.withFiles=true -Dsocket.recordsFile="$RECORDS" --batch socketFacts )

python3 - "$RECORDS" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
roots, nodes, files = {}, {}, {}
for r in rows:
    if r[0] == 'root':  roots[r[1]] = (r[4] == '1')
    elif r[0] == 'node': nodes.setdefault(r[2], set()).add(r[1])
    elif r[0] == 'file': files.setdefault(r[2], set()).add(r[3])
errors = []

tool    = 'demo.ext:tool:jar:1.0'
harness = 'demo.ext:harness:jar:1.0'
for cid in (tool, harness):
    if cid not in nodes: errors.append(f"expected node missing: {cid}")
if tool in nodes and not any(roots.get(rid) for rid in nodes[tool]):
    errors.append("demo.ext:tool not present in any prod root")
if harness in nodes and any(roots.get(rid) for rid in nodes[harness]):
    errors.append("test dep demo.ext:harness wrongly present in a prod root")
def has_jar(cid): return any(p.endswith('.jar') for p in files.get(cid, ()))
for cid in (tool, harness):
    if not has_jar(cid): errors.append(f"{cid} missing materialized jar under --with-files: {files.get(cid)}")

if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print(f"PASS: demo.ext:tool prod+jar; demo.ext:harness dev+jar ({len(nodes)} nodes)")
PY
