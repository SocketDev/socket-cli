import meow from 'meow'

import { logger } from '@socketsecurity/registry/lib/logger'
import { toSortedObject } from '@socketsecurity/registry/lib/objects'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'

import { getLastFiveOfApiToken } from './api'
import { getFlagListOutput, getHelpListOutput } from './output-formatting'
import { getSetting } from './settings'
import constants from '../constants'
import { MeowFlags, commonFlags } from '../flags'

import type { Options } from 'meow'

const { DRY_RUN_LABEL, REDACTED } = constants

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
    importMeta,
    name,
    ...additionalOptions
  } = { __proto__: null, ...options }
  const [commandOrAliasName, ...rawCommandArgv] = argv
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
  const flags = {
    ...commonFlags,
    ...additionalOptions.flags
  }
  // ...else we provide basic instructions and help.

  emitBanner(name)

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
      autoHelp: false // otherwise we can't exit(0)
    }
  )
  if (!cli.flags['help'] && cli.flags['dryRun']) {
    process.exitCode = 0
    logger.log(`${DRY_RUN_LABEL}: No-op, call a sub-command; ok`)
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

  emitBanner(command)

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
  //       and pipe the result to other tools. By emiting the banner over stderr
  //       you can do something like `socket scan view xyz | jq | process`.
  //       The spinner also emits over stderr for example.
  logger.error(getAsciiHeader(name))
}

function getAsciiHeader(command: string) {
  // Note: In tests we return <redacted> because otherwise snapshots will fail.
  // The '@rollup/plugin-replace' will replace "process.env['SOCKET_CLI_VERSION_HASH']".
  const redacting = process.env['VITEST']
  const cliVersion = redacting
    ? REDACTED
    : // The '@rollup/plugin-replace' will replace "process.env['SOCKET_CLI_VERSION_HASH']".
      process.env['SOCKET_CLI_VERSION_HASH']
  const nodeVersion = redacting ? REDACTED : process.version
  const apiToken = getSetting('apiToken')
  const shownToken = redacting
    ? REDACTED
    : apiToken
      ? getLastFiveOfApiToken(apiToken)
      : 'no'
  const relCwd = redacting
    ? REDACTED
    : process
        .cwd()
        .replace(new RegExp(`^${escapeRegExp(constants.homePath)}`, 'i'), '~')
  const body = `
   _____         _       _        /---------------
  |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver ${cliVersion}
  |__   | . |  _| '_| -_|  _|     | Node: ${nodeVersion}, API token set: ${shownToken}
  |_____|___|___|_,_|___|_|.dev   | Command: \`${command}\`, cwd: ${relCwd}`.trimStart()
  return `   ${body}\n`
}
