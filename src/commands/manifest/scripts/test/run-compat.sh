#!/usr/bin/env bash
# Run the JVM manifest-script compatibility matrix LOCALLY, on demand.
#
# GitHub Actions can't run this: SocketDev's org action allowlist forbids
# `actions/setup-java` and `sbt/setup-sbt`, so the build-tool matrix has no CI
# home. Run this whenever you change the Gradle init script
# (socket-facts.init.gradle), the sbt plugin (socket-facts.plugin.scala), or the
# Maven extension (maven-extension/) — it exercises the same version matrix the
# CI workflow used and asserts the scripts still emit the expected records.
#
# JDKs: the matrix needs several Java versions (a row's required major is shown
# per run). Point JDK8 / JDK11 / JDK17 / JDK21 at JDK homes to use the right one
# per row; otherwise the current `java` is used (fine if it can run that tool).
# sbt rows additionally need the `sbt` launcher on PATH.
#
# Usage: run-compat.sh [gradle|sbt|maven|all]   (default: all)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TOOL="${1:-all}"
CACHE="${SOCKET_COMPAT_CACHE:-${TMPDIR:-/tmp}/socket-manifest-compat}"
mkdir -p "$CACHE"

# Same matrix as the former CI workflow. Rows: "<ver> <javaMajor> [scala]".
GRADLE_MATRIX=("1.12 8" "2.14.1 8" "3.3 8" "8.10.2 17" "9.2.1 21")
MAVEN_MATRIX=("3.6.3 11" "3.8.8 17" "3.9.9 17")
SBT_MATRIX=("0.13.18 8 2.10.7" "1.4.9 11 2.12.20" "1.6.2 17 2.12.20" "1.9.9 17 2.12.20")

# Select a JDK for the given Java major: use $JDK<major> if set, else current java.
use_jdk() {
  local home_var="JDK$1"
  local home="${!home_var:-}"
  if [ -n "$home" ]; then
    export JAVA_HOME="$home"
    echo "  JDK $1: $home"
  else
    echo "  JDK $1 not provided (set $home_var=<jdk-home> for fidelity); using current java"
    unset JAVA_HOME || true
  fi
}

run_gradle() {
  for row in "${GRADLE_MATRIX[@]}"; do
    # shellcheck disable=SC2086
    set -- $row
    local ver="$1" java="$2"
    echo "== gradle $ver (wants JDK $java) =="
    use_jdk "$java"
    local dir="$CACHE/gradle-$ver"
    if [ ! -x "$dir/bin/gradle" ]; then
      curl -fsSL "https://services.gradle.org/distributions/gradle-$ver-bin.zip" -o "$CACHE/gradle.zip"
      unzip -q -o "$CACHE/gradle.zip" -d "$CACHE"
    fi
    bash "$HERE/gradle-compat/smoke-test.sh" "$dir/bin/gradle"
  done
}

run_maven() {
  echo "== building the Maven extension jar =="
  bash "$HERE/../maven-extension/build-jar.sh"
  local jar="$HERE/../maven-extension/coana-maven-extension.jar"
  for row in "${MAVEN_MATRIX[@]}"; do
    # shellcheck disable=SC2086
    set -- $row
    local ver="$1" java="$2"
    echo "== maven $ver (wants JDK $java) =="
    use_jdk "$java"
    local dir="$CACHE/apache-maven-$ver"
    if [ ! -x "$dir/bin/mvn" ]; then
      curl -fsSL "https://archive.apache.org/dist/maven/maven-3/$ver/binaries/apache-maven-$ver-bin.zip" -o "$CACHE/maven.zip"
      unzip -q -o "$CACHE/maven.zip" -d "$CACHE"
    fi
    bash "$HERE/maven-compat/smoke-test.sh" "$dir/bin/mvn" "$jar"
  done
}

run_sbt() {
  if ! command -v sbt >/dev/null 2>&1; then
    echo "sbt launcher not found on PATH; install it (e.g. 'brew install sbt' or coursier) to run the sbt matrix" >&2
    return 1
  fi
  for row in "${SBT_MATRIX[@]}"; do
    # shellcheck disable=SC2086
    set -- $row
    local ver="$1" java="$2" scala="$3"
    echo "== sbt $ver / scala $scala (wants JDK $java) =="
    use_jdk "$java"
    bash "$HERE/sbt-compat/smoke-test.sh" "$ver" "$scala"
  done
}

case "$TOOL" in
  gradle) run_gradle ;;
  maven) run_maven ;;
  sbt) run_sbt ;;
  all)
    run_gradle
    run_maven
    run_sbt
    ;;
  *)
    echo "usage: run-compat.sh [gradle|sbt|maven|all]" >&2
    exit 1
    ;;
esac

echo "compat matrix passed: $TOOL"
