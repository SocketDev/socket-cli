#!/usr/bin/env bash
# Generate a tiny hermetic local Maven repo (two transitive-free artifacts) under
# project/localrepo so the smoke test resolves fully offline on any Gradle version.
# Text-only in git; the .pom + (empty) .jar files are generated at test time.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/project/localrepo"
rm -rf "$REPO"

mkpkg() { # group artifact version
  local group="$1" art="$2" ver="$3"
  local dir="$REPO/${group//.//}/$art/$ver"
  mkdir -p "$dir"
  cat > "$dir/$art-$ver.pom" <<POM
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>$group</groupId>
  <artifactId>$art</artifactId>
  <version>$ver</version>
  <packaging>jar</packaging>
</project>
POM
  # empty but valid jar (jar ships with every JDK, which CI sets up)
  local tmp; tmp="$(mktemp -d)"
  ( cd "$tmp" && jar cf "$dir/$art-$ver.jar" . )
  rm -rf "$tmp"
}

mkpkg demo.lib  foo 1.0
mkpkg demo.test bar 1.0
echo "built local repo at $REPO"
