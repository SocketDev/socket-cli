#!/usr/bin/env node

/** @fileoverview Main CLI entry point that orchestrates command routing and execution. Integrates with meow for argument parsing and delegates to subcommand modules in src/commands/. */

import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Suppress MaxListenersExceeded warning for AbortSignal
// The Socket SDK properly manages listeners but may exceed the default limit of 30
// during high-concurrency batch operations
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
import lookupRegistryAuthToken from 'registry-auth-token'
import lookupRegistryUrl from 'registry-url'

import { logger } from '@socketsecurity/registry/lib/logger'

import { rootAliases, rootCommands } from './commands.mts'
import constants, { SOCKET_CLI_BIN_NAME } from './constants.mts'
import { debugDir, debugFn } from './utils/debug.mts'
import {
  formatErrorForJson,
  formatErrorForTerminal,
} from './utils/error-display.mts'
import { installErrorFiltering } from './utils/error-filter.mts'
import { captureException } from './utils/errors.mts'
import { meowWithSubcommands } from './utils/meow-with-subcommands.mts'
import { isSeaBinary } from './utils/sea.mts'
import { serializeResultJson } from './utils/serialize-result-json.mts'
import { initStubIpcHandler } from './utils/stub-ipc.mts'
import { scheduleUpdateCheck } from './utils/update-manager.mts'

const __filename = fileURLToPath(import.meta.url)

// Install error filtering to clean up Node.js stack traces
installErrorFiltering()

// Check for --no-log or --json flag early and silence logger if present
// When --json is set, we want clean JSON output without any logger noise
const noLog =
  process.argv.includes('--no-log') ||
  process.argv.includes('--noLog') ||
  process.argv.includes('--json')
if (noLog) {
  // Silence all logger methods
  const noop = () => logger
  logger.log = noop
  logger.info = noop
  logger.success = noop
  logger.warn = noop
  logger.error = noop
  logger.fail = noop
}

// Initialize IPC handler to receive stub path from bootstrap executable
// This must be set up before any async operations to ensure we receive the message
initStubIpcHandler()

void (async () => {
  const registryUrl = lookupRegistryUrl()

  // Skip update checking during tests to prevent cache directory errors and
  // HTTP warnings from contaminating test snapshots.
  const isTestEnvironment =
    process.env['NODE_ENV'] === 'test' ||
    process.env['VITEST'] === '1' ||
    process.env['CI'] === 'true' ||
    process.env['SOCKET_CLI_DEBUG'] === 'false'

  if (!isTestEnvironment) {
    // Unified update notifier handles both SEA and npm automatically.
    await scheduleUpdateCheck({
      authInfo: lookupRegistryAuthToken(registryUrl, { recursive: true }),
      name: isSeaBinary()
        ? SOCKET_CLI_BIN_NAME
        : constants.ENV['INLINED_SOCKET_CLI_NAME'],
      registryUrl,
      version: constants.ENV['INLINED_SOCKET_CLI_VERSION'],
    })
  }

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
    debugFn('error', 'CLI uncaught error')
    debugDir('error', e)

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
      const errorResult = formatErrorForJson(e)
      // Use console.log directly for JSON output to ensure it's not silenced
      console.log(serializeResultJson(errorResult))
    } else {
      // Add 2 newlines in stderr to bump below any spinner.
      logger.error('\n')
      const errorMessage = formatErrorForTerminal(e)
      logger.error(errorMessage)
    }

    await captureException(e)
  }
})()
