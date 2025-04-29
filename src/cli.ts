#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

import { messageWithCauses, stackWithCauses } from 'pony-cause'
import updateNotifier from 'tiny-updater'

import { debugLog } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { cmdAnalytics } from './commands/analytics/cmd-analytics'
import { cmdAuditLog } from './commands/audit-log/cmd-audit-log'
import { cmdCdxgen } from './commands/cdxgen/cmd-cdxgen'
import { cmdCI } from './commands/ci/cmd-ci'
import { cmdConfig } from './commands/config/cmd-config'
import { cmdScanCreate } from './commands/dependencies/cmd-dependencies'
import { cmdDiffScan } from './commands/diff-scan/cmd-diff-scan'
import { cmdFix } from './commands/fix/cmd-fix'
import { cmdInfo } from './commands/info/cmd-info'
import { cmdLogin } from './commands/login/cmd-login'
import { cmdLogout } from './commands/logout/cmd-logout'
import { cmdManifest } from './commands/manifest/cmd-manifest'
import { cmdNpm } from './commands/npm/cmd-npm'
import { cmdNpx } from './commands/npx/cmd-npx'
import { cmdOops } from './commands/oops/cmd-oops'
import { cmdOptimize } from './commands/optimize/cmd-optimize'
import { cmdOrganization } from './commands/organization/cmd-organization'
import { cmdPackage } from './commands/package/cmd-package'
import { cmdRawNpm } from './commands/raw-npm/cmd-raw-npm'
import { cmdRawNpx } from './commands/raw-npx/cmd-raw-npx'
import { cmdReport } from './commands/report/cmd-report'
import { cmdRepos } from './commands/repos/cmd-repos'
import { cmdScan } from './commands/scan/cmd-scan'
import { cmdThreatFeed } from './commands/threat-feed/cmd-threat-feed'
import { cmdWrapper } from './commands/wrapper/cmd-wrapper'
import constants from './constants'
import { AuthError, InputError, captureException } from './utils/errors'
import { failMsgWithBadge } from './utils/fail-msg-with-badge'
import { meowWithSubcommands } from './utils/meow-with-subcommands'

const { SOCKET_CLI_BIN_NAME } = constants

// TODO: Add autocompletion using https://socket.dev/npm/package/omelette
void (async () => {
  await updateNotifier({
    name: SOCKET_CLI_BIN_NAME,
    // Lazily access constants.ENV.INLINED_SOCKET_CLI_VERSION.
    version: constants.ENV.INLINED_SOCKET_CLI_VERSION,
    ttl: 86_400_000 /* 24 hours in milliseconds */
  })

  try {
    await meowWithSubcommands(
      {
        cdxgen: cmdCdxgen,
        ci: cmdCI,
        config: cmdConfig,
        fix: cmdFix,
        info: cmdInfo,
        login: cmdLogin,
        logout: cmdLogout,
        npm: cmdNpm,
        npx: cmdNpx,
        oops: cmdOops,
        optimize: cmdOptimize,
        organization: cmdOrganization,
        package: cmdPackage,
        'raw-npm': cmdRawNpm,
        'raw-npx': cmdRawNpx,
        report: cmdReport,
        wrapper: cmdWrapper,
        scan: cmdScan,
        'audit-log': cmdAuditLog,
        repos: cmdRepos,
        dependencies: cmdScanCreate,
        analytics: cmdAnalytics,
        'diff-scan': cmdDiffScan,
        'threat-feed': cmdThreatFeed,
        manifest: cmdManifest
      },
      {
        aliases: {},
        argv: process.argv.slice(2),
        name: SOCKET_CLI_BIN_NAME,
        importMeta: { url: `${pathToFileURL(__filename)}` } as ImportMeta
      }
    )
  } catch (e) {
    process.exitCode = 1
    let errorBody: string | undefined
    let errorTitle: string
    let errorMessage = ''
    if (e instanceof AuthError) {
      errorTitle = 'Authentication error'
      errorMessage = e.message
    } else if (e instanceof InputError) {
      errorTitle = 'Invalid input'
      errorMessage = e.message
      errorBody = e.body
    } else if (e instanceof Error) {
      errorTitle = 'Unexpected error'
      errorMessage = messageWithCauses(e)
      errorBody = stackWithCauses(e)
    } else {
      errorTitle = 'Unexpected error with no details'
    }
    logger.error('\n') // Any-spinner-newline
    logger.fail(failMsgWithBadge(errorTitle, errorMessage))
    if (errorBody) {
      debugLog(`${errorBody}`)
    }
    await captureException(e)
  }
})()
