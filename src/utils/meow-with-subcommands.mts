import meow from 'meow'
import terminalLink from 'terminal-link'
import colors from 'yoctocolors-cjs'

import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'
import {
  getOwn,
  hasOwn,
  toSortedObject,
} from '@socketsecurity/registry/lib/objects'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'
import { getCliSpinners } from '@socketsecurity/registry/lib/spinner'
import {
  indentString,
  trimNewlines,
} from '@socketsecurity/registry/lib/strings'

import {
  getConfigValueOrUndef,
  isReadOnlyConfig,
  overrideCachedConfig,
  overrideConfigApiToken,
} from './config.mts'
import { getFlagListOutput, getHelpListOutput } from './output-formatting.mts'
import constants, { NPM, NPX } from '../constants.mts'
import { commonFlags } from '../flags.mts'
import { getVisibleTokenPrefix } from './sdk.mts'
import { tildify } from './tildify.mts'

import type { MeowFlag, MeowFlags } from '../flags.mts'
import type { Options, Result } from 'meow'

export interface CliAlias {
  description: string
  argv: readonly string[]
  hidden?: boolean | undefined
}

export type CliAliases = Record<string, CliAlias>

export type CliSubcommandRun = (
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  context: { parentName: string; rawArgv?: readonly string[] },
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
  commandName: string
  description: string
  hidden: boolean
  flags: MeowFlags
  help: (command: string, config: CliCommandConfig) => string
}

export interface CliCommandContext {
  parentName: string
  rawArgv?: string[] | readonly string[]
}

export interface MeowOptions extends Options<any> {
  aliases?: CliAliases | undefined
  argv: readonly string[]
  name: string
  // When no sub-command is given, default to this sub-command.
  defaultSub?: string
}

const HELP_INDENT = 2

const HELP_PAD_NAME = 28

/**
 * Format a command description for help output.
 */
function description(command: CliSubcommand | undefined): string {
  const description = command?.description
  const str =
    typeof description === 'string' ? description : String(description)
  return indentString(str, HELP_PAD_NAME).trimStart()
}

/**
 * Find the best matching command name for a typo.
 */
function findBestCommandMatch(
  input: string,
  subcommands: Record<string, unknown>,
  aliases: Record<string, unknown>,
): string | null {
  let bestMatch = null
  let bestScore = Infinity
  const allCommands = [...Object.keys(subcommands), ...Object.keys(aliases)]
  for (const command of allCommands) {
    const distance = levenshteinDistance(
      input.toLowerCase(),
      command.toLowerCase(),
    )
    const maxLength = Math.max(input.length, command.length)
    // Only suggest if the similarity is reasonable (more than 50% similar).
    if (distance < maxLength * 0.5 && distance < bestScore) {
      bestScore = distance
      bestMatch = command
    }
  }
  return bestMatch
}

/**
 * Generate the ASCII banner header for Socket CLI commands.
 */
function getAsciiHeader(command: string, orgFlag: string | undefined) {
  // Note: In tests we return <redacted> because otherwise snapshots will fail.
  const { REDACTED } = constants
  const redacting = constants.ENV.VITEST
  const cliVersion = redacting
    ? REDACTED
    : constants.ENV.INLINED_SOCKET_CLI_VERSION_HASH
  const nodeVersion = redacting ? REDACTED : process.version
  const defaultOrg = getConfigValueOrUndef('defaultOrg')
  const readOnlyConfig = isReadOnlyConfig() ? '*' : '.'
  const shownToken = redacting
    ? REDACTED
    : getVisibleTokenPrefix() || '(not set)'
  const relCwd = redacting ? REDACTED : normalizePath(tildify(process.cwd()))
  // Note: we must redact org when creating snapshots because dev machine probably
  //       has a default org set but CI won't. Showing --org is fine either way.
  const orgPart = orgFlag
    ? `--org: ${orgFlag}`
    : redacting
      ? 'org: <redacted>'
      : defaultOrg
        ? `default org: ${defaultOrg}`
        : '(org not set)'
  // Note: We could draw these with ascii box art instead but I worry about
  //       portability and paste-ability. "simple" ascii chars just work.
  const body = `
   _____         _       _        /---------------
  |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver ${cliVersion}
  |__   | ${readOnlyConfig} |  _| '_| -_|  _|     | Node: ${nodeVersion}, API token: ${shownToken}, ${orgPart}
  |_____|___|___|_,_|___|_|.dev   | Command: \`${command}\`, cwd: ${relCwd}
  `.trim()
  // Note: logger will auto-append a newline.
  return `   ${body}`
}

