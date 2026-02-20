// This should ONLY be included in the special Sentry build!
// Otherwise the Sentry dependency won't even be present in the manifest.

import { createRequire } from 'node:module'

import { kInternalsSymbol } from '@socketsecurity/lib/constants/core'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { getCliVersionHash } from './env/cli-version-hash.mts'
import { isPublishedBuild } from './env/is-published-build.mts'
import { isSentryBuild } from './env/is-sentry-build.mts'
import { NODE_ENV } from './env/node-env.mts'
import { SOCKET_CLI_DEBUG } from './env/socket-cli-debug.mts'

const logger = getDefaultLogger()

if (isSentryBuild()) {
  const require = createRequire(import.meta.url)
  const Sentry = /*@__PURE__*/ require('@sentry/node')
  Sentry.init({
    onFatalError(error: Error) {
      // Defer module loads until after Sentry.init is called.
      if (SOCKET_CLI_DEBUG) {
        logger.fail('[DEBUG] [Sentry onFatalError]:', error)
      }
    },
    dsn: 'https://66736701db8e4ffac046bd09fa6aaced@o555220.ingest.us.sentry.io/4508846967619585',
    enabled: true,
    integrations: [],
  })
  Sentry.setTag('environment', isPublishedBuild() ? 'pub' : NODE_ENV)
  Sentry.setTag('version', getCliVersionHash())
  if (SOCKET_CLI_DEBUG) {
    Sentry.setTag('debugging', true)
    logger.info('[DEBUG] Set up Sentry.')
  } else {
    Sentry.setTag('debugging', false)
  }
  const internals = (global as any)[kInternalsSymbol]
  if (internals?.setSentry) {
    internals.setSentry(Sentry)
  }
} else if (SOCKET_CLI_DEBUG) {
  logger.info('[DEBUG] Sentry disabled explicitly.')
}
