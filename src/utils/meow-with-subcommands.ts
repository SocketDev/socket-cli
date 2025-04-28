import path from 'node:path'
import process from 'node:process'

import meow from 'meow'
import semver from 'semver'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'
import { toSortedObject } from '@socketsecurity/registry/lib/objects'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'

import { getLastFiveOfApiToken } from './api'
import {
  getConfigValue,
  isReadOnlyConfig,
  isTestingV1,
  overrideCachedConfig,
  overrideConfigApiToken
} from './config'
import { getFlagListOutput, getHelpListOutput } from './output-formatting'
import constants from '../constants'
import { MeowFlags, commonFlags } from '../flags'
import { getDefaultToken } from './sdk'

import type { Options } from 'meow'

interface CliAlias {
  description: string
  argv: readonly string[]
  hidden?: boolean | undefined
}

type CliAliases = Record<string, CliAlias>

type CliSubcommandRun = (
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  context: { parentName: string }
) => Promise<void> | void

export interface CliSubcommand {
  description: string
  hidden?: boolean | undefined
  run: CliSubcommandRun
}

// Property names are picked such that the name is at the top when the props
// get ordered by alphabet while flags is near the bottom and the help text
// at the bottom, because they tend ot occupy the most lines of code.
export interface CliCommandConfig {
  commandName: string // tmp optional while we migrate
  description: string
  hidden: boolean
  flags: MeowFlags // tmp optional while we migrate
  help: (command: string, config: CliCommandConfig) => string
}

interface MeowOptions extends Options<any> {
  aliases?: CliAliases | undefined
  argv: readonly string[]
  name: string
  // When no sub-command is given, default to this sub-command
  defaultSub?: string
}

// For debugging. Whenever you call meowOrExit it will store the command here
// This module exports a getter that returns the current value.
let lastSeenCommand = ''

export function getLastSeenCommand(): string {
  return lastSeenCommand
}

export async function meowWithSubcommands(
  subcommands: Record<string, CliSubcommand>,
  options: MeowOptions
): Promise<void> {
  const {
    aliases = {},
    argv,
    defaultSub,
    importMeta,
    name,
    ...additionalOptions
  } = { __proto__: null, ...options }
  const [commandOrAliasName_, ...rawCommandArgv] = argv
  let commandOrAliasName = commandOrAliasName_
  if (!commandOrAliasName && defaultSub) {
    commandOrAliasName = defaultSub
  }

  const flags: MeowFlags = {
    ...commonFlags,
    ...additionalOptions.flags
  }

  // No further args or first arg is a flag (shrug)
  if (
    name === 'socket' &&
    (!commandOrAliasName || commandOrAliasName?.startsWith('-'))
  ) {
    flags['dryRun'] = {
      type: 'boolean',
      default: false,
      hidden: false, // Only show on root
      description:
        'Do input validation for a command and exit 0 when input is ok. Every command should support this flag (not shown on help screens)'
    }
  }

  const cli = meow(
    `
    Usage
      $ ${name} <command>

    Commands
      ${getHelpListOutput(
        {
          ...toSortedObject(
            Object.fromEntries(
              Object.entries(subcommands).filter(
                ({ 1: subcommand }) => !subcommand.hidden
              )
            )
          ),
          ...toSortedObject(
            Object.fromEntries(
              Object.entries(aliases).filter(({ 1: alias }) => {
                const { hidden } = alias
                const cmdName = hidden ? '' : alias.argv[0]
                const subcommand = cmdName ? subcommands[cmdName] : undefined
                return subcommand && !subcommand.hidden
              })
            )
          )
        },
        6
      )}

    Options
      ${getFlagListOutput(flags, 6)}

    Examples
      $ ${name} --help
  `,
    {
      argv,
      importMeta,
      ...additionalOptions,
      flags,
      // Do not strictly check for flags here.
      allowUnknownFlags: true,
      // We will emit help when we're ready
      // Plus, if we allow this then meow() can just exit here.
      autoHelp: false
    }
  )

  // Hard override the config if instructed to do so.
  // The env var overrides the --flag, which overrides the persisted config
  // Also, when either of these are used, config updates won't persist.
  let configOverrideResult
  // Lazily access constants.ENV.SOCKET_CLI_CONFIG.
  if (constants.ENV.SOCKET_CLI_CONFIG) {
    configOverrideResult = overrideCachedConfig(
      // Lazily access constants.ENV.SOCKET_CLI_CONFIG.
      constants.ENV.SOCKET_CLI_CONFIG
    )
  } else if (cli.flags['config']) {
    configOverrideResult = overrideCachedConfig(
      String(cli.flags['config'] || '')
    )
  }

  // Lazily access constants.ENV.SOCKET_CLI_NO_API_TOKEN.
  if (constants.ENV.SOCKET_CLI_NO_API_TOKEN) {
    // This overrides the config override and even the explicit token env var.
    // The config will be marked as readOnly to prevent persisting it.
    overrideConfigApiToken(undefined)
  } else {
    // Lazily access constants.ENV.SOCKET_SECURITY_API_TOKEN.
    const tokenOverride = constants.ENV.SOCKET_SECURITY_API_TOKEN
    if (tokenOverride) {
      // This will set the token (even if there was a config override) and
      // set it to readOnly, making sure the temp token won't be persisted.
      overrideConfigApiToken(tokenOverride)
    }
  }

  if (configOverrideResult?.ok === false) {
    emitBanner(name)
    logger.fail(configOverrideResult.message)
    process.exitCode = 2
    return
  }

  // If we got at least some args, then lets find out if we can find a command.
  if (commandOrAliasName) {
    const alias = aliases[commandOrAliasName]
    // First: Resolve argv data from alias if its an alias that's been given.
    const [commandName, ...commandArgv] = alias
      ? [...alias.argv, ...rawCommandArgv]
      : [commandOrAliasName, ...rawCommandArgv]
    // Second: Find a command definition using that data.
    const commandDefinition = commandName ? subcommands[commandName] : undefined
    // Third: If a valid command has been found, then we run it...
    if (commandDefinition) {
      return await commandDefinition.run(commandArgv, importMeta, {
        parentName: name
      })
    }
  }

  // ...else we provide basic instructions and help.
  if (!cli.flags['silent']) {
    emitBanner(name)
  }
  if (!cli.flags['help'] && cli.flags['dryRun']) {
    process.exitCode = 0
    // Lazily access constants.DRY_RUN_LABEL.
    logger.log(`${constants.DRY_RUN_LABEL}: No-op, call a sub-command; ok`)
  } else {
    cli.showHelp()
  }
}

