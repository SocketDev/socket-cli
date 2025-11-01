/**
 * Constants for SEA builder.
 * Environment variables can override defaults.
 */

import nodeVersionConfig from '@socketsecurity/bootstrap/node-version.json' with { type: 'json' }

// Use versionSemver (without 'v' prefix) for URL construction.
const { versionSemver: NODE_VERSION } = nodeVersionConfig

// Environment variables (can override defaults).
const ENV = {
  SOCKET_CLI_SEA_NODE_VERSION: process.env.SOCKET_CLI_SEA_NODE_VERSION || NODE_VERSION,
  SOCKET_CLI_NODE_DOWNLOAD_URL: process.env.SOCKET_CLI_NODE_DOWNLOAD_URL || 'https://nodejs.org/download/release',
}

export default {
  ENV,
  NODE_VERSION,
}
