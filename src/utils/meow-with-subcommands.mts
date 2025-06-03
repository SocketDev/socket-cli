import path from 'node:path'

import meow from 'meow'
import semver from 'semver'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'
import { toSortedObject } from '@socketsecurity/registry/lib/objects'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'

import {
  getConfigValueOrUndef,
  isReadOnlyConfig,
  isTestingV1,
  overrideCachedConfig,
  overrideConfigApiToken,
} from './config.mts'
import { getFlagListOutput, getHelpListOutput } from './output-formatting.mts'
import constants from '../constants.mts'
import { commonFlags } from '../flags.mts'
import { getVisibleTokenPrefix } from './sdk.mts'

import type { MeowFlags } from '../flags.mts'
import type { Options, Result } from 'meow'

interface CliAlias {
  description: string
  argv: readonly string[]
  hidden?: boolean | undefined
}

type CliAliases = Record<string, CliAlias>

type CliSubcommandRun = (
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  context: { parentName: string },
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
  options: MeowOptions,
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
    ...additionalOptions.flags,
  }

  // No further args or first arg is a flag (shrug)
  const isRootCommand =
    name === 'socket' &&
    (!commandOrAliasName || commandOrAliasName?.startsWith('-'))

  if (isRootCommand) {
    flags['help'] = {
      type: 'boolean',
      hidden: false, // Only show on root
      description: 'Give you detailed help information about any sub-command',
    }
    flags['config'] = {
      type: 'string',
      hidden: false, // Only show on root
      description: 'Allows you to temp overrides the internal CLI config',
    }
    flags['dryRun'] = {
      type: 'boolean',
      hidden: false, // Only show on root
      description: 'Do input validation for a sub-command and then exit',
    }
    flags['version'] = {
      type: 'boolean',
      hidden: false, // Only show on root
      description: 'Show version of CLI',
    }
    delete flags['json']
    delete flags['markdown']
  } else {
    delete flags['help']
    delete flags['version']
  }

  // This is basically a dry-run parse of cli args and flags. We use this to
  // determine config overrides and expected output mode.
  const cli1 = meow(`(this should never be printed)`, {
    argv,
    importMeta,
    ...additionalOptions,
    flags,
    // Do not strictly check for flags here.
    allowUnknownFlags: true,
    booleanDefault: undefined, // We want to detect whether a bool flag is given at all.
    // We will emit help when we're ready
    // Plus, if we allow this then meow() can just exit here.
    autoHelp: false,
  })

  // Hard override the config if instructed to do so.
  // The env var overrides the --flag, which overrides the persisted config
  // Also, when either of these are used, config updates won't persist.
  let configOverrideResult
  // Lazily access constants.ENV.SOCKET_CLI_CONFIG.
  if (constants.ENV.SOCKET_CLI_CONFIG) {
    configOverrideResult = overrideCachedConfig(
      // Lazily access constants.ENV.SOCKET_CLI_CONFIG.
      constants.ENV.SOCKET_CLI_CONFIG,
    )
  } else if (cli1.flags['config']) {
    configOverrideResult = overrideCachedConfig(
      String(cli1.flags['config'] || ''),
    )
  }

  // Lazily access constants.ENV.SOCKET_CLI_NO_API_TOKEN.
  if (constants.ENV.SOCKET_CLI_NO_API_TOKEN) {
    // This overrides the config override and even the explicit token env var.
    // The config will be marked as readOnly to prevent persisting it.
    overrideConfigApiToken(undefined)
  } else {
    // Lazily access constants.ENV.SOCKET_CLI_API_TOKEN.
    const tokenOverride = constants.ENV.SOCKET_CLI_API_TOKEN
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
        parentName: name,
      })
    }
  }

  if (isTestingV1()) {
    delete subcommands['diff-scan']
    delete subcommands['info']
    delete subcommands['report']
  }

  function formatCommandsForHelp(isRootCommand: boolean) {
    if (!isRootCommand || !isTestingV1()) {
      return getHelpListOutput(
        {
          ...toSortedObject(
            Object.fromEntries(
              Object.entries(subcommands).filter(
                ({ 1: subcommand }) => !subcommand.hidden,
              ),
            ),
          ),
          ...toSortedObject(
            Object.fromEntries(
              Object.entries(aliases).filter(({ 1: alias }) => {
                const { hidden } = alias
                const cmdName = hidden ? '' : alias.argv[0]
                const subcommand = cmdName ? subcommands[cmdName] : undefined
                return subcommand && !subcommand.hidden
              }),
            ),
          ),
        },
        6,
      )
    }

    // "Bucket" some commands for easier usage

    const commands = new Set([
      'analytics',
      'audit-log',
      'config',
      'dependencies',
      'fix',
      'install',
      'login',
      'logout',
      'manifest',
      'npm',
      'npx',
      'optimize',
      'organization',
      'package',
      'raw-npm',
      'raw-npx',
      'repos',
      'scan',
      'threat-feed',
      'uninstall',
      'wrapper',
    ])
    Object.entries(subcommands)
      .filter(([_name, subcommand]) => !subcommand.hidden)
      .map(([name]) => name)
      .forEach(name => {
        if (commands.has(name)) {
          commands.delete(name)
        } else {
          logger.fail(
            'Received a visible command that was not added to the list here;',
            name,
          )
        }
      })
    if (commands.size) {
      logger.fail(
        'Found commands in the list that were not marked as public or were not defined at all:',
        Array.from(commands).sort(),
      )
    }

    const out = []
    out.push('All commands have their own --help page')
    out.push('    ')
    out.push('    Main commands')
    out.push('    ')
    out.push(
      '      socket login             Setup the CLI with an API Token and defaults',
    )
    out.push('      socket scan create       Create a new Scan and report')
    out.push(
      '      socket package score     Request the (shallow) security score of a particular package',
    )
    out.push(
      '      socket ci                Shorthand for CI; socket scan create --report --no-interactive',
    )
    out.push('    ')
    out.push('    Socket API')
    out.push('    ')
    out.push('      analytics                Look up analytics data')
    out.push(
      '      audit-log                Look up the audit log for an organization',
    )
    out.push(
      '      organization             Manage organization account details',
    )
    out.push('      package                  Look up published package details')
    out.push('      repository               Manage registered repositories')
    out.push('      scan                     Manage Socket scans')
    out.push('      threat-feed              [beta] View the threat feed')
    out.push('    ')
    out.push('    Local tools')
    out.push('    ')
    out.push(
      '      fix                      Update dependencies with "fixable" Socket alerts',
    )
    out.push(
      '      manifest                 Generate a dependency manifest for certain languages',
    )
    out.push('      npm                      npm wrapper functionality')
    out.push('      npx                      npx wrapper functionality')
    out.push(
      '      optimize                 Optimize dependencies with @socketregistry overrides',
    )
    out.push(
      '      raw-npm                  Temporarily disable the Socket npm wrapper',
    )
    out.push(
      '      raw-npx                  Temporarily disable the Socket npx wrapper',
    )
    out.push('    ')
    out.push('    CLI configuration')
    out.push('    ')
    out.push(
      '      config                   Manage the CLI configuration directly',
    )
    out.push(
      '      install                  Manually install CLI tab completion on your system',
    )
    out.push('      login                    Socket API login and CLI setup')
    out.push('      logout                   Socket API logout')
    out.push(
      '      uninstall                Remove the CLI tab completion from your system',
    )
    out.push(
      '      wrapper                  Enable or disable the Socket npm/npx wrapper',
    )

    return out.join('\n')
  }

  // Parse it again. Config overrides should now be applied (may affect help).
  // Note: this is displayed as help screen if the command does not override it
  //       (which is the case for most sub-commands with sub-commands)
  const cli2 = meow(
    `
    Usage
      $ ${name} <command>

${isRootCommand && isTestingV1() ? '' : '    Commands'}
      ${formatCommandsForHelp(isRootCommand)}

${isRootCommand && isTestingV1() ? '    Options' : '    Options'}${isRootCommand ? '       (Note: all CLI commands have these flags even when not displayed in their help)\n' : ''}
      ${getFlagListOutput(flags, 6, isTestingV1() ? { padName: 25 } : undefined)}

    Examples
      $ ${name} --help
${isRootCommand ? `      $ ${name} scan create --json` : ''}${isRootCommand ? `\n      $ ${name} package score npm left-pad --markdown` : ''}`,
    {
      argv,
      importMeta,
      ...additionalOptions,
      flags,
      // Do not strictly check for flags here.
      allowUnknownFlags: true,
      booleanDefault: undefined, // We want to detect whether a bool flag is given at all.
      // We will emit help when we're ready
      // Plus, if we allow this then meow() can just exit here.
      autoHelp: false,
    },
  )

  // ...else we provide basic instructions and help.
  if (!cli2.flags['nobanner']) {
    emitBanner(name)
  }
  if (!cli2.flags['help'] && cli2.flags['dryRun']) {
    process.exitCode = 0
    // Lazily access constants.DRY_RUN_LABEL.
    logger.log(`${constants.DRY_RUN_LABEL}: No-op, call a sub-command; ok`)
  } else {
    // When you explicitly request --help, the command should be successful
    // so we exit(0). If we do it because we need more input, we exit(2).
    cli2.showHelp(cli2.flags['help'] ? 0 : 2)
  }
}

