import updateNotifier from 'tiny-updater'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../constants.mts'
import { socketPackageLink } from './terminal-link.mts'

// Check the public npm registry for a newer socket release.
export async function runSelfUpdateCheck(): Promise<void> {
  await updateNotifier({
    name: constants.SOCKET_CLI_BIN_NAME,
    registryUrl: 'https://registry.npmjs.org/',
    ttl: 86_400_000 /* 24 hours in milliseconds */,
    version: constants.ENV.INLINED_SOCKET_CLI_VERSION,
    logCallback: (name: string, version: string, latest: string) => {
      logger.log(
        `\n\n📦 Update available for ${colors.cyan(name)}: ${colors.gray(version)} → ${colors.green(latest)}`,
      )
      logger.log(
        `📝 ${socketPackageLink('npm', name, `files/${latest}/CHANGELOG.md`, 'View changelog')}`,
      )
    },
  })
}
