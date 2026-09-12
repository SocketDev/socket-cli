#!/usr/bin/env bash
# Generate a hermetic file-based Maven repository of stub artifacts for the JVM compat fixtures.
# Each stub gets a .pom and an empty-but-valid .jar in standard repo layout, so a build tool can
# resolve the declared graph shape without reaching a network repository. The fixtures never compile
# against or execute these artifacts — only their coordinates and scopes are observed — so stubs are
# behaviourally identical to the real thing here, and they can never age into a CVE or a version bump.
#
# Text-only in git: everything under <repo-dir> is produced at test time and gitignored.
#
# Usage: make-stub-repo.sh <repo-dir> <spec>...
#   spec = group:artifact:version[+dep-group:dep-artifact:dep-version[,...]]
#   Deps listed after `+` are written as compile-scope dependencies of that stub, so a consumer that
#   depends on the stub also pulls them transitively.
set -euo pipefail

REPO="${1:?usage: make-stub-repo.sh <repo-dir> <group:artifact:version[+dep,...]>...}"
shift
if [ "$#" -eq 0 ]; then
  echo "make-stub-repo.sh: no artifact specs given" >&2
  exit 1
fi

rm -rf "$REPO"
mkdir -p "$REPO"
REPO="$(cd "$REPO" && pwd)"   # `jar` runs from an empty dir, so the output path must be absolute

EMPTY="$(mktemp -d)"
trap 'rm -rf "$EMPTY"' EXIT

for spec in "$@"; do
  coord="${spec%%+*}"
  deps=""
  [ "$coord" = "$spec" ] || deps="${spec#*+}"
  IFS=: read -r group art ver <<<"$coord"
  if [ -z "${group:-}" ] || [ -z "${art:-}" ] || [ -z "${ver:-}" ]; then
    echo "make-stub-repo.sh: malformed spec '$spec' (want group:artifact:version[+dep,...])" >&2
    exit 1
  fi

  dir="$REPO/${group//.//}/$art/$ver"
  mkdir -p "$dir"

  {
    echo '<project xmlns="http://maven.apache.org/POM/4.0.0">'
    echo '  <modelVersion>4.0.0</modelVersion>'
    echo "  <groupId>$group</groupId>"
    echo "  <artifactId>$art</artifactId>"
    echo "  <version>$ver</version>"
    echo '  <packaging>jar</packaging>'
    if [ -n "$deps" ]; then
      echo '  <dependencies>'
      IFS=, read -r -a dep_list <<<"$deps"
      for dep in "${dep_list[@]}"; do
        IFS=: read -r dgroup dart dver <<<"$dep"
        if [ -z "${dgroup:-}" ] || [ -z "${dart:-}" ] || [ -z "${dver:-}" ]; then
          echo "make-stub-repo.sh: malformed dependency '$dep' in spec '$spec'" >&2
          exit 1
        fi
        echo '    <dependency>'
        echo "      <groupId>$dgroup</groupId>"
        echo "      <artifactId>$dart</artifactId>"
        echo "      <version>$dver</version>"
        echo '    </dependency>'
      done
      echo '  </dependencies>'
    fi
    echo '</project>'
  } >"$dir/$art-$ver.pom"

  # empty but valid jar (jar ships with every JDK, which these fixtures already need)
  ( cd "$EMPTY" && jar cf "$dir/$art-$ver.jar" . )
done

echo "built stub repo at $REPO"
