/**
 * @fileoverview npm Arborist preload entry point for Socket CLI
 *
 * Installs safe Arborist hooks to intercept npm operations for security scanning.
 */

import constants from '../../constants.mts'
import { installSafeArborist } from './arborist/index.mts'

// Only run this preload script in an IPC subprocess spawned by Socket CLI.
// NODE_CHANNEL_FD is set when spawned with IPC (stdio includes 'ipc').
// SOCKET_CLI_PRELOAD_PHASE is set by Socket CLI when spawning.
if (!constants.ENV.NODE_CHANNEL_FD || !constants.ENV.SOCKET_CLI_PRELOAD_PHASE) {
  // eslint-disable-next-line n/no-process-exit
  process.exit(0)
}

installSafeArborist()
