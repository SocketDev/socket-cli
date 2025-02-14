#!/usr/bin/env node

import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { messageWithCauses, stackWithCauses } from 'pony-cause'
import updateNotifier from 'tiny-updater'
import colors from 'yoctocolors-cjs'

import { actionCommand } from './commands/action'
import { analyticsCommand } from './commands/analytics/analytics-command'
import { auditLogCommand } from './commands/audit-log'
import { cdxgenCommand } from './commands/cdxgen'
import { dependenciesCommand } from './commands/dependencies'
import { diffScanCommand } from './commands/diff-scan'
import { fixCommand } from './commands/fix'
import { infoCommand } from './commands/info'
import { loginCommand } from './commands/login'
import { logoutCommand } from './commands/logout'
import { cmdManifest } from './commands/manifest/cmd-manifest.ts'
import { npmCommand } from './commands/npm'
import { npxCommand } from './commands/npx'
import { optimizeCommand } from './commands/optimize'
import { organizationCommand } from './commands/organization'
import { rawNpmCommand } from './commands/raw-npm'
import { rawNpxCommand } from './commands/raw-npx'
import { reportCommand } from './commands/report'
import { reposCommand } from './commands/repos'
import { cmdScan } from './commands/scan/cmd-scan.ts'
import { threatFeedCommand } from './commands/threat-feed'
import { wrapperCommand } from './commands/wrapper'
import constants from './constants'
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
        action: actionCommand,
        cdxgen: cdxgenCommand,
        fix: fixCommand,
        info: infoCommand,
        login: loginCommand,
        logout: logoutCommand,
        npm: npmCommand,
        npx: npxCommand,
        optimize: optimizeCommand,
        organization: organizationCommand,
        'raw-npm': rawNpmCommand,
        'raw-npx': rawNpxCommand,
        report: reportCommand,
        wrapper: wrapperCommand,
        scan: cmdScan,
        'audit-log': auditLogCommand,
        repos: reposCommand,
        dependencies: dependenciesCommand,
        analytics: analyticsCommand,
        'diff-scan': diffScanCommand,
        'threat-feed': threatFeedCommand,
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
    process.exit(1)
  }
})()
