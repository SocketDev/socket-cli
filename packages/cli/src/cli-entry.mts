#!/usr/bin/env node

// Set global Socket theme for consistent CLI branding.
import { setTheme } from '@socketsecurity/lib/themes'
setTheme('socket')

import path from 'node:path'
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

import { messageWithCauses, stackWithCauses } from 'pony-cause'
import lookupRegistryAuthToken from 'registry-auth-token'
import lookupRegistryUrl from 'registry-url'

import { debug as debugNs, debugDir, debugDirNs } from '@socketsecurity/lib/debug'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

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
import { serializeResultJson } from './utils/output/result-json.mts'
import { runPreflightDownloads } from './utils/preflight/downloads.mts'
import { isSeaBinary } from './utils/sea/detect.mts'
import { scheduleUpdateCheck } from './utils/update/manager.mts'

import { dlxManifest } from '@socketsecurity/lib/dlx/manifest'

const logger = getDefaultLogger()

// Debug logger for manifest operations.
const debug = debugNs

const __filename = fileURLToPath(import.meta.url)

/**
 * Write manifest entry for CLI installed via bootstrap.
 * Bootstrap passes spec and cache dir via environment variables.
 */
async function writeBootstrapManifestEntry(): Promise<void> {
  const spec = ENV.SOCKET_CLI_BOOTSTRAP_SPEC
  const cacheDir = ENV.SOCKET_CLI_BOOTSTRAP_CACHE_DIR

  if (!spec || !cacheDir) {
    // Not launched via bootstrap, skip.
    return
  }

  try {
    // Extract cache key from path (last segment)
    const cacheKey = path.basename(cacheDir)

    // Read package.json to get installed version
    const pkgJsonPath = path.join(
      cacheDir,
      'node_modules',
      '@socketsecurity',
      'cli',
      'package.json',
    )

    let installedVersion = '0.0.0'
    try {
      const fs = await import('node:fs/promises')
      const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8'))
      installedVersion = pkgJson.version || '0.0.0'
    } catch {
      // Failed to read version, use default
    }

    // Write manifest entry.
    await dlxManifest.setPackageEntry(spec, cacheKey, {
      installed_version: installedVersion,
    })
  } catch (error) {
    // Silently ignore manifest write errors - not critical
    debug(`Failed to write bootstrap manifest entry: ${error}`)
  }
}

void (async () => {
  // Skip update checks in test environments or when explicitly disabled.
  // Note: Update checks create HTTP connections that may delay process exit by up to 30s
  // due to keep-alive timeouts. Set SOCKET_CLI_SKIP_UPDATE_CHECK=1 to disable.
  if (!ENV.VITEST && !ENV.CI && !ENV.SOCKET_CLI_SKIP_UPDATE_CHECK) {
    const registryUrl = lookupRegistryUrl()
    // Unified update notifier handles both SEA and npm automatically.
    // Fire-and-forget: Don't await to avoid blocking on HTTP keep-alive timeouts.
    scheduleUpdateCheck({
      authInfo: lookupRegistryAuthToken(registryUrl, { recursive: true }),
      name: isSeaBinary()
        ? SOCKET_CLI_BIN_NAME
        : ENV.INLINED_SOCKET_CLI_NAME || SOCKET_CLI_BIN_NAME,
      registryUrl,
      version: ENV.INLINED_SOCKET_CLI_VERSION || '0.0.0',
    })

    // Write manifest entry if launched via bootstrap (SEA/smol).
    // Bootstrap passes spec and cache dir via env vars.
    // Fire-and-forget: Don't await to avoid blocking.
    writeBootstrapManifestEntry()

    // Background preflight downloads for optional dependencies.
    // This silently downloads @coana-tech/cli and @socketbin/cli-ai in the
    // background to ensure they're cached for future use.
    runPreflightDownloads()
  }

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
        debugDirNs('inspect', { errorBody })
      }
    }

    await captureException(e)
  }
})()
