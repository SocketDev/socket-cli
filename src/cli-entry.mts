#!/usr/bin/env node

// Load Intl polyfill for --with-intl=none builds.
import './polyfills/intl-stub.mts'

import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

import { debug, debugDir } from '@socketsecurity/lib/debug'
import { logger } from '@socketsecurity/lib/logger'
import { messageWithCauses, stackWithCauses } from 'pony-cause'
import lookupRegistryAuthToken from 'registry-auth-token'
import lookupRegistryUrl from 'registry-url'

import { rootAliases, rootCommands } from './commands.mts'
import ENV from './constants/env.mts'
import { SOCKET_CLI_BIN_NAME } from './constants/packages.mts'
import meow from './meow.mts'
import { meowWithSubcommands } from './utils/cli/with-subcommands.mts'
import {
  AuthError,
  captureException,
  InputError,
} from './utils/error/errors.mts'
import { failMsgWithBadge } from './utils/error/fail-msg-with-badge.mts'
import { isSeaBinary } from './utils/executable/detect.mts'
import { serializeResultJson } from './utils/output/result-json.mts'
import { scheduleUpdateCheck } from './utils/update/manager.mts'

const __filename = fileURLToPath(import.meta.url)

void (async () => {
  const registryUrl = lookupRegistryUrl()

  // Unified update notifier handles both SEA and npm automatically.
  await scheduleUpdateCheck({
    authInfo: lookupRegistryAuthToken(registryUrl, { recursive: true }),
    name: isSeaBinary()
      ? SOCKET_CLI_BIN_NAME
      : ENV.INLINED_SOCKET_CLI_NAME || SOCKET_CLI_BIN_NAME,
    registryUrl,
    version: ENV.INLINED_SOCKET_CLI_VERSION || '0.0.0',
  })

  try {
    await meowWithSubcommands(
      {
        name: SOCKET_CLI_BIN_NAME,
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
