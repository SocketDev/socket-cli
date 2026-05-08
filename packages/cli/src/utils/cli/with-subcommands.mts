import terminalLink from 'terminal-link'
import colors from 'yoctocolors-cjs'

import { joinAnd } from '@socketsecurity/lib/arrays'
import { getCI } from '@socketsecurity/lib/env/ci'
import {
  getSocketCliApiToken,
  getSocketCliConfig,
  getSocketCliNoApiToken,
} from '@socketsecurity/lib/env/socket-cli'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { getOwn, hasOwn, toSortedObject } from '@socketsecurity/lib/objects'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'
import { naturalCompare } from '@socketsecurity/lib/sorts'
import { indentString, trimNewlines } from '@socketsecurity/lib/strings'

import { NPM, NPX } from '../../constants/agents.mts'
import {
  DRY_RUN_LABEL,
  FLAG_HELP_FULL,
  FLAG_JSON,
  FLAG_MARKDOWN,
} from '../../constants/cli.mts'
import { VITEST } from '../../env/vitest.mts'
import { API_V0_URL } from '../../constants/socket.mts'
import { commonFlags } from '../../flags.mts'
import meow from '../../meow.mts'
import {
  overrideCachedConfig,
  overrideConfigApiToken,
} from '../config.mts'
import { isDebug } from '../debug.mts'
import {
  resetMachineOutputMode,
  setMachineOutputMode,
} from '../output/ambient-mode.mts'
import { getFlagListOutput, getHelpListOutput } from '../output/formatting.mts'
import { socketPackageLink } from '../terminal/link.mts'

import type { MeowFlag, MeowFlags } from '../../flags.mts'
import type { Options, Result } from '../../meow.mts'

const logger = getDefaultLogger()

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
export interface CliCommandConfig<F extends MeowFlags = MeowFlags> {
  commandName: string
  description: string
  hidden: boolean
  flags: F
  help: (command: string, config: CliCommandConfig<F>) => string
}

export interface CliCommandContext {
  parentName: string
  rawArgv?: string[] | readonly string[]
  invokedAs?: string
}

export interface MeowConfig {
  name: string
  argv: string[] | readonly string[]
  importMeta: ImportMeta
  subcommands: Record<string, CliSubcommand>
}

export interface MeowOptions extends Omit<Options, 'argv' | 'importMeta'> {
  aliases?: CliAliases | undefined
  // When no sub-command is given, default to this sub-command.
  defaultSub?: string | undefined
}

const HELP_INDENT = 2

const HELP_PAD_NAME = 28

/**
 * Format a command description for help output.
 */
export function description(command: CliSubcommand | undefined): string {
  const description = command?.description
  const str =
    typeof description === 'string' ? description : String(description)
  return indentString(str, { count: HELP_PAD_NAME }).trimStart()
}

/**
 * Find the best matching command name for a typo.
 */
export function findBestCommandMatch(
  input: string,
  subcommands: Record<string, unknown>,
  aliases: Record<string, unknown>,
): string | null {
  let bestMatch = null
  let bestScore = Number.POSITIVE_INFINITY
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

// Banner / ASCII-header rendering helpers extracted to keep this file
// under the 1000-line File size cap. See with-subcommands-banner.mts.
import {
  emitBanner,
  getAsciiHeader,
  getHeaderTheme,
  getTokenOrigin,
  shouldAnimateHeader,
  shouldSuppressBanner,
  stripAnsi,
} from './with-subcommands-banner.mts'

export {
  emitBanner,
  getAsciiHeader,
  getHeaderTheme,
  getTokenOrigin,
  shouldAnimateHeader,
  shouldSuppressBanner,
  stripAnsi,
}


/**
 * Calculate Levenshtein distance between two strings for fuzzy matching.
 */
export function levenshteinDistance(a: string, b: string): number {
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
        matrix[i - 1]?.[j]! + 1,
        // Insertion.
        matrix[i]?.[j - 1]! + 1,
        // Substitution.
        matrix[i - 1]?.[j - 1]! + cost,
      )
    }
  }
  return matrix[a.length]?.[b.length]!
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
 * @param config Configuration object with name, argv, importMeta, and subcommands.
 * @param options Optional settings like aliases and defaultSub.
 * @example
 * meowWithSubcommands(
 *   { name, argv, importMeta, subcommands },
 *   { aliases, defaultSub }
 * )
 */
