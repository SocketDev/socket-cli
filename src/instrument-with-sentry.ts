// This should ONLY be included in the special Sentry build!
// Otherwise the Sentry dependency won't even be present in the manifest.

// The '@rollup/plugin-replace' will replace "process.env['SOCKET_CLI_SENTRY_BUILD']".
if (process.env['SOCKET_CLI_SENTRY_BUILD']) {
  const Sentry = require('@sentry/node')
  Sentry.init({
    onFatalError(error: Error) {
      // Defer module loads until after Sentry.init is called.
      if (require('./constants').ENV.SOCKET_CLI_DEBUG) {
        console.error('[DEBUG] [Sentry onFatalError]:', error)
      }
    },
    dsn: 'https://66736701db8e4ffac046bd09fa6aaced@o555220.ingest.us.sentry.io/4508846967619585',
    enabled: true,
    integrations: []
  })
  Sentry.setTag(
    'environment',
    // The '@rollup/plugin-replace' will replace "process.env['SOCKET_CLI_PUBLISHED_BUILD']".
    process.env['SOCKET_CLI_PUBLISHED_BUILD'] ? 'pub' : process.env['NODE_ENV']
  )
  Sentry.setTag(
    'version',
    // The '@rollup/plugin-replace' will replace "process.env['SOCKET_CLI_VERSION_HASH']".
    process.env['SOCKET_CLI_VERSION_HASH']
  )
  const constants = require('./constants')
  if (constants.ENV.SOCKET_CLI_DEBUG) {
    Sentry.setTag('debugging', true)
    console.log('[DEBUG] Set up Sentry.')
  } else {
    Sentry.setTag('debugging', false)
  }
  const {
    kInternalsSymbol,
    [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: { setSentry }
  } = constants
  setSentry(Sentry)
} else if (require('./constants').ENV.SOCKET_CLI_DEBUG) {
  console.log('[DEBUG] Sentry disabled explicitly.')
}
