#!/usr/bin/env bash
# Shared cache root for the JVM compat suites: the downloaded build-tool distributions plus each
# tool's dependency cache. Keeping the caches here rather than in ~/.m2, ~/.gradle and ~/.ivy2 means
# a run can't pass off a warm home cache, can't write a home path into the records it emits, and
# can't leave anything behind in the developer's own caches. Point SOCKET_COMPAT_CACHE at a fresh
# `mktemp -d` for a cold run.
SOCKET_COMPAT_CACHE="${SOCKET_COMPAT_CACHE:-${TMPDIR:-/tmp}/socket-manifest-compat}"
mkdir -p "$SOCKET_COMPAT_CACHE"
