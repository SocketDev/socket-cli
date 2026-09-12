#!/usr/bin/env node

// Set global Socket theme for consistent CLI branding.
import { isError } from '@socketsecurity/lib-stable/errors/predicates'
import { setTheme } from '@socketsecurity/lib-stable/term/themes/context'

import process from 'node:process'
import url, { fileURLToPath } from 'node:url'

import {
  debug,
  debugDir,
  debugDirNs,
} from '@socketsecurity/lib-stable/debug/output'
import { NPM_REGISTRY_URL } from '@socketsecurity/lib-stable/constants/package-managers'
import { isCI } from '@socketsecurity/lib-stable/env/ci'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { getDefaultSpinner } from '@socketsecurity/lib-stable/spinner/default'

import { rootAliases, rootCommandBuckets, rootCommands } from './commands.mts'
import { SOCKET_CLI_BIN_NAME } from './constants/packages.mts'
import {
  buildRootManifest,
  describeRequest,
  renderDescribe,
} from './util/cli/describe-manifest.mts'
import { getCliName } from './env/cli-name.mts'
import { getCliVersion } from './env/cli-version.mts'
import { SOCKET_CLI_SKIP_UPDATE_CHECK } from './env/socket-cli-skip-update-check.mts'
import { VITEST } from './env/vitest.mts'
import { meow } from './meow.mts'
import { normalizeSbomDirectoryArguments } from './util/cli/sbom-arguments.mts'
import { meowWithSubcommands } from './util/cli/with-subcommands.mts'
import {
  formatErrorForJson,
  formatErrorForTerminal,
} from './util/error/display.mts'
import { serializeResultJson } from './util/output/result-json.mts'
import { runPreflightDownloads } from './util/preflight/downloads.mts'

import {
  finalizeTelemetry,
  setupTelemetryExitHandlers,
  trackCliComplete,
  trackCliError,
  trackCliStart,
} from './util/telemetry/integration.mts'
import { scheduleUpdateCheck } from './util/update/manager.mts'

setTheme('socket')

// Suppress MaxListenersExceeded warning for AbortSignal.
// The Socket SDK properly manages listeners but may exceed the default limit of 30
// during high-concurrency batch operations.
// Bind the captured original so the reference is safe to call standalone
// and clear of the type-aware unbound-method rule.
const originalEmitWarning = process.emitWarning.bind(process)
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
  Reflect.apply(originalEmitWarning, this, [warning, ...args])
}

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)

// Capture CLI start time at module level for global error handlers.
const cliStartTime = Date.now()

// Set up telemetry exit handlers early to catch all exit scenarios.
setupTelemetryExitHandlers()