/**
 * Calculate Levenshtein distance between two strings for fuzzy matching.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0),
  )
  for (let i = 0; i <= a.length; i++) {
    matrix[i]![0] = i
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0]![j] = j
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i]![j] = Math.min(
        // Deletion.
        matrix[i - 1]![j]! + 1,
        // Insertion.
        matrix[i]![j - 1]! + 1,
        // Substitution.
        matrix[i - 1]![j - 1]! + cost,
      )
    }
  }
  return matrix[a.length]![b.length]!
}

/**
 * Determine if the banner should be suppressed based on output flags.
 */
function shouldSuppressBanner(flags: Record<string, unknown>): boolean {
  return Boolean(
    flags['json'] || flags['markdown'] || flags['banner'] === false,
  )
}

/**
 * Emit the Socket CLI banner to stderr for branding and debugging.
 */
export function emitBanner(name: string, orgFlag: string | undefined) {
  // Print a banner at the top of each command.
  // This helps with brand recognition and marketing.
  // It also helps with debugging since it contains version and command details.
  // Note: print over stderr to preserve stdout for flags like --json and
  //       --markdown. If we don't do this, you can't use --json in particular
  //       and pipe the result to other tools. By emitting the banner over stderr
  //       you can do something like `socket scan view xyz | jq | process`.
  //       The spinner also emits over stderr for example.
  logger.error(getAsciiHeader(name, orgFlag))
}

// For debugging. Whenever you call meowOrExit it will store the command here
// This module exports a getter that returns the current value.
let lastSeenCommand = ''

/**
 * Get the last command that was processed by meowOrExit (for debugging).
 */
export function getLastSeenCommand(): string {
  return lastSeenCommand
}

