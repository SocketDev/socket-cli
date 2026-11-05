#!/usr/bin/env bash
# Compile the archive loader to a Java 8 jar at the path the TS runner resolves:
# manifest-scripts/archive-loader/archive-loader.jar. Needs a JDK 9+ for --release 8.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
javac --release 8 -Xlint:-options -d "$out" "$here/src/ArchiveLoader.java"
jar --create --file "$here/archive-loader.jar" --main-class ArchiveLoader -C "$out" .
echo "Archive loader jar: $here/archive-loader.jar"
