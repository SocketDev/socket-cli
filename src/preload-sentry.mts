/** @fileoverview Sentry preload entry point for Socket CLI. Initializes error monitoring for production builds in IPC subprocesses. Only runs when INLINED_SOCKET_CLI_SENTRY_BUILD is enabled. */

import { createRequire } from 'node:module'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from './constants.mts'

// Only run this preload script for @socketsecurity/cli-with-sentry in an
// IPC subprocess spawned by Socket CLI
// NODE_CHANNEL_FD is set when spawned with IPC (stdio includes 'ipc')
// SOCKET_CLI_PRELOAD_PHASE is set by Socket CLI when spawning
if (
  constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD &&
  constants.ENV.NODE_CHANNEL_FD &&
  constants.ENV.SOCKET_CLI_PRELOAD_PHASE
) {
  const require = createRequire(import.meta.url)
  const Sentry = /*@__PURE__*/ require('@sentry/node')
  Sentry.init({
    onFatalError(error: Error) {
      // Defer module loads until after Sentry.init is called.
      if (constants.ENV.SOCKET_CLI_DEBUG) {
        logger.fail('[DEBUG] [Sentry onFatalError]:', error)
      }
    },
    dsn: 'https://66736701db8e4ffac046bd09fa6aaced@o555220.ingest.us.sentry.io/4508846967619585',
    enabled: true,
    integrations: [],
  })
  Sentry.setTag(
    'environment',
    constants.ENV.INLINED_SOCKET_CLI_PUBLISHED_BUILD ? 'pub' : constants.ENV.NODE_ENV,
  )
  Sentry.setTag('version', constants.ENV.INLINED_SOCKET_CLI_VERSION_HASH)
  if (constants.ENV.SOCKET_CLI_DEBUG) {
    Sentry.setTag('debugging', true)
    logger.info('[DEBUG] Set up Sentry.')
  } else {
    Sentry.setTag('debugging', false)
  }
  const {
    kInternalsSymbol,
    [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: { setSentry },
  } = constants
  setSentry(Sentry)
}
