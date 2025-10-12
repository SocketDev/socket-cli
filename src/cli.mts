#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'

// Suppress MaxListenersExceeded warning for AbortSignal.
// The Socket SDK properly manages listeners but may exceed the default limit of 30
// during high-concurrency batch operations.
const originalEmitWarning = process.emitWarning
process.emitWarning = function (warning, ...args) {
  if (
    (typeof warning === 'string' &&
      warning.includes('MaxListenersExceededWarning') &&
      warning.includes('AbortSignal')) ||
    (args[0] === 'MaxListenersExceededWarning' &&
      typeof warning === 'string' &&
      warning.includes('AbortSignal'))
  ) {
    // Suppress the specific MaxListenersExceeded warning for AbortSignal.
    return
  }
  return Reflect.apply(originalEmitWarning, this, [warning, ...args])
}

import meow from 'meow'
import { messageWithCauses, stackWithCauses } from 'pony-cause'
import lookupRegistryAuthToken from 'registry-auth-token'
import lookupRegistryUrl from 'registry-url'

import { debugDir, debug } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { rootAliases, rootCommands } from './commands.mts'
import constants, { SOCKET_CLI_BIN_NAME } from './constants.mts'
import { AuthError, InputError, captureException } from './utils/errors.mts'
import { failMsgWithBadge } from './utils/fail-msg-with-badge.mts'
import { meowWithSubcommands } from './utils/meow-with-subcommands.mts'
import { isSeaBinary } from './utils/sea.mts'
import { serializeResultJson } from './utils/serialize-result-json.mts'
import { scheduleUpdateCheck } from './utils/update-manager.mts'

const __filename = fileURLToPath(import.meta.url)

void (async () => {
  const registryUrl = lookupRegistryUrl()

  // Unified update notifier handles both SEA and npm automatically.
  await scheduleUpdateCheck({
    authInfo: lookupRegistryAuthToken(registryUrl, { recursive: true }),
    name: isSeaBinary()
      ? SOCKET_CLI_BIN_NAME
      : constants.ENV.INLINED_SOCKET_CLI_NAME,
    registryUrl,
    version: constants.ENV.INLINED_SOCKET_CLI_VERSION,
  })

  try {
    await meowWithSubcommands(
      {
        name: constants.SOCKET_CLI_BIN_NAME,
        argv: process.argv.slice(2),
        importMeta: { url: `${pathToFileURL(__filename)}` } as ImportMeta,
        subcommands: rootCommands,
      },
      { aliases: rootAliases },
    )
  } catch (e) {
    process.exitCode = 1
    debug('CLI uncaught error')
    debugDir(e)

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
