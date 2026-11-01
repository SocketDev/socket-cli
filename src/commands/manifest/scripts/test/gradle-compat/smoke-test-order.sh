#!/usr/bin/env bash
# Run socket-facts.init.gradle with --with-files on the ordering fixture and assert the runtime
# classpath root lists its nodes in the order Gradle itself builds that classpath in, which the
# fixture's own `printClasspath` task reports. A plain graph walk would give a different order.
#
# Usage: smoke-test-order.sh /path/to/gradle
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GRADLE="${1:?usage: smoke-test-order.sh <path-to-gradle-binary>}"
INIT="$HERE/../../socket-facts.init.gradle"
PROJECT="$HERE/order"
RECORDS="$PROJECT/records.tsv"
CLASSPATH="$PROJECT/classpath.txt"
# shellcheck source=SCRIPTDIR/../compat-cache.sh
. "$HERE/../compat-cache.sh"
GUH="$SOCKET_COMPAT_CACHE/gradle-home"

bash "$HERE/../make-stub-repo.sh" "$PROJECT/localrepo" 'demo.lib:a:1.0+demo.lib:a1:1.0' 'demo.lib:a1:1.0' 'demo.lib:b:1.0'
rm -rf "$GUH" "$RECORDS" "$CLASSPATH" "$PROJECT/.gradle" "$PROJECT/build"

echo "+ $("$GRADLE" --version 2>/dev/null | sed -n 's/^Gradle //p' | head -1) (order)"
( cd "$PROJECT" && "$GRADLE" --no-daemon --offline -g "$GUH" --init-script "$INIT" \
    -Psocket.withFiles=true -Psocket.recordsFile="$RECORDS" -PclasspathFile="$CLASSPATH" \
    socketFacts printClasspath -q )

python3 - "$RECORDS" "$CLASSPATH" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
config, *jars = [l.strip() for l in open(sys.argv[2]) if l.strip()]
root = next((r[1] for r in rows if r[0] == 'root' and r[3] == config), None)
names = [f"{r[4]}-{r[5]}.jar" for r in rows if r[0] == 'node' and r[1] == root]
if root is None:
    print(f"FAIL: no {config} root"); sys.exit(1)
if names != jars:
    print(f"FAIL: {config} nodes {names} != Gradle's classpath order {jars}"); sys.exit(1)
print(f"PASS (order): {config} nodes in Gradle's classpath order {jars}")
PY
