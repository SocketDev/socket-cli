#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from 'node:url'

import meow from 'meow'
import { messageWithCauses, stackWithCauses } from 'pony-cause'
import lookupRegistryAuthToken from 'registry-auth-token'
import lookupRegistryUrl from 'registry-url'
import terminalLink from 'terminal-link'
import updateNotifier from 'tiny-updater'
import colors from 'yoctocolors-cjs'

import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { rootAliases, rootCommands } from './commands.mts'
import constants from './constants.mts'
import { AuthError, InputError, captureException } from './utils/errors.mts'
import { failMsgWithBadge } from './utils/fail-msg-with-badge.mts'
import { meowWithSubcommands } from './utils/meow-with-subcommands.mts'
import { serializeResultJson } from './utils/serialize-result-json.mts'

const __filename = fileURLToPath(import.meta.url)

void (async () => {
  const registryUrl = lookupRegistryUrl()
  await updateNotifier({
    authInfo: lookupRegistryAuthToken(registryUrl, { recursive: true }),
    name: constants.SOCKET_CLI_BIN_NAME,
    registryUrl,
    ttl: 86_400_000 /* 24 hours in milliseconds */,
    version: constants.ENV.INLINED_SOCKET_CLI_VERSION,
    logCallback: (name: string, version: string, latest: string) => {
      logger.log(
        `\n\n📦 Update available for ${colors.cyan(name)}: ${colors.gray(version)} → ${colors.green(latest)}`,
      )
      logger.log(
        `📝 ${terminalLink(
          'View changelog',
          `https://socket.dev/npm/package/${name}/files/${latest}/CHANGELOG.md`,
        )}`,
      )
    },
  })

  try {
    await meowWithSubcommands(rootCommands, {
      aliases: rootAliases,
      argv: process.argv.slice(2),
      name: constants.SOCKET_CLI_BIN_NAME,
      importMeta: { url: `${pathToFileURL(__filename)}` } as ImportMeta,
    })
  } catch (e) {
    process.exitCode = 1
    debugFn('error', 'Uncaught error (BAD!):')
    debugDir('inspect', { error: e })

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

    // Try to parse the flags, find out if --json is set.
    const isJson = (() => {
      const cli = meow({
        argv: process.argv.slice(2),
        // Prevent meow from potentially exiting early.
        autoHelp: false,
        autoVersion: false,
        flags: {},
        importMeta: { url: `${pathToFileURL(__filename)}` } as ImportMeta,
      })
      return !!cli.flags['json']
    })()

    if (isJson) {
      logger.log(
        serializeResultJson({
          ok: false,
          message: errorTitle,
          cause: errorMessage,
        }),
      )
    } else {
      // Add 2 newlines in stderr to bump below any spinner.
      logger.error('\n')
      logger.fail(failMsgWithBadge(errorTitle, errorMessage))
      if (errorBody) {
        debugDir('inspect', { errorBody })
      }
    }

    await captureException(e)
  }
})()
