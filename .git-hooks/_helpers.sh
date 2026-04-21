#!/bin/bash
# Shared helpers for git hooks.
# Sourced by .git-hooks/commit-msg, pre-commit, pre-push.
#
# Constants
# ---------
# ALLOWED_PUBLIC_KEY   Real public API key shipped in socket-lib test
#                      fixtures. Safe to appear in commits anywhere.
# FAKE_TOKEN_MARKER    Substring marker used in fleet test fixtures.
# FAKE_TOKEN_LEGACY    Legacy lib-scoped marker — accepted during the
#                      rename from `socket-lib-test-fake-token` to
#                      `socket-test-fake-token`. Drop when socket-lib's
#                      fixture rename PR lands.
# SOCKET_SECURITY_ENV  Env var name used in shell examples; not a token.
#
# Functions
# ---------
# filter_allowed_api_keys  Reads stdin, drops allowlist matches (public
#                          key, fake-token markers, env var name,
#                          `.example` paths), prints the rest.
#
# Colors
# ------
# RED, GREEN, YELLOW, NC

# shellcheck disable=SC2034  # constants sourced by other hooks
ALLOWED_PUBLIC_KEY="sktsec_t_--RAN5U4ivauy4w37-6aoKyYPDt5ZbaT5JBVMqiwKo_api"
FAKE_TOKEN_MARKER="socket-test-fake-token"
FAKE_TOKEN_LEGACY="socket-lib-test-fake-token"
SOCKET_SECURITY_ENV="SOCKET_SECURITY_API_KEY="

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

filter_allowed_api_keys() {
  grep -v "$ALLOWED_PUBLIC_KEY" \
    | grep -v "$FAKE_TOKEN_MARKER" \
    | grep -v "$FAKE_TOKEN_LEGACY" \
    | grep -v "$SOCKET_SECURITY_ENV" \
    | grep -v '\.example'
}
