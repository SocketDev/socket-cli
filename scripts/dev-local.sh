#!/usr/bin/env bash
# Helper script to run socket CLI against local depscan API server
#
# Usage:
#   ./scripts/dev-local.sh [socket command]
#
# Examples:
#   ./scripts/dev-local.sh --version
#   ./scripts/dev-local.sh patch discover
#   ./scripts/dev-local.sh scan create .

# Load .env.local if it exists
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | grep -v '^$' | xargs)
fi

# Set default local API server URL if not already set
export SOCKET_CLI_API_BASE_URL="${SOCKET_CLI_API_BASE_URL:-http://localhost:8866}"

echo "🔧 Using API server: $SOCKET_CLI_API_BASE_URL"
echo ""

# Run the CLI with all arguments passed through
./bin/cli.js "$@"
