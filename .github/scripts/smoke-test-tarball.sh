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
#   VERSION      the verified release version
#   RUNNER_TEMP  GitHub Actions temp dir; the tarball lives in $RUNNER_TEMP/dist
set -euo pipefail

if [ -z "${PKG:-}" ]; then
  echo "PKG is required (the package name to smoke test)." >&2
  exit 1
fi

dist_dir="${RUNNER_TEMP:-/tmp}/dist"
# pnpm removes the scope marker and replaces the slash in the tarball name.
slug=${PKG#@}
tarball="$dist_dir/${slug//\//-}-${VERSION:?VERSION is required}.tgz"
if [ ! -f "$tarball" ]; then
  echo "Missing release tarball: $tarball" >&2
  exit 1
fi

consumer="$(mktemp -d)"
trap 'rm -rf "$consumer"' EXIT
printf '%s\n' '{"name":"socket-cli-smoke","private":true}' > "$consumer/package.json"

echo "Installing $(basename "$tarball") into a throwaway consumer"
(cd "$consumer" && pnpm add --ignore-scripts "$tarball")

installed="$consumer/node_modules/$PKG"
if [ ! -d "$installed" ]; then
  echo "$PKG did not install into the consumer." >&2
  exit 1
fi

manifest="$installed/package.json"
if ! jq -e --arg name "$PKG" --arg version "$VERSION" '.name == $name and .version == $version' "$manifest" >/dev/null; then
  echo "Installed manifest does not match $PKG@$VERSION." >&2
  exit 1
fi
main_bin=${PKG##*/}
bins="$(jq -er --arg main "$main_bin" '.bin | select(has($main)) | keys[]' "$manifest")"
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
  reported="$("$bin_path" --version)"
  if [[ "$bin" == "$main_bin" && "$reported" != "$VERSION" ]]; then
    echo "$bin reported $reported; expected $VERSION." >&2
    exit 1
  fi
done

echo "$PKG installs and every declared executable runs."
