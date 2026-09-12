#!/usr/bin/env bash
# Compile the Coana Maven core extension to a self-contained jar and place it at the path the TS
# runner resolves: manifest-scripts/maven-extension/coana-maven-extension.jar. Run by the npm-package
# build and the manifest-maven CI job. Uses the bundled Maven wrapper, so it needs only a JDK.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Keep the downloaded artifacts and the Maven distribution out of the developer's ~/.m2. The path is
# stable so the plugin closure stays cached between runs; point SOCKET_CLI_MAVEN_HOME elsewhere for a
# cold build.
tmp_root="${TMPDIR:-/tmp}"
maven_home="${SOCKET_CLI_MAVEN_HOME:-${tmp_root%/}/socket-cli-maven-home}"
mkdir -p "$maven_home"
# Absolute, because the Maven invocation below runs after a cd into the extension directory: a
# relative SOCKET_CLI_MAVEN_HOME or TMPDIR would otherwise create one tree here and write another
# under the extension directory.
maven_home="$(cd "$maven_home" && pwd)"

(
  cd "$here"
  MAVEN_USER_HOME="$maven_home" ./mvnw -q --batch-mode \
    -Dmaven.repo.local="$maven_home/repository" package
)
cp -f "$here/target/coana-maven-extension.jar" "$here/coana-maven-extension.jar"
echo "Coana Maven extension jar: $here/coana-maven-extension.jar"
