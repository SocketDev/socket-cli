#!/bin/bash
# Shared helpers for git hooks — API-key scanner allowlist + color codes.
# Sourced by .git-hooks/commit-msg, pre-commit, pre-push.
#
# Constants
# ---------
# ALLOWED_PUBLIC_KEY  The real public API key shipped in socket-lib test
#                     fixtures. Safe to appear in commits anywhere in the
#                     fleet.
# FAKE_TOKEN_MARKER   Substring marker used in test fixtures (see
#                     socket-lib/test/unit/utils/fake-tokens.ts). Any line
#                     containing this string is treated as a test fixture
#                     by the API-key scanner.
# FAKE_TOKEN_LEGACY   Legacy lib-scoped marker — accepted during the
#                     rename from `socket-lib-test-fake-token` to
#                     `socket-test-fake-token`. Drop when lib's rename PR
#                     lands.
# SOCKET_SECURITY_ENV Name of the env var used in shell examples; not a
#                     token value itself. Exempted from scanners.
#
# Functions
# ---------
# filter_allowed_api_keys  Reads stdin, drops lines matching any allowlist
#                          entry, prints the rest. Usage:
#                            echo "$text" | filter_allowed_api_keys
#                            grep ... | filter_allowed_api_keys
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

# Strips lines that match the allowlist: public key, current fake-token
# marker, legacy lib-scoped marker, env-var name, or `.example` paths.
filter_allowed_api_keys() {
  grep -v "$ALLOWED_PUBLIC_KEY" \
    | grep -v "$FAKE_TOKEN_MARKER" \
    | grep -v "$FAKE_TOKEN_LEGACY" \
    | grep -v "$SOCKET_SECURITY_ENV" \
    | grep -v '\.example'
}
