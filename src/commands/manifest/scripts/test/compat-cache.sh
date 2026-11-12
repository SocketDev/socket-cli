#!/usr/bin/env bash
# Shared cache root for the JVM compat suites: the downloaded build-tool distributions plus each
# tool's dependency cache. Keeping the caches here rather than in ~/.m2, ~/.gradle and ~/.ivy2 means
# a run can't pass off a warm home cache, can't write a home path into the records it emits, and
# can't leave anything behind in the developer's own caches. Point SOCKET_COMPAT_CACHE at a fresh
# `mktemp -d` for a cold run.
SOCKET_COMPAT_CACHE="${SOCKET_COMPAT_CACHE:-${TMPDIR:-/tmp}/socket-manifest-compat}"
mkdir -p "$SOCKET_COMPAT_CACHE"

# Assemble a records file the way `socket manifest` does, failing on an orphaned component. Runs the
# assembler's TypeScript directly, so it needs Node 22+ and the repo's installed dependencies.
assemble_records() {
  node --experimental-strip-types --no-warnings "$(dirname "${BASH_SOURCE[0]}")/assemble-records.mts" "$1"
}
