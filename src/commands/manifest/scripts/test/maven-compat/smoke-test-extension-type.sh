#!/usr/bin/env bash
# Regression guard: an artifact type a build extension defines must apply as it does in Maven's own
# resolution. Type fat, from the types-ext extension, includes its dependencies and is a jar on disk,
# so demo.ext:inner below demo.ext:fat must not be emitted, and --with-files must fetch fat-1.0.jar.
#
# Usage: smoke-test-extension-type.sh <path-to-mvn> <path-to-extension-jar>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MVN="${1:?usage: smoke-test-extension-type.sh <mvn> <extension-jar>}"
JAR="${2:?usage: smoke-test-extension-type.sh <mvn> <extension-jar>}"
PROJECT="$HERE/extension-type"
RECORDS="$PROJECT/records.tsv"
STUBS="$PROJECT/localrepo"
# shellcheck source=SCRIPTDIR/../compat-cache.sh
. "$HERE/../compat-cache.sh"
M2="$SOCKET_COMPAT_CACHE/m2"

bash "$HERE/../make-stub-repo.sh" "$STUBS" \
  'demo.ext:types-ext:1.0' \
  'demo.ext:fat:1.0+demo.ext:inner:1.0' \
  'demo.ext:inner:1.0'
# The extension is a components.xml registering Maven's own handler class for type fat.
EXT_DIR="$(mktemp -d)"
trap 'rm -rf "$EXT_DIR"' EXIT
mkdir -p "$EXT_DIR/META-INF/plexus"
cat > "$EXT_DIR/META-INF/plexus/components.xml" <<'XML'
<component-set>
  <components>
    <component>
      <role>org.apache.maven.artifact.handler.ArtifactHandler</role>
      <role-hint>fat</role-hint>
      <implementation>org.apache.maven.artifact.handler.DefaultArtifactHandler</implementation>
      <configuration>
        <type>fat</type>
        <extension>jar</extension>
        <includesDependencies>true</includesDependencies>
      </configuration>
    </component>
  </components>
</component-set>
XML
( cd "$EXT_DIR" && jar cf "$STUBS/demo/ext/types-ext/1.0/types-ext-1.0.jar" META-INF )
rm -rf "$M2/demo/ext/types-ext" "$M2/demo/ext/fat" "$M2/demo/ext/inner" "$RECORDS"

echo "+ $("$MVN" -v 2>/dev/null | head -1) (extension type)"
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
nodes = {r[2] for r in rows if r[0] == 'node'}
files = {r[3] for r in rows if r[0] == 'file' and r[2].startswith('demo.ext:fat:')}
failures = [r[1:] for r in rows if r[0] in ('failure', 'unscannable')]
errors = []
if not any(n.startswith('demo.ext:fat:') for n in nodes):
    errors.append(f"demo.ext:fat missing; nodes={sorted(nodes)}")
if any(n.startswith('demo.ext:inner:') for n in nodes):
    errors.append("demo.ext:inner emitted, though type fat includes its dependencies")
if not any(p.endswith('fat-1.0.jar') for p in files):
    errors.append(f"fat-1.0.jar not materialized; files={sorted(files)}")
if failures:
    errors.append(f"no failures expected; got {failures}")
if errors:
    print("FAIL:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("PASS (extension type): fat emitted as a jar, inner not resolved below it")
PY