/**
 * Note: meow will exit immediately if it calls its .showHelp()
 */
export function meowOrExit({
  // allowUnknownFlags, // commands that pass-through args need to allow this
  argv,
  config,
  importMeta,
  parentName,
}: {
  allowUnknownFlags?: boolean | undefined
  argv: readonly string[]
  config: CliCommandConfig
  parentName: string
  importMeta: ImportMeta
}): Result<MeowFlags> {
  const command = `${parentName} ${config.commandName}`
  lastSeenCommand = command

  // This exits if .printHelp() is called either by meow itself or by us.
  const cli = meow({
    argv,
    description: config.description,
    help: config.help(command, config),
    importMeta,
    flags: config.flags,
    allowUnknownFlags: true, // meow will exit(1) before printing the banner
    booleanDefault: undefined, // We want to detect whether a bool flag is given at all.
    autoHelp: false, // meow will exit(0) before printing the banner
  })

  if (!cli.flags['nobanner']) {
    emitBanner(command)
  }

  // As per https://github.com/sindresorhus/meow/issues/178
  // Setting allowUnknownFlags:true makes it reject camel cased flags...
  // if (!allowUnknownFlags) {
  //   // Run meow specifically with the flag setting. It will exit(2) if an
  //   // invalid flag is set and print a message.
  //   meow({
  //     argv,
  //     description: config.description,
  //     help: config.help(command, config),
  //     importMeta,
  //     flags: config.flags,
  //     allowUnknownFlags: false,
  //     autoHelp: false,
  //   })
  // }

  if (cli.flags['help']) {
    cli.showHelp(0)
  }
  // Now test for help state. Run meow again. If it exits now, it must be due
  // to wanting to print the help screen. But it would exit(0) and we want a
  // consistent exit(2) for that case (missing input). TODO: move away from meow
  process.exitCode = 2
  meow({
    argv,
    description: config.description,
    help: config.help(command, config),
    importMeta,
    flags: config.flags,
    // As per https://github.com/sindresorhus/meow/issues/178
    // Setting allowUnknownFlags:true makes it reject camel cased flags...
    // allowUnknownFlags: Boolean(allowUnknownFlags),
    autoHelp: false,
  })
  // Ok, no help, reset to default.
  process.exitCode = 0

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
  const defaultOrg = getConfigValueOrUndef('defaultOrg')
  const readOnlyConfig = isReadOnlyConfig() ? '*' : '.'
  const v1test = isTestingV1() ? ' (is testing v1)' : ''
  const feedback = isTestingV1()
    ? colors.green(
        '   (Thank you for testing the v1 bump! Please send us any feedback you might have!)\n',
      )
    : ''
  const shownToken = redacting ? REDACTED : getVisibleTokenPrefix() || 'no'
  const relCwd = redacting
    ? REDACTED
    : normalizePath(
        process
          .cwd()
          .replace(
            new RegExp(
              `^${escapeRegExp(constants.homePath)}(?:${path.sep}|$)`,
              'i',
            ),
            '~/',
          ),
      )
  let nodeVerWarn = ''
  if (semver.parse(constants.NODE_VERSION)!.major < 20) {
    nodeVerWarn += colors.bold(
      `   ${colors.red('Warning:')} NodeJS version 19 and lower will be ${colors.red('unsupported')} after April 30th, 2025.`,
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