void (async () => {
  const argv = normalizeSbomDirectoryArguments(process.argv.slice(2))
  if (argv[0] === 'sbom') {
    await dispatchCliCommand(argv)
    return
  }
  // `--describe` answers before ANY side effect — telemetry included: a
  // caller inventorying tools must never show up in usage metrics or wait on
  // an update check.
  const describeKind = describeRequest(process.argv.slice(2))
  if (describeKind) {
    logger.info(
      renderDescribe(
        describeKind,
        buildRootManifest({
          name: SOCKET_CLI_BIN_NAME,
          subcommands: rootCommands,
          version: getCliVersion() || '0.0.0',
        }),
      ).trimEnd(),
    )
    return
  }

  // Track CLI start for telemetry.
  await trackCliStart(process.argv)

  // Skip update checks in test environments or when explicitly disabled.
  // Note: Update checks create HTTP connections that may delay process exit by up to 30s
  // due to keep-alive timeouts. Set SOCKET_CLI_SKIP_UPDATE_CHECK=1 to disable.
  if (!VITEST && !isCI() && !SOCKET_CLI_SKIP_UPDATE_CHECK) {
    // The registry is pinned to the public npm registry rather than resolved
    // from the local `npm config`, so the check answers the same question no
    // matter which directory the CLI runs in — a repo whose .npmrc points at a
    // private mirror that does not carry the socket package used to report "no
    // update" forever.
    // Fire-and-forget: Don't await to avoid blocking on HTTP keep-alive timeouts.
    // scheduleUpdateCheck catches internally, so void can't drop a rejection.
    void scheduleUpdateCheck(
      getCliName() || SOCKET_CLI_BIN_NAME,
      getCliVersion() || '0.0.0',
      { registryUrl: NPM_REGISTRY_URL },
    )

    // Background preflight downloads for optional dependencies.
    // This silently downloads @coana-tech/cli and the
    // Python tooling in the background so they're cached for future use.
    runPreflightDownloads()
  }

  try {
    await dispatchCliCommand(argv)

    // Track successful CLI completion.
    await trackCliComplete(process.argv, cliStartTime, process.exitCode)
  } catch (e) {
    process.exitCode = 1

    // Stop any active spinner before emitting error output, otherwise
    // its animation clashes with the error text on the same line.
    // Spinner-wrapped command paths stop their own on catch, but any
    // exception that bypasses those handlers reaches us here.
    getDefaultSpinner()?.stop()

    // Track CLI error for telemetry.
    await trackCliError(process.argv, cliStartTime, e, process.exitCode)
    debug('CLI uncaught error')
    debugDir(e)

    // Try to parse the flags, find out if --json is set.
    const isJson = (() => {
      const cli = meow({
        argv: process.argv.slice(2),
        // Prevent meow from potentially exiting early.
        autoHelp: false,
        autoVersion: false,
        allowUnknownFlags: true,
        flags: {
          json: { type: 'boolean' },
        },
        importMeta: { url: url.pathToFileURL(__filename).href } as ImportMeta,
      })
      return !!cli.flags.json
    })()

    if (isJson) {
      logger.log(serializeResultJson(formatErrorForJson(e)))
    } else {
      logger.error(formatErrorForTerminal(e))
      debugDirNs('inspect', { error: e })
    }
  }
})().catch(async err => {
  // Fatal error in main async function.
  try {
    logger.error('Fatal error:', err)
  } catch {
    // Last-ditch fallback when logger itself throws — the catch
    // ensures we still report the original error before exit.
    logger.fail('Fatal error:', err) // # socket-lint: allow logger
  }

  // Track CLI error for fatal exceptions.
  await trackCliError(process.argv, cliStartTime, err, 1)

  // Finalize telemetry before fatal exit.
  await finalizeTelemetry()

  process.exit(1)
})

// Handle uncaught exceptions.
process.on('uncaughtException', async err => {
  try {
    try {
      logger.error('Uncaught exception:', err)
    } catch {
      // Last-ditch fallback when logger itself throws.
      logger.fail('Uncaught exception:', err) // # socket-lint: allow logger
    }

    // Track CLI error for uncaught exception.
    await trackCliError(process.argv, cliStartTime, err, 1)

    // Finalize telemetry before exit.
    await finalizeTelemetry()
  } catch (e) {
    // Prevent double unhandled rejection in error handler.
    try {
      logger.error('Error in uncaughtException handler:', e)
    } catch {
      // Last-ditch fallback when logger itself throws.
      logger.fail('Error in uncaughtException handler:', e) // # socket-lint: allow logger
    }
  } finally {
    process.exit(1)
  }
})

// Handle unhandled promise rejections.
process.on('unhandledRejection', async (reason, promise) => {
  try {
    try {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason)
    } catch {
      // Last-ditch fallback when logger itself throws.
      logger.fail('Unhandled rejection at:', promise, 'reason:', reason) // # socket-lint: allow logger
    }

    // Track CLI error for unhandled rejection.
    const error = isError(reason) ? reason : new Error(String(reason))
    await trackCliError(process.argv, cliStartTime, error, 1)

    // Finalize telemetry before exit.
    await finalizeTelemetry()
  } catch (e) {
    // Prevent double unhandled rejection in error handler.
    try {
      logger.error('Error in unhandledRejection handler:', e)
    } catch {
      // Last-ditch fallback when logger itself throws.
      logger.fail('Error in unhandledRejection handler:', e) // # socket-lint: allow logger
    }
  } finally {
    process.exit(1)
  }
})

export async function dispatchCliCommand(
  argv: readonly string[],
): Promise<void> {
  await meowWithSubcommands(
    {
      name: SOCKET_CLI_BIN_NAME,
      argv,
      importMeta: { url: url.pathToFileURL(__filename).href } as ImportMeta,
      subcommands: rootCommands,
    },
    { aliases: rootAliases, buckets: rootCommandBuckets },
  )
}
