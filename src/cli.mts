#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from 'node:url'

import meow from 'meow'
import { messageWithCauses, stackWithCauses } from 'pony-cause'
import lookupRegistryAuthToken from 'registry-auth-token'
import lookupRegistryUrl from 'registry-url'
import updateNotifier from 'tiny-updater'

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
    // Lazily access constants.SOCKET_CLI_BIN_NAME.
    name: constants.SOCKET_CLI_BIN_NAME,
    registryUrl,
    ttl: 86_400_000 /* 24 hours in milliseconds */,
    // Lazily access constants.ENV.INLINED_SOCKET_CLI_VERSION.
    version: constants.ENV.INLINED_SOCKET_CLI_VERSION,
  })

  try {
    await meowWithSubcommands(rootCommands, {
      aliases: rootAliases,
      argv: process.argv.slice(2),
      // Lazily access constants.SOCKET_CLI_BIN_NAME.
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
      const cli = meow(``, {
        argv: process.argv.slice(2),
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
      // Bump below any spinner.
      logger.error('\n')
      logger.fail(failMsgWithBadge(errorTitle, errorMessage))
      if (errorBody) {
        debugDir('inspect', { errorBody })
      }
    }

    await captureException(e)
  }
})()