/**
 * Main function for handling CLI with subcommands using meow.
 */
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
  const flags: MeowFlags = {
    ...commonFlags,
    version: {
      type: 'boolean',
      hidden: true,
      description: 'Print the app version',
    },
    ...getOwn(additionalOptions, 'flags'),
  }

  const [commandOrAliasName_, ...rawCommandArgv] = argv
  let commandOrAliasName = commandOrAliasName_
  if (!commandOrAliasName && defaultSub) {
    commandOrAliasName = defaultSub
  }

  // No further args or first arg is a flag (shrug).
  const isRootCommand =
    name === 'socket' &&
    (!commandOrAliasName || commandOrAliasName?.startsWith('-'))

  // Try to support `socket <purl>` as a shorthand for `socket package score <purl>`.
  if (!isRootCommand) {
    if (commandOrAliasName?.startsWith('pkg:')) {
      logger.info('Invoking `socket package score`.')
      return await meowWithSubcommands(subcommands, {
        ...options,
        argv: ['package', 'deep', ...argv],
      })
    }
    // Support `socket npm/lodash` or whatever as a shorthand, too.
    // Accept any ecosystem and let the remote sort it out.
    if (/^[a-z]+\//.test(commandOrAliasName || '')) {
      logger.info('Invoking `socket package score`.')
      return await meowWithSubcommands(subcommands, {
        ...options,
        argv: [
          'package',
          'deep',
          `pkg:${commandOrAliasName}`,
          ...rawCommandArgv,
        ],
      })
    }
  }

  if (isRootCommand) {
    flags['help'] = {
      ...flags['help'],
      hidden: false,
    } as MeowFlag

    flags['config'] = {
      ...flags['config'],
      hidden: false,
    } as MeowFlag

    flags['dryRun'] = {
      ...flags['dryRun'],
      hidden: false,
    } as MeowFlag

    flags['maxOldSpaceSize'] = {
      ...flags['maxOldSpaceSize'],
      hidden: false,
    } as MeowFlag

    flags['maxSemiSpaceSize'] = {
      ...flags['maxSemiSpaceSize'],
      hidden: false,
    } as MeowFlag

    flags['version'] = {
      ...flags['version'],
      hidden: false,
    } as MeowFlag

    delete flags['json']
    delete flags['markdown']
  } else {
    delete flags['help']
    delete flags['version']
  }

  // This is basically a dry-run parse of cli args and flags. We use this to
  // determine config overrides and expected output mode.
  const cli1 = meow({
    argv,
    importMeta,
    ...additionalOptions,
    flags,
    // Ensure we don't check unknown flags.
    allowUnknownFlags: true,
    // Prevent meow from potentially exiting early.
    autoHelp: false,
    autoVersion: false,
    // We want to detect whether a bool flag is given at all.
    booleanDefault: undefined,
  })

  const noSpinner = cli1.flags['spinner'] === false
  const orgFlag = String(cli1.flags['org'] || '') || undefined

  // Use CI spinner style when --no-spinner is passed.
  if (noSpinner) {
    constants.spinner.spinner = getCliSpinners('ci')!
  }
  // Hard override the config if instructed to do so.
  // The env var overrides the --flag, which overrides the persisted config
  // Also, when either of these are used, config updates won't persist.
  let configOverrideResult
  if (constants.ENV.SOCKET_CLI_CONFIG) {
    configOverrideResult = overrideCachedConfig(constants.ENV.SOCKET_CLI_CONFIG)
  } else if (cli1.flags['config']) {
    configOverrideResult = overrideCachedConfig(cli1.flags['config'])
  }

  if (constants.ENV.SOCKET_CLI_NO_API_TOKEN) {
    // This overrides the config override and even the explicit token env var.
    // The config will be marked as readOnly to prevent persisting it.
    overrideConfigApiToken(undefined)
  } else {
    const tokenOverride = constants.ENV.SOCKET_CLI_API_TOKEN
    if (tokenOverride) {
      // This will set the token (even if there was a config override) and
      // set it to readOnly, making sure the temp token won't be persisted.
      overrideConfigApiToken(tokenOverride)
    }
  }

  if (configOverrideResult?.ok === false) {
    if (!shouldSuppressBanner(cli1.flags)) {
      emitBanner(name, orgFlag)
      // Add newline in stderr.
      logger.error('')
    }
    logger.fail(configOverrideResult.message)
    process.exitCode = 2
    return
  }

  // If we have got some args, then lets find out if we can find a command.
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
      // Extract the original command arguments from the full argv
      // by skipping the command name
      return await commandDefinition.run(commandArgv, importMeta, {
        parentName: name,
      })
    }

    // Suggest similar commands for typos.
    if (commandName && !commandDefinition) {
      const suggestion = findBestCommandMatch(commandName, subcommands, aliases)
      if (suggestion) {
        process.exitCode = 2
        logger.fail(
          `Unknown command "${commandName}". Did you mean "${suggestion}"?`,
        )
        return
      }
    }
  }

  const lines = ['', 'Usage', `  $ ${name} <command>`]
  if (isRootCommand) {
    lines.push(
      `  $ ${name} scan create --json`,
      `  $ ${name} package score npm lodash --markdown`,
    )
  }
  lines.push('')
  if (isRootCommand) {
    // "Bucket" some commands for easier usage.
    const commands = new Set([
      'analytics',
      'audit-log',
      'ci',
      'cdxgen',
      'config',
      'dependencies',
      'fix',
      'install',
      //'json',
      'license',
      'login',
      'logout',
      'manifest',
      NPM,
      NPX,
      'optimize',
      'organization',
      'package',
      //'patch',
      'raw-npm',
      'raw-npx',
      'repository',
      'scan',
      //'security',
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
          logger.fail('Received an unknown command:', name)
        }
      })
    if (commands.size) {
      logger.fail(
        'Found commands in the list that were not marked as public or not defined at all:',
        // Node < 22 will print 'Object (n)' before the array. So to have consistent
        // test snapshots we use joinAnd.
        joinAnd(
          Array.from(commands)
            .sort(naturalCompare)
            .map(c => `'${c}'`),
        ),
      )
    }
    lines.push(
      'Note: All commands have their own --help',
      '',
      'Main commands',
      `  socket login                ${description(subcommands['login'])}`,
      `  socket scan create          Create a new Socket scan and report`,
      `  socket npm/lodash@4.17.21   Request the Socket score of a package`,
      `  socket ci                   ${description(subcommands['ci'])}`,
      ``,
      'Socket API',
      `  analytics                   ${description(subcommands['analytics'])}`,
      `  audit-log                   ${description(subcommands['audit-log'])}`,
      `  organization                ${description(subcommands['organization'])}`,
      `  package                     ${description(subcommands['package'])}`,
      `  repository                  ${description(subcommands['repository'])}`,
      `  scan                        ${description(subcommands['scan'])}`,
      `  threat-feed                 ${description(subcommands['threat-feed'])}`,
      ``,
      'Local tools',
      `  fix                         ${description(subcommands['fix'])}`,
      `  manifest                    ${description(subcommands['manifest'])}`,
      `  npm                         ${description(subcommands[NPM])}`,
      `  npx                         ${description(subcommands[NPX])}`,
      `  optimize                    ${description(subcommands['optimize'])}`,
      `  raw-npm                     ${description(subcommands['raw-npm'])}`,
      `  raw-npx                     ${description(subcommands['raw-npx'])}`,
      '',
      'CLI configuration',
      `  config                      ${description(subcommands['config'])}`,
      `  install                     ${description(subcommands['install'])}`,
      `  login                       Socket API login and CLI setup`,
      `  logout                      ${description(subcommands['logout'])}`,
      `  uninstall                   ${description(subcommands['uninstall'])}`,
      `  wrapper                     ${description(subcommands['wrapper'])}`,
    )
  } else {
    lines.push('Commands')
    lines.push(
      `  ${getHelpListOutput(
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
        { indent: HELP_INDENT, padName: HELP_PAD_NAME },
      )}`,
    )
  }

  lines.push('', 'Options')
  if (isRootCommand) {
    lines.push(
      '  Note: All commands have these flags even when not displayed in their help',
      '',
    )
  } else {
    lines.push('')
  }
  lines.push(
    `  ${getFlagListOutput(
      {
        ...flags,
        // Explicitly document the negated --no-spinner variant.
        noSpinner: {
          ...flags['spinner'],
          hidden: false,
        } as MeowFlag,
      },
      { indent: HELP_INDENT, padName: HELP_PAD_NAME },
    )}`,
  )
  if (isRootCommand) {
    lines.push(
      '',
      'Environment variables',
      '  SOCKET_CLI_API_TOKEN        Set the Socket API token',
      '  SOCKET_CLI_CONFIG           A JSON stringified Socket configuration object',
      '  SOCKET_CLI_GITHUB_API_URL   Change the base URL for GitHub REST API calls',
      '  SOCKET_CLI_GIT_USER_EMAIL   The git config `user.email` used by Socket CLI',
      `                              ${colors.italic('Defaults:')} github-actions[bot]@users.noreply.github.com`,
      '  SOCKET_CLI_GIT_USER_NAME    The git config `user.name` used by Socket CLI',
      `                              ${colors.italic('Defaults:')} github-actions[bot]`,
      `  SOCKET_CLI_GITHUB_TOKEN     A classic or fine-grained ${terminalLink('GitHub personal access token', 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens')}`,
      `                              ${colors.italic('Aliases:')} GITHUB_TOKEN`,
      '  SOCKET_CLI_NO_API_TOKEN     Make the default API token `undefined`',
      '  SOCKET_CLI_NPM_PATH         The absolute location of the npm directory',
      '  SOCKET_CLI_ORG_SLUG         Specify the Socket organization slug',
      '',
      '  SOCKET_CLI_ACCEPT_RISKS     Accept risks of a Socket wrapped npm/npx run',
      '  SOCKET_CLI_VIEW_ALL_RISKS   View all risks of a Socket wrapped npm/npx run',
      '',
      'Environment variables for development',
      '  SOCKET_CLI_API_BASE_URL     Change the base URL for Socket API calls',
      `                              ${colors.italic('Defaults:')} The "apiBaseUrl" value of socket/settings local app data`,
      '                              if present, else https://api.socket.dev/v0/',
      '  SOCKET_CLI_API_PROXY        Set the proxy Socket API requests are routed through, e.g. if set to',
      `                              ${terminalLink('http://127.0.0.1:9090', 'https://docs.proxyman.io/troubleshooting/couldnt-see-any-requests-from-3rd-party-network-libraries')} then all request are passed through that proxy`,
      `                              ${colors.italic('Aliases:')} HTTPS_PROXY, https_proxy, HTTP_PROXY, and http_proxy`,
      '  SOCKET_CLI_API_TIMEOUT      Set the timeout in milliseconds for Socket API requests',
      '  SOCKET_CLI_DEBUG            Enable debug logging in Socket CLI',
      `  DEBUG                       Enable debug logging based on the ${terminalLink('debug', 'https://socket.dev/npm/package/debug')} package`,
    )
  }

  // Parse it again. Config overrides should now be applied (may affect help).
  // Note: this is displayed as help screen if the command does not override it
  //       (which is the case for most sub-commands with sub-commands).
  const cli2 = meow({
    argv,
    importMeta,
    ...additionalOptions,
    flags,
    // Do not strictly check for flags here.
    allowUnknownFlags: true,
    // We will emit help when we're ready.
    // Plus, if we allow this then meow may exit here.
    autoHelp: false,
    autoVersion: false,
    // We want to detect whether a bool flag is given at all.
    booleanDefault: undefined,
    help: lines.map(l => indentString(l, HELP_INDENT)).join('\n'),
  })

  // ...else we provide basic instructions and help.
  if (!shouldSuppressBanner(cli2.flags)) {
    emitBanner(name, orgFlag)
    // Meow will add newline so don't add stderr spacing here.
  }
  if (!cli2.flags['help'] && cli2.flags['dryRun']) {
    process.exitCode = 0
    logger.log(`${constants.DRY_RUN_LABEL}: No-op, call a sub-command; ok`)
  } else {
    // When you explicitly request --help, the command should be successful
    // so we exit(0). If we do it because we need more input, we exit(2).
    cli2.showHelp(cli2.flags['help'] ? 0 : 2)
  }
}

