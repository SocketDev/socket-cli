import updateNotifier from 'tiny-updater'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../constants.mts'
import { isStandaloneSea } from '../sea/runtime.mts'

/** Format a release notice for the current Socket distribution. */
export function formatUpdateNotice(current: string, latest: string): string {
  return isStandaloneSea()
    ? `Socket ${current} → ${latest}. Run: socket update`
    : `Socket ${current} → ${latest}. Update with your favorite package manager.`
}

// Check the public npm registry for a newer socket release.
export async function runSelfUpdateCheck(): Promise<void> {
  // Match the conventional opt-out used by update notifiers.
  if (process.env['NO_UPDATE_NOTIFIER']) {
    return
  }

  // A standalone executable cannot be updated through the npm package path.
  // Keep its startup independent from registry metadata and avoid suggesting
  // that an npm CLI update can replace this artifact.
  if (isStandaloneSea()) {
    return
  }

  await updateNotifier({
    name: constants.SOCKET_CLI_BIN_NAME,
    registryUrl: 'https://registry.npmjs.org/',
    ttl:
      process.env['SOCKET_CLI_FORCE_UPDATE_NOTIFIER'] === '1'
        ? 0
        : 86_400_000 /* 24 hours in milliseconds */,
    version: constants.ENV.INLINED_SOCKET_CLI_VERSION,
    logCallback: (_name: string, version: string, latest: string) => {
      logger.log(formatUpdateNotice(version, latest))
    },
  })
}