export async function meowWithSubcommands(
  config: MeowConfig,
  options?: MeowOptions | undefined,
): Promise<void> {
  const { argv, importMeta, name, subcommands } = {
    __proto__: null,
    ...config,
  } as MeowConfig
  const {
    aliases = {},
    defaultSub,
    ...additionalOptions
  } = { __proto__: null, ...options } as MeowOptions
  const flags: MeowFlags = {
    ...commonFlags,
    version: {
      type: 'boolean',
      hidden: true,
      description: 'Print the app version',
    },
    // @ts-expect-error - getOwn may return undefined, but spread handles it
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
      return await meowWithSubcommands(
        { name, argv: ['package', 'deep', ...argv], importMeta, subcommands },
        options,
      )
    }
    // Support `socket npm/lodash` or whatever as a shorthand, too.
    // Accept any ecosystem and let the remote sort it out.
    if (/^[a-z]+\//.test(commandOrAliasName || '')) {
      logger.info('Invoking `socket package score`.')
      return await meowWithSubcommands(
        {
          name,
          argv: [
            'package',
            'deep',
            `pkg:${commandOrAliasName}`,
            ...rawCommandArgv,
          ],
          importMeta,
          subcommands,
        },
        options,
      )
    }
  }

  if (isRootCommand) {
    const hiddenDebugFlag = !isDebug()

    flags['compactHeader'] = {
      ...flags['compactHeader'],
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

    flags['help'] = {
      ...flags['help'],
      hidden: false,
    } as MeowFlag

    flags['helpFull'] = {
      ...flags['helpFull'],
      hidden: false,
    } as MeowFlag

    flags['maxOldSpaceSize'] = {
      ...flags['maxOldSpaceSize'],
      hidden: hiddenDebugFlag,
    } as MeowFlag

    flags['maxSemiSpaceSize'] = {
      ...flags['maxSemiSpaceSize'],
      hidden: hiddenDebugFlag,
    } as MeowFlag

    flags['version'] = {
      ...flags['version'],
      hidden: false,
    } as MeowFlag

    delete flags['json']
    delete flags['markdown']
  } else {
    delete flags['help']
    delete flags['helpFull']
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

  const {
    compactHeader: compactHeaderFlag,
    config: configFlag,
    json: jsonFlag,
    markdown: markdownFlag,
    org: orgFlag,
    quiet: quietFlag,
    spinner: spinnerFlag,
  } = cli1.flags as {
    compactHeader: boolean
    config: string
    json: boolean | undefined
    markdown: boolean | undefined
    org: string
    quiet: boolean | undefined
    spinner: boolean
  }

  // Re-derive from the current argv so ambient mode doesn't leak across
  // sequential invocations (e.g. multiple vitest cases in one worker).
  resetMachineOutputMode()
  setMachineOutputMode({
    json: jsonFlag,
    markdown: markdownFlag,
    quiet: quietFlag,
  })

  const compactMode = !!compactHeaderFlag || !!(getCI() && !VITEST)
  const noSpinner = spinnerFlag === false || isDebug()

  // Use CI spinner style when --no-spinner is passed or debug mode is enabled.
  // This prevents the spinner from interfering with debug output.
  if (noSpinner) {
    // Note: Spinner configuration skipped here to avoid circular dependency with
    // constants barrel. Spinner is managed via terminal/spinner state.
    // Refactoring opportunity: Extract spinner to standalone module.
  }
  // Hard override the config if instructed to do so.
  // The env var overrides the --flag, which overrides the persisted config
  // Also, when either of these are used, config updates won't persist.
  let configOverrideResult: any
  const socketCliConfig = getSocketCliConfig()
  if (socketCliConfig) {
    configOverrideResult = overrideCachedConfig(socketCliConfig)
  } else if (configFlag) {
    configOverrideResult = overrideCachedConfig(configFlag)
  }

  if (getSocketCliNoApiToken()) {
    // This overrides the config override and even the explicit token env var.
    // The config will be marked as readOnly to prevent persisting it.
    overrideConfigApiToken(undefined)
  } else {
    const tokenOverride = getSocketCliApiToken()
    if (tokenOverride) {
      // This will set the token (even if there was a config override) and
      // set it to readOnly, making sure the temp token won't be persisted.
      overrideConfigApiToken(tokenOverride)
    }
  }

  if (configOverrideResult?.ok === false) {
    if (!shouldSuppressBanner(cli1.flags)) {
      emitBanner(name, orgFlag, compactMode, cli1.flags)
      // Add newline in stderr.
      logger.error('')
    }
    logger.fail(configOverrideResult.message)
    process.exitCode = 2
    return
  }

  // If we have got some args, then lets find out if we can find a command.
  // Skip command lookup if first arg is a flag (starts with -)
  if (commandOrAliasName && !commandOrAliasName.startsWith('-')) {
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
      const context: CliCommandContext = { parentName: name }
      if (alias) {
        context.invokedAs = commandOrAliasName
      }
      return await commandDefinition.run(commandArgv, importMeta, context)
    }

    // If no command found but defaultSub exists, use it as the command.
    // This treats the first arg as an argument to the default subcommand.
    if (!commandDefinition && defaultSub && subcommands[defaultSub]) {
      return await subcommands[defaultSub].run(
        [commandOrAliasName, ...rawCommandArgv],
        importMeta,
        {
          parentName: name,
        },
      )
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

      // Unknown command with no suggestion - show error and fall through to help.
      process.exitCode = 2
      logger.fail(`Unknown command "${commandName}".`)
      logger.info('Tip: Use `socket pycli` to invoke the Python CLI directly.')
      return
    }
  }

  const lines = ['', 'Usage', `  $ ${name} <command>`]
  if (isRootCommand) {
    lines.push(
      `  $ ${name} scan create ${FLAG_JSON}`,
      `  $ ${name} package score ${NPM} lodash ${FLAG_MARKDOWN}`,
    )
  }
  lines.push('')
  if (isRootCommand) {
    // "Bucket" some commands for easier usage.
    const commands = new Set([
      'analytics',
      'ask',
      'audit-log',
      'bundler',
      'cargo',
      'cdxgen',
      'ci',
      'config',
      'dependencies',
      'fix',
      'gem',
      'go',
      'install',
      //'json',
      'license',
      'login',
      'logout',
      'manifest',
      NPM,
      NPX,
      'nuget',
      'optimize',
      'organization',
      'package',
      'patch',
      'pip',
      // PNPM,
      'pycli',
      'raw-npm',
      'raw-npx',
      'repository',
      'scan',
      //'security',
      'sfw',
      'threat-feed',
      'uninstall',
      'uv',
      'whoami',
      'wrapper',
      // YARN,
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
      '  socket scan create          Create a new Socket scan and report',
      '  socket npm/lodash@4.17.21   Request the Socket score of a package',
      `  socket fix                  ${description(subcommands['fix'])}`,
      `  socket optimize             ${description(subcommands['optimize'])}`,
      `  socket cdxgen               ${description(subcommands['cdxgen'])}`,
      `  socket ci                   ${description(subcommands['ci'])}`,
      '',
      'Socket API',
      `  analytics                   ${description(subcommands['analytics'])}`,
      `  audit-log                   ${description(subcommands['audit-log'])}`,
      `  organization                ${description(subcommands['organization'])}`,
      `  package                     ${description(subcommands['package'])}`,
      `  repository                  ${description(subcommands['repository'])}`,
      `  scan                        ${description(subcommands['scan'])}`,
      `  threat-feed                 ${description(subcommands['threat-feed'])}`,
      '',
      'Local tools',
      `  manifest                    ${description(subcommands['manifest'])}`,
      `  npm                         ${description(subcommands[NPM])}`,
      `  npx                         ${description(subcommands[NPX])}`,
      `  pycli                       ${description(subcommands['pycli'])}`,
      `  raw-npm                     ${description(subcommands['raw-npm'])}`,
      `  raw-npx                     ${description(subcommands['raw-npx'])}`,
      `  sfw                         ${description(subcommands['sfw'])}`,
      '',
      'CLI configuration',
      `  config                      ${description(subcommands['config'])}`,
      `  install                     ${description(subcommands['install'])}`,
      '  login                       Socket API login and CLI setup',
      `  logout                      ${description(subcommands['logout'])}`,
      `  uninstall                   ${description(subcommands['uninstall'])}`,
      `  whoami                      ${description(subcommands['whoami'])}`,
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
        // Explicitly document the negated --no-banner variant.
        noBanner: {
          ...flags['banner'],
          hidden: false,
        } as MeowFlag,
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
    // Check if we should show full help with environment variables.
    const showFullHelp = argv.includes(FLAG_HELP_FULL)

    if (showFullHelp) {
      // Show full help with environment variables.
      lines.push(
        '',
        'Environment variables',
        '  SOCKET_CLI_API_TOKEN        Set the Socket API token',
        '  SOCKET_CLI_CONFIG           A JSON stringified Socket configuration object',
        '  GITHUB_API_URL              Change the base URL for GitHub REST API calls',
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
        `                              if present, else ${API_V0_URL}`,
        '  SOCKET_CLI_API_PROXY        Set the proxy Socket API requests are routed through, e.g. if set to',
        `                              ${terminalLink('http://127.0.0.1:9090', 'https://docs.proxyman.io/troubleshooting/couldnt-see-any-requests-from-3rd-party-network-libraries')} then all request are passed through that proxy`,
        `                              ${colors.italic('Aliases:')} HTTPS_PROXY, https_proxy, HTTP_PROXY, and http_proxy`,
        '  SOCKET_CLI_API_TIMEOUT      Set the timeout in milliseconds for Socket API requests',
        '  SOCKET_CLI_DEBUG            Enable debug logging in Socket CLI',
        `  DEBUG                       Enable debug logging based on the ${socketPackageLink('npm', 'debug', undefined, 'debug')} package`,
      )
    } else {
      // Show condensed help with hint about --help-full.
      lines.push(
        '',
        'Environment variables [more…]',
        `  Use ${colors.bold(FLAG_HELP_FULL)} to view all environment variables`,
      )
    }
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
    help: lines.map(l => indentString(l, { count: HELP_INDENT })).join('\n'),
  })

  const {
    dryRun,
    help: helpFlag,
    version: versionFlag,
  } = cli2.flags as {
    dryRun: boolean
    help: boolean
    version: boolean
  }

  // Handle --version flag at root level.
  if (versionFlag) {
    cli2.showVersion()
  }

  // ...else we provide basic instructions and help.
  if (!shouldSuppressBanner(cli2.flags)) {
    emitBanner(name, orgFlag, compactMode, cli2.flags)
    // Meow will add newline so don't add stderr spacing here.
  }
  if (!helpFlag && dryRun) {
    logger.log(`${DRY_RUN_LABEL}: No-op, call a sub-command; ok`)
    // Exit immediately to prevent tests from hanging waiting for stdin.
    // eslint-disable-next-line n/no-process-exit -- Required for dry-run mode.
    process.exit(0)
  } else {
    // When you explicitly request --help, the command should be successful
    // so we exit(0). If we do it because we need more input, we exit(2).
    cli2.showHelp(helpFlag ? 0 : 2)
  }
}

export interface MeowOrExitConfig<F extends MeowFlags = MeowFlags> {
  argv: string[] | readonly string[]
  config: CliCommandConfig<F>
  parentName: string
  importMeta: ImportMeta
}

export type MeowOrExitOptions = {
  allowUnknownFlags?: boolean | undefined
}

/**
 * Create meow CLI instance or exit with help/error (meow will exit immediately
 * if it calls .showHelp()).
 * @param config Configuration object with argv, config, parentName, and importMeta.
 * @param options Optional settings like allowUnknownFlags.
 * @example
 * meowOrExit(
 *   { argv, config, parentName, importMeta },
 *   { allowUnknownFlags: false }
 * )
 */
export function meowOrExit<const F extends MeowFlags = MeowFlags>(
  config: MeowOrExitConfig<F>,
  options?: MeowOrExitOptions | undefined,
): Result<F> {
  const {
    argv,
    config: cliConfig,
    importMeta,
    parentName,
  } = { __proto__: null, ...config } as MeowOrExitConfig<F>
  const { allowUnknownFlags = true } = {
    __proto__: null,
    ...options,
  } as MeowOrExitOptions
  const command = `${parentName} ${cliConfig.commandName}`
  lastSeenCommand = command

  // This exits if .printHelp() is called either by meow itself or by us.
  const cli = meow({
    argv,
    // Prevent meow from potentially exiting early.
    autoHelp: false,
    autoVersion: false,
    // We want to detect whether a bool flag is given at all.
    booleanDefault: undefined,
    description: cliConfig.description,
    flags: cliConfig.flags,
    help: trimNewlines(cliConfig.help(command, cliConfig)),
    importMeta,
  } as any)

  const {
    compactHeader: compactHeaderFlag,
    help: helpFlag,
    json: jsonFlag,
    markdown: markdownFlag,
    org: orgFlag,
    quiet: quietFlag,
    spinner: spinnerFlag,
    version: versionFlag,
  } = cli.flags as {
    compactHeader: boolean
    help: boolean
    json: boolean | undefined
    markdown: boolean | undefined
    org: string
    quiet: boolean | undefined
    spinner: boolean
    version: boolean | undefined
  }

  // Apply machine-output mode from this command's flags. Reset first
  // so prior in-worker state doesn't leak across sequential invocations.
  resetMachineOutputMode()
  setMachineOutputMode({
    json: jsonFlag,
    markdown: markdownFlag,
    quiet: quietFlag,
  })

  const compactMode = !!compactHeaderFlag || !!(getCI() && !VITEST)
  const noSpinner = spinnerFlag === false || isDebug()

  // Use CI spinner style when --no-spinner is passed.
  // This prevents the spinner from interfering with debug output.
  if (noSpinner) {
    // Note: Spinner configuration skipped here to avoid circular dependency with
    // constants barrel. Spinner is managed via terminal/spinner state.
    // Refactoring opportunity: Extract spinner to standalone module.
  }

  if (!shouldSuppressBanner(cli.flags)) {
    emitBanner(command, orgFlag, compactMode, cli.flags)
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

  if (helpFlag) {
    cli.showHelp(0)
  }

  // Meow doesn't detect 'version' as an unknown flag, so we do the leg work here.
  if (versionFlag && !hasOwn(cliConfig.flags, 'version')) {
    logger.error('Unknown flag\n--version')
    // eslint-disable-next-line n/no-process-exit
    process.exit(2)
    // This line is never reached in production, but helps tests.
    throw new Error('process.exit called')
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
    description: cliConfig.description,
    help: trimNewlines(cliConfig.help(command, cliConfig)),
    importMeta,
    flags: cliConfig.flags,
  })
  // Ok, no help, reset to default.
  process.exitCode = 0

  return cli as unknown as Result<F>
}
