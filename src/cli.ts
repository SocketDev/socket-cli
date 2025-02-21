#!/usr/bin/env node

// Keep this on top, no `from`, just init:
import './initialize-crash-handler'

import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { messageWithCauses, stackWithCauses } from 'pony-cause'
import updateNotifier from 'tiny-updater'
import colors from 'yoctocolors-cjs'

import { cmdAction } from './commands/action/cmd-action'
import { cmdAnalytics } from './commands/analytics/cmd-analytics'
import { cmdAuditLog } from './commands/audit-log/cmd-audit-log'
import { cmdCdxgen } from './commands/cdxgen/cmd-cdxgen'
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
import { cmdOrganizations } from './commands/organizations/cmd-organizations'
import { cmdRawNpm } from './commands/raw-npm/cmd-raw-npm'
import { cmdRawNpx } from './commands/raw-npx/cmd-raw-npx'
import { cmdReport } from './commands/report/cmd-report'
import { cmdRepos } from './commands/repos/cmd-repos'
import { cmdScan } from './commands/scan/cmd-scan'
import { cmdThreatFeed } from './commands/threat-feed/cmd-threat-feed'
import { cmdWrapper } from './commands/wrapper/cmd-wrapper'
import constants from './constants'
import { handle } from './handle-crash'
import { AuthError, InputError } from './utils/errors'
import { logSymbols } from './utils/logging'
import { meowWithSubcommands } from './utils/meow-with-subcommands'

const { rootPkgJsonPath } = constants

// TODO: Add autocompletion using https://socket.dev/npm/package/omelette
void (async () => {
  await updateNotifier({
    name: 'socket',
    version: require(rootPkgJsonPath).version,
    ttl: 86_400_000 /* 24 hours in milliseconds */
  })

  try {
    await meowWithSubcommands(
      {
        action: cmdAction,
        cdxgen: cmdCdxgen,
        fix: cmdFix,
        info: cmdInfo,
        login: cmdLogin,
        logout: cmdLogout,
        npm: cmdNpm,
        npx: cmdNpx,
        oops: cmdOops,
        optimize: cmdOptimize,
        organization: cmdOrganizations,
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
        aliases: {
          ci: {
            description: 'Alias for "report create --view --strict"',
            argv: ['report', 'create', '--view', '--strict']
          }
        },
        argv: process.argv.slice(2),
        name: 'socket',
        importMeta: { url: `${pathToFileURL(__filename)}` } as ImportMeta
      }
    )
  } catch (err) {
    let errorBody: string | undefined
    let errorTitle: string
    let errorMessage = ''
    if (err instanceof AuthError) {
      errorTitle = 'Authentication error'
      errorMessage = err.message
    } else if (err instanceof InputError) {
      errorTitle = 'Invalid input'
      errorMessage = err.message
      errorBody = err.body
    } else if (err instanceof Error) {
      errorTitle = 'Unexpected error'
      errorMessage = messageWithCauses(err)
      errorBody = stackWithCauses(err)
    } else {
      errorTitle = 'Unexpected error with no details'
    }
    console.error(
      `${logSymbols.error} ${colors.bgRed(colors.white(errorTitle + ':'))} ${errorMessage}`
    )
    if (errorBody) {
      console.error(`\n${errorBody}`)
    }

    process.exitCode = 1

    await handle(err)
  }
})()