/**
 * Note: meow will exit immediately if it calls its .showHelp()
 */
export function meowOrExit({
  allowUnknownFlags, // commands that pass-through args need to allow this
  argv,
  config,
  importMeta,
  parentName
}: {
  allowUnknownFlags?: boolean | undefined
  argv: readonly string[]
  config: CliCommandConfig
  parentName: string
  importMeta: ImportMeta
}) {
  const command = `${parentName} ${config.commandName}`
  lastSeenCommand = command

  // This exits if .printHelp() is called either by meow itself or by us.
  const cli = meow({
    argv,
    description: config.description,
    help: config.help(command, config),
    importMeta,
    flags: config.flags,
    allowUnknownFlags: Boolean(allowUnknownFlags),
    autoHelp: false // otherwise we can't exit(0)
  })

  if (!cli.flags['silent']) {
    emitBanner(command)
  }
  if (cli.flags['help']) {
    cli.showHelp()
  }
  return cli
}

export function emitBanner(name: string) {
  // Print a banner at the top of each command.
  // This helps with brand recognition and marketing.
  // It also helps with debugging since it contains version and command details.
  // Note: print over stderr to preserve stdout for flags like --json and
  //       --markdown. If we don't do this, you can't use --json in particular
  //       and pipe the result to other tools. By emitting the banner over stderr
  //       you can do something like `socket scan view xyz | jq | process`.
  //       The spinner also emits over stderr for example.
  logger.error(getAsciiHeader(name))
}

function getAsciiHeader(command: string) {
  // Note: In tests we return <redacted> because otherwise snapshots will fail.
  const { REDACTED } = constants
  // Lazily access constants.ENV.VITEST.
  const redacting = constants.ENV.VITEST
  const cliVersion = redacting
    ? REDACTED
    : // Lazily access constants.ENV.INLINED_SOCKET_CLI_VERSION_HASH.
      constants.ENV.INLINED_SOCKET_CLI_VERSION_HASH
  const nodeVersion = redacting ? REDACTED : process.version
  const apiToken = getDefaultToken()
  const defaultOrg = getConfigValue('defaultOrg').data
  const readOnlyConfig = isReadOnlyConfig() ? '*' : '.'
  const v1test = isTestingV1() ? ' (is testing v1)' : ''
  const feedback = isTestingV1()
    ? colors.green(
        '   (Thank you for testing the v1 bump! Please send us any feedback you might have!)\n'
      )
    : ''
  const shownToken = redacting
    ? REDACTED
    : apiToken
      ? getLastFiveOfApiToken(apiToken)
      : 'no'
  const relCwd = redacting
    ? REDACTED
    : normalizePath(
        process
          .cwd()
          .replace(
            new RegExp(
              `^${escapeRegExp(constants.homePath)}(?:${path.sep}|$)`,
              'i'
            ),
            '~/'
          )
      )
  let nodeVerWarn = ''
  if ((semver.parse(constants.NODE_VERSION)?.major ?? 0) < 20) {
    nodeVerWarn += colors.bold(
      `   ${colors.red('Warning:')} NodeJS version 19 and lower will be ${colors.red('unsupported')} after April 30th, 2025.`
    )
    nodeVerWarn += '\n'
    nodeVerWarn +=
      '            Soon after the Socket CLI will require NodeJS version 20 or higher.'
    nodeVerWarn += '\n'
  }
  const body = `
   _____         _       _        /---------------
  |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver ${cliVersion}${v1test}
  |__   | ${readOnlyConfig} |  _| '_| -_|  _|     | Node: ${nodeVersion}, API token set: ${shownToken}${defaultOrg ? `, default org: ${redacting ? REDACTED : defaultOrg}` : ''}
  |_____|___|___|_,_|___|_|.dev   | Command: \`${command}\`, cwd: ${relCwd}`.trimStart()

  return `   ${body}\n${nodeVerWarn}${feedback}`
}
