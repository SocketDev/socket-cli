#!/usr/bin/env bash
# Shared cache root for the compat suites: the downloaded build-tool distributions. Point SOCKET_COMPAT_CACHE at a fresh
# `mktemp -d` for a cold run.
SOCKET_COMPAT_CACHE="${SOCKET_COMPAT_CACHE:-${TMPDIR:-/tmp}/socket-manifest-compat}"
mkdir -p "$SOCKET_COMPAT_CACHE"

