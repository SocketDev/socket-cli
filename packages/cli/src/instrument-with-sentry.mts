// This should ONLY be included in the special Sentry build!
// Otherwise the Sentry dependency won't even be present in the manifest.

import { createRequire } from 'node:module'

import { kInternalsSymbol } from '@socketsecurity/lib/constants/core'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import ENV from './constants/env.mts'

if (ENV.INLINED_SOCKET_CLI_SENTRY_BUILD) {
  const require = createRequire(import.meta.url)
  const Sentry = /*@__PURE__*/ require('@sentry/node')
  Sentry.init({
    onFatalError(error: Error) {
      // Defer module loads until after Sentry.init is called.
      if (ENV.SOCKET_CLI_DEBUG) {
        getDefaultLogger().fail('[DEBUG] [Sentry onFatalError]:', error)
      }
    },
    dsn: 'https://66736701db8e4ffac046bd09fa6aaced@o555220.ingest.us.sentry.io/4508846967619585',
    enabled: true,
    integrations: [],
  })
  Sentry.setTag(
    'environment',
    ENV.INLINED_SOCKET_CLI_PUBLISHED_BUILD ? 'pub' : ENV.NODE_ENV,
  )
  Sentry.setTag('version', ENV.INLINED_SOCKET_CLI_VERSION_HASH)
  if (ENV.SOCKET_CLI_DEBUG) {
    Sentry.setTag('debugging', true)
    getDefaultLogger().info('[DEBUG] Set up Sentry.')
  } else {
    Sentry.setTag('debugging', false)
  }
  const internals = (global as any)[kInternalsSymbol]
  if (internals?.setSentry) {
    internals.setSentry(Sentry)
  }
} else if (ENV.SOCKET_CLI_DEBUG) {
  getDefaultLogger().info('[DEBUG] Sentry disabled explicitly.')
}
