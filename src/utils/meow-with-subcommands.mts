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
  isConfigFromFlag,
  overrideCachedConfig,
  overrideConfigApiToken,
} from './config.mts'
import { isDebug } from './debug.mts'
import { getFlagListOutput, getHelpListOutput } from './output-formatting.mts'
import { socketPackageLink } from './terminal-link.mts'
import constants, {
  API_V0_URL,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_DEFAULT_ORG,
  FLAG_HELP_FULL,
  FLAG_JSON,
  FLAG_MARKDOWN,
  FLAG_ORG,
  NPM,
  NPX,
  // PNPM,
  // YARN,
} from '../constants.mts'
import { commonFlags } from '../flags.mts'
import { spawnSocketPython } from './python-standalone.mts'
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

export interface MeowConfig {
  name: string
  argv: string[] | readonly string[]
  importMeta: ImportMeta
  subcommands: Record<string, CliSubcommand>
}

export interface MeowOptions extends Omit<Options<any>, 'argv' | 'importMeta'> {
  aliases?: CliAliases | undefined
  // When no sub-command is given, default to this sub-command.
  defaultSub?: string | undefined
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
 * Determine the origin of the API token.
 */
function getTokenOrigin(): string {
  if (constants.ENV.SOCKET_CLI_NO_API_TOKEN) {
    return ''
  }
  if (constants.ENV.SOCKET_CLI_API_TOKEN) {
    return '(env)'
  }
  const configToken = getConfigValueOrUndef(CONFIG_KEY_API_TOKEN)
  if (configToken) {
    return isConfigFromFlag() ? '(--config flag)' : '(config)'
  }
  return ''
}

/**
 * Generate the ASCII banner header for Socket CLI commands.
 */
function getAsciiHeader(
  command: string,
  orgFlag: string | undefined,
  compactMode: boolean = false,
) {
  // Note: In tests we return <redacted> because otherwise snapshots will fail.
  const { REDACTED } = constants
  const redacting = constants.ENV.VITEST

  // Version display: show hash in debug mode, otherwise show semantic version.
  const fullVersion = constants.ENV.INLINED_SOCKET_CLI_VERSION
  const versionHash = constants.ENV.INLINED_SOCKET_CLI_VERSION_HASH
  const cliVersion = redacting
    ? REDACTED
    : isDebug()
      ? versionHash
      : `v${fullVersion}`

  const nodeVersion = redacting ? REDACTED : process.version
  const showNodeVersion = !redacting && isDebug()
  const defaultOrg = getConfigValueOrUndef(CONFIG_KEY_DEFAULT_ORG)
  const configFromFlagDot = isConfigFromFlag() ? '*' : '.'

  // Token display with origin indicator.
  const tokenPrefix = getVisibleTokenPrefix()
  const tokenOrigin = redacting ? '' : getTokenOrigin()
  const noApiToken = constants.ENV.SOCKET_CLI_NO_API_TOKEN
  const shownToken = redacting
    ? REDACTED
    : noApiToken
      ? colors.red('(disabled)')
      : tokenPrefix
        ? `${colors.green(tokenPrefix)}***${tokenOrigin ? ` ${tokenOrigin}` : ''}`
        : colors.yellow('(not set)')

  const relCwd = redacting ? REDACTED : normalizePath(tildify(process.cwd()))

  // Consolidated org display format.
  const orgPart = redacting
    ? `org: ${REDACTED}`
    : orgFlag
      ? `org: ${colors.cyan(orgFlag)} (${FLAG_ORG} flag)`
      : defaultOrg && defaultOrg !== 'null'
        ? `org: ${colors.cyan(defaultOrg)} (config)`
        : colors.yellow('org: (not set)')

  // Compact mode for CI/automation.
  if (compactMode) {
    const compactToken = noApiToken
      ? '(disabled)'
      : tokenPrefix
        ? `${tokenPrefix}***${tokenOrigin ? ` ${tokenOrigin}` : ''}`
        : '(not set)'
    const compactOrg =
      orgFlag ||
      (defaultOrg && defaultOrg !== 'null' ? defaultOrg : '(not set)')
    return `CLI: ${cliVersion} | cmd: ${command} | org: ${compactOrg} | token: ${compactToken}`
  }

  // Note: We could draw these with ascii box art instead but I worry about
  //       portability and paste-ability. "simple" ascii chars just work.
  const body = `
   _____         _       _        /---------------
  |   __|___ ___| |_ ___| |_      | CLI: ${cliVersion}
  |__   | ${configFromFlagDot} |  _| '_| -_|  _|     | ${showNodeVersion ? `Node: ${nodeVersion}, ` : ''}token: ${shownToken}, ${orgPart}
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
export function emitBanner(
  name: string,
  orgFlag: string | undefined,
  compactMode: boolean = false,
) {
  // Print a banner at the top of each command.
  // This helps with brand recognition and marketing.
  // It also helps with debugging since it contains version and command details.
  // Note: print over stderr to preserve stdout for flags like --json and
  //       --markdown. If we don't do this, you can't use --json in particular
  //       and pipe the result to other tools. By emitting the banner over stderr
  //       you can do something like `socket scan view xyz | jq | process`.
  //       The spinner also emits over stderr for example.
  logger.error(getAsciiHeader(name, orgFlag, compactMode))
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
    org: orgFlag,
    spinner: spinnerFlag,
  } = cli1.flags as {
    compactHeader: boolean
    config: string
    org: string
    spinner: boolean
  }

  const compactMode =
    compactHeaderFlag || (constants.ENV.CI && !constants.ENV.VITEST)
  const noSpinner = spinnerFlag === false || isDebug()

  // Use CI spinner style when --no-spinner is passed or debug mode is enabled.
  // This prevents the spinner from interfering with debug output.
  if (noSpinner) {
    constants.spinner.spinner = getCliSpinners('ci')!
  }
  // Hard override the config if instructed to do so.
  // The env var overrides the --flag, which overrides the persisted config
  // Also, when either of these are used, config updates won't persist.
  let configOverrideResult
  if (constants.ENV.SOCKET_CLI_CONFIG) {
    configOverrideResult = overrideCachedConfig(constants.ENV.SOCKET_CLI_CONFIG)
  } else if (configFlag) {
    configOverrideResult = overrideCachedConfig(configFlag)
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
      emitBanner(name, orgFlag, compactMode)
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

      // Try forwarding to socket-python CLI for unrecognized commands.
      // This enables commands like: socket report, socket purl, etc.
      const pythonResult = await spawnSocketPython(commandArgv, {
        stdio: 'inherit',
      })
      if (pythonResult.ok) {
        // Successfully handled by Python CLI.
        return
      }
      // If Python CLI also failed, fall through to show help.
    }
  }

  // If first arg is a flag (starts with --), try Python CLI forwarding.
  // This enables: socket --repo owner/repo --target-path .
  if (commandOrAliasName?.startsWith('--')) {
    const pythonResult = await spawnSocketPython(argv, {
      stdio: 'inherit',
    })
    if (pythonResult.ok) {
      // Successfully handled by Python CLI.
      return
    }
    // If Python CLI failed, fall through to show help.
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
      'pip',
      // PNPM,
      'raw-npm',
      'raw-npx',
      'repository',
      'scan',
      //'security',
      'threat-feed',
      'uninstall',
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
      `  socket scan create          Create a new Socket scan and report`,
      `  socket npm/lodash@4.17.21   Request the Socket score of a package`,
      `  socket fix                  ${description(subcommands['fix'])}`,
      `  socket optimize             ${description(subcommands['optimize'])}`,
      `  socket cdxgen               ${description(subcommands['cdxgen'])}`,
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
      `  manifest                    ${description(subcommands['manifest'])}`,
      `  npm                         ${description(subcommands[NPM])}`,
      `  npx                         ${description(subcommands[NPX])}`,
      `  raw-npm                     ${description(subcommands['raw-npm'])}`,
      `  raw-npx                     ${description(subcommands['raw-npx'])}`,
      '',
      'CLI configuration',
      `  config                      ${description(subcommands['config'])}`,
      `  install                     ${description(subcommands['install'])}`,
      `  login                       Socket API login and CLI setup`,
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
        'Environment variables [more...]',
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
    help: lines.map(l => indentString(l, HELP_INDENT)).join('\n'),
  })

  const { dryRun, help: helpFlag } = cli2.flags as {
    dryRun: boolean
    help: boolean
  }

  // ...else we provide basic instructions and help.
  if (!shouldSuppressBanner(cli2.flags)) {
    emitBanner(name, orgFlag, compactMode)
    // Meow will add newline so don't add stderr spacing here.
  }
  if (!helpFlag && dryRun) {
    process.exitCode = 0
    logger.log(`${constants.DRY_RUN_LABEL}: No-op, call a sub-command; ok`)
  } else {
    // When you explicitly request --help, the command should be successful
    // so we exit(0). If we do it because we need more input, we exit(2).
    cli2.showHelp(helpFlag ? 0 : 2)
  }
}

export interface MeowOrExitConfig {
  argv: string[] | readonly string[]
  config: CliCommandConfig
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
export function meowOrExit(
  config: MeowOrExitConfig,
  options?: MeowOrExitOptions | undefined,
): Result<MeowFlags> {
  const {
    argv,
    config: cliConfig,
    importMeta,
    parentName,
  } = { __proto__: null, ...config } as MeowOrExitConfig
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
    collectUnknownFlags: true,
    description: cliConfig.description,
    flags: cliConfig.flags,
    help: trimNewlines(cliConfig.help(command, cliConfig)),
    importMeta,
  })

  const {
    compactHeader: compactHeaderFlag,
    help: helpFlag,
    org: orgFlag,
    spinner: spinnerFlag,
    version: versionFlag,
  } = cli.flags as {
    compactHeader: boolean
    help: boolean
    org: string
    spinner: boolean
    version: boolean | undefined
  }

  const compactMode =
    compactHeaderFlag || (constants.ENV.CI && !constants.ENV.VITEST)
  const noSpinner = spinnerFlag === false || isDebug()

  // Use CI spinner style when --no-spinner is passed.
  // This prevents the spinner from interfering with debug output.
  if (noSpinner) {
    constants.spinner.spinner = getCliSpinners('ci')!
  }

  if (!shouldSuppressBanner(cli.flags)) {
    emitBanner(command, orgFlag, compactMode)
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
    // Use `console.error` here instead of `logger.error` to match Meow behavior.
    console.error('Unknown flag\n--version')
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

  return cli
}