/**
 * Create meow CLI instance or exit with help/error (meow will exit immediately
 * if it calls .showHelp()).
 */
export function meowOrExit({
  allowUnknownFlags = true,
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
    // Prevent meow from potentially exiting early.
    autoHelp: false,
    autoVersion: false,
    // We want to detect whether a bool flag is given at all.
    booleanDefault: undefined,
    collectUnknownFlags: true,
    description: config.description,
    flags: config.flags,
    help: trimNewlines(config.help(command, config)),
    importMeta,
  })

  const {
    help,
    org: orgFlag,
    spinner: spinnerFlag,
    version,
  } = cli.flags as {
    help: boolean
    org: string
    spinner: boolean
    version: boolean | undefined
  }

  const noSpinner = spinnerFlag === false

  // Use CI spinner style when --no-spinner is passed.
  if (noSpinner) {
    constants.spinner.spinner = getCliSpinners('ci')!
  }

  if (!shouldSuppressBanner(cli.flags)) {
    emitBanner(command, orgFlag)
    // Add newline in stderr.
    // Meow help adds a newline too so we do it here.
    logger.error('')
  }

  // As per https://github.com/sindresorhus/meow/issues/178
  // Setting `allowUnknownFlags: false` makes it reject camel cased flags.
  // if (!allowUnknownFlags) {
  //   // Run meow specifically with the flag setting. It will exit(2) if an
  //   // invalid flag is set and print a message.
  //   meow({
  //     argv,
  //     allowUnknownFlags: false,
  //     // Prevent meow from potentially exiting early.
  //     autoHelp: false,
  //     autoVersion: false,
  //     description: config.description,
  //     flags: config.flags,
  //     help: trimNewlines(config.help(command, config)),
  //     importMeta,
  //   })
  // }

  if (help) {
    cli.showHelp(0)
  }

  // Meow doesn't detect 'version' as an unknown flag, so we do the leg work here.
  if (version && !hasOwn(config.flags, 'version')) {
    // Use `console.error` here instead of `logger.error` to match Meow behavior.
    console.error('Unknown flag\n--version')
    // eslint-disable-next-line n/no-process-exit
    process.exit(2)
  }

  // Now test for help state. Run Meow again. If it exits now, it must be due
  // to wanting to print the help screen. But it would exit(0) and we want a
  // consistent exit(2) for that case (missing input).
  process.exitCode = 2
  meow({
    argv,
    // As per https://github.com/sindresorhus/meow/issues/178
    // Setting `allowUnknownFlags: false` makes it reject camel cased flags.
    allowUnknownFlags: Boolean(allowUnknownFlags),
    // Prevent meow from potentially exiting early.
    autoHelp: false,
    autoVersion: false,
    description: config.description,
    help: trimNewlines(config.help(command, config)),
    importMeta,
    flags: config.flags,
  })
  // Ok, no help, reset to default.
  process.exitCode = 0

  return cli
}
