// This should ONLY be included in the special Sentry build!
// Otherwise the Sentry dependency won't even be present in the manifest.

import { createRequire } from 'node:module'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from './constants.mts'

if (constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD) {
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
    constants.ENV.INLINED_SOCKET_CLI_PUBLISHED_BUILD
      ? 'pub'
      : constants.ENV.NODE_ENV,
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
} else if (constants.ENV.SOCKET_CLI_DEBUG) {
  logger.info('[DEBUG] Sentry disabled explicitly.')
}
