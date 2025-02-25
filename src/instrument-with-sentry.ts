// This should ONLY be included in the special Sentry build!
// Otherwise the Sentry dependency won't even be present in the manifest.

// @ts-ignore
import Sentry from '@sentry/node'

import constants from './constants'

const {
  kInternalsSymbol,
  [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: { setSentry }
} = constants

const debugging = constants.ENV.SOCKET_CLI_DEBUG

// The '@rollup/plugin-replace' will replace 'process.env.SOCKET_IS_SENTRY_BUILD'.
if (process.env['SOCKET_IS_SENTRY_BUILD']) {
  setSentry(Sentry)
  if (debugging) {
    console.log('[DEBUG] Setting up Sentry...')
  }
  Sentry.init({
    onFatalError(error: Error) {
      if (debugging) {
        console.error('[DEBUG] [Sentry onFatalError]:', error)
      }
    },
    dsn: 'https://66736701db8e4ffac046bd09fa6aaced@o555220.ingest.us.sentry.io/4508846967619585',
    enabled: true,
    integrations: []
  })
  Sentry.setTag(
    'environment',
    // The '@rollup/plugin-replace' will replace 'process.env.SOCKET_IS_PUBLISHED_BUILD'.
    process.env['SOCKET_IS_PUBLISHED_BUILD'] ? 'pub' : process.env['NODE_ENV']
  )
  Sentry.setTag('debugging', debugging)
  Sentry.setTag(
    'version',
    // The '@rollup/plugin-replace' will replace 'process.env.SOCKET_CLI_VERSION'.
    process.env['SOCKET_CLI_VERSION']
  )
  if (debugging) {
    console.log('[DEBUG] Set up Sentry.')
  }
} else if (debugging) {
  console.log('[DEBUG] Sentry disabled explicitly.')
}
