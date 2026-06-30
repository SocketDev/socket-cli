#!/usr/bin/env bash
# Compile the Coana Maven core extension to a self-contained jar and place it at the path the TS
# runner resolves: manifest-scripts/maven-extension/coana-maven-extension.jar. The jar is committed,
# so run this to refresh it after changing the extension source. Uses the bundled Maven wrapper, so
# it needs only a JDK (and network access to fetch Maven and the plugin dependencies).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
( cd "$here" && ./mvnw -q --batch-mode package )
cp -f "$here/target/coana-maven-extension.jar" "$here/coana-maven-extension.jar"
echo "Coana Maven extension jar: $here/coana-maven-extension.jar"
