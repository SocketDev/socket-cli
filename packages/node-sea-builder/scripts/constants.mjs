/**
 * Constants for SEA builder.
 * Environment variables can override defaults.
 */

import nodeVersionConfig from '@socketsecurity/bootstrap/node-version.json' with { type: 'json' }

const { version: NODE_VERSION } = nodeVersionConfig

// Environment variables (can override defaults).
const ENV = {
  SOCKET_CLI_SEA_NODE_VERSION: process.env.SOCKET_CLI_SEA_NODE_VERSION || NODE_VERSION,
  SOCKET_NODE_DOWNLOAD_URL: process.env.SOCKET_NODE_DOWNLOAD_URL,
}

export default {
  ENV,
  NODE_VERSION,
}
