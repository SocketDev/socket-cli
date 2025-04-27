// This should ONLY be included in the special Sentry build!
// Otherwise the Sentry dependency won't even be present in the manifest.

import { logger } from '@socketsecurity/registry/lib/logger'

// Require constants with require(relConstantsPath) instead of require('./constants')
// so Rollup doesn't generate a constants2.js chunk.
const relConstantsPath = './constants'
const constants = require(relConstantsPath)

// Lazily access constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD.
if (constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD) {
  const Sentry = require('@sentry/node')
  Sentry.init({
    onFatalError(error: Error) {
      // Defer module loads until after Sentry.init is called.
      if (constants.ENV.SOCKET_CLI_DEBUG) {
        logger.fail('[DEBUG] [Sentry onFatalError]:', error)
      }
    },
    dsn: 'https://66736701db8e4ffac046bd09fa6aaced@o555220.ingest.us.sentry.io/4508846967619585',
    enabled: true,
    integrations: []
  })
  Sentry.setTag(
    'environment',
    // Lazily access constants.ENV.INLINED_SOCKET_CLI_PUBLISHED_BUILD.
    constants.ENV.INLINED_SOCKET_CLI_PUBLISHED_BUILD
      ? 'pub'
      : // Lazily access constants.ENV.NODE_ENV.
        constants.ENV.NODE_ENV
  )
  Sentry.setTag(
    'version',
    // Lazily access constants.ENV.INLINED_SOCKET_CLI_VERSION_HASH.
    constants.ENV.INLINED_SOCKET_CLI_VERSION_HASH
  )
  // Lazily access constants.ENV.SOCKET_CLI_DEBUG.
  if (constants.ENV.SOCKET_CLI_DEBUG) {
    Sentry.setTag('debugging', true)
    logger.log('[DEBUG] Set up Sentry.')
  } else {
    Sentry.setTag('debugging', false)
  }
  const {
    kInternalsSymbol,
    [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: { setSentry }
  } = constants
  setSentry(Sentry)
}
// Lazily access constants.ENV.SOCKET_CLI_DEBUG.
else if (constants.ENV.SOCKET_CLI_DEBUG) {
  logger.log('[DEBUG] Sentry disabled explicitly.')
}
