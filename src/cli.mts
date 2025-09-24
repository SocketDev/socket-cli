#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from 'node:url'

import meow from 'meow'
import { messageWithCauses, stackWithCauses } from 'pony-cause'
import lookupRegistryAuthToken from 'registry-auth-token'
import lookupRegistryUrl from 'registry-url'
import colors from 'yoctocolors-cjs'

import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { rootAliases, rootCommands } from './commands.mts'
import constants, { CHANGELOG_MD, NPM, SOCKET_CLI_BIN_NAME, SOCKET_CLI_GITHUB_REPO, SOCKET_GITHUB_ORG } from './constants.mts'
import { AuthError, InputError, captureException } from './utils/errors.mts'
import { failMsgWithBadge } from './utils/fail-msg-with-badge.mts'
import { meowWithSubcommands } from './utils/meow-with-subcommands.mts'
import { isSeaBinary } from './utils/sea.mts'
import { serializeResultJson } from './utils/serialize-result-json.mts'
import { githubRepoLink, socketPackageLink } from './utils/terminal-link.mts'
import { seaUpdateNotifier, updateNotifier } from './utils/tiny-updater.mts'

const __filename = fileURLToPath(import.meta.url)

void (async () => {
  const registryUrl = lookupRegistryUrl()
  const isSeaBinaryRuntime = isSeaBinary()

  // Use correct package name based on runtime context.
  const packageName = isSeaBinaryRuntime
    ? SOCKET_CLI_BIN_NAME
    : constants.ENV.INLINED_SOCKET_CLI_NAME

  // Shared options for update notifier.
  const commonOptions = {
    authInfo: lookupRegistryAuthToken(registryUrl, { recursive: true }),
    logCallback: (name: string, version: string, latest: string) => {
      logger.log(
        `\n\n📦 Update available for ${colors.cyan(name)}: ${colors.gray(version)} → ${colors.green(latest)}`,
      )
      const linkText = 'View changelog'
      const changelogLink = isSeaBinaryRuntime
        ? socketPackageLink(NPM, name, `files/${latest}/${CHANGELOG_MD}`, linkText)
        : githubRepoLink(SOCKET_GITHUB_ORG, SOCKET_CLI_GITHUB_REPO, `blob/${latest}/${CHANGELOG_MD}`, linkText)
      logger.log(`📝 ${changelogLink}`)
    },
    name: packageName,
    registryUrl,
    // 24 hours in milliseconds.
    ttl: 86_400_000 ,
    version: constants.ENV.INLINED_SOCKET_CLI_VERSION,
  }

  // Use SEA-aware updater when running as SEA binary.
  if (isSeaBinaryRuntime) {
    await seaUpdateNotifier({
      ...commonOptions,
      isSEABinary: true,
      seaBinaryPath: process.argv[0],
      updateCommand: 'self-update',
      ipcChannel: process.env['SOCKET_IPC_CHANNEL'],
    })
  } else {
    await updateNotifier(commonOptions)
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
