/**
 * Path to local node-smol binary for development.
 * When set, this binary will be used instead of downloading from GitHub releases.
 * The binary must exist at the specified path or a warning will be shown.
 */

import process from 'node:process'

export const SOCKET_CLI_LOCAL_NODE_SMOL: string | undefined =
  process.env['SOCKET_CLI_LOCAL_NODE_SMOL']
