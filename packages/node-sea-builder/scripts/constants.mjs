/**
 * Constants for SEA builder.
 * Environment variables can override defaults.
 */

// Environment variables.
const ENV = {
  SOCKET_CLI_SEA_NODE_VERSION: process.env.SOCKET_CLI_SEA_NODE_VERSION,
  SOCKET_NODE_DOWNLOAD_URL: process.env.SOCKET_NODE_DOWNLOAD_URL,
}

export default {
  ENV,
}
