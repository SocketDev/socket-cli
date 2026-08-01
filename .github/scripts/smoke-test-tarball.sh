#!/usr/bin/env bash
#
# Install a freshly packed tarball into a throwaway consumer and run every
# executable its manifest declares. A tarball can build green, pack green, and
# still be unusable — a missing `files` entry, a bin pointing at a path that
# was never built, a broken shebang. This is the gate that catches that, and
# it runs on dry runs too, so the failure lands before any release marker
# exists rather than after.
#
# Inputs (environment):
#   PKG          the package name to install and probe, e.g. socket
#   RUNNER_TEMP  GitHub Actions temp dir; the tarball lives in $RUNNER_TEMP/dist
set -euo pipefail

if [ -z "${PKG:-}" ]; then
  echo "PKG is required (the package name to smoke test)." >&2
  exit 1
fi

dist_dir="${RUNNER_TEMP:-/tmp}/dist"
# The tarball name npm derives from the package name: scope separator dropped,
# leading @ removed (@socketsecurity/cli -> socketsecurity-cli).
slug="$(printf '%s' "$PKG" | sed 's|^@||; s|/|-|')"
tarball="$(ls -t "$dist_dir/$slug"-*.tgz 2>/dev/null | head -1)"
if [ -z "$tarball" ]; then
  echo "No packed tarball for $PKG in $dist_dir." >&2
  echo "Wanted: $dist_dir/$slug-<version>.tgz" >&2
  ls -la "$dist_dir" >&2 || true
  exit 1
fi

consumer="$(mktemp -d)"
trap 'rm -rf "$consumer"' EXIT
printf '%s\n' '{"name":"socket-cli-smoke","private":true}' > "$consumer/package.json"

echo "Installing $(basename "$tarball") into a throwaway consumer"
npm install --ignore-scripts --no-audit --no-fund --prefix "$consumer" "$tarball"

installed="$consumer/node_modules/$PKG"
if [ ! -d "$installed" ]; then
  echo "$PKG did not install into the consumer." >&2
  exit 1
fi

bins="$(node -p "Object.keys(require('$installed/package.json').bin ?? {}).join(' ')")"
if [ -z "$bins" ]; then
  echo "$PKG declares no bin entries; nothing to probe." >&2
  exit 1
fi

for bin in $bins; do
  bin_path="$consumer/node_modules/.bin/$bin"
  if [ ! -x "$bin_path" ]; then
    echo "Declared executable '$bin' is missing or not executable at $bin_path." >&2
    exit 1
  fi
  echo "Running $bin --version"
  "$bin_path" --version
done

echo "$PKG installs and every declared executable runs."
