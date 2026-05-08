import { getCI } from '@socketsecurity/lib/env/ci'
import {
  getSocketCliApiToken,
  getSocketCliConfig,
  getSocketCliNoApiToken,
} from '@socketsecurity/lib/env/socket-cli'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { getOwn, hasOwn } from '@socketsecurity/lib/objects'
import { indentString, trimNewlines } from '@socketsecurity/lib/strings'

import { DRY_RUN_LABEL } from '../../constants/cli.mts'
import { VITEST } from '../../env/vitest.mts'
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

import { buildHelpLines } from './with-subcommands-help.mts'

import type { MeowFlag, MeowFlags } from '../../flags.mts'
import type { Result } from '../../meow.mts'

const HELP_INDENT = 2

const logger = getDefaultLogger()

// Shared types + the `description` helper extracted to keep this
// file under the 1000-line File-size cap.
export {
  description,
  type CliAlias,
  type CliAliases,
  type CliSubcommand,
  type CliSubcommandRun,
  type MeowOptions,
} from './with-subcommands-shared.mts'

import type {
  CliSubcommand,
  MeowOptions,
} from './with-subcommands-shared.mts'

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
    buckets,
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

  const lines = buildHelpLines({
    aliases,
    argv,
    buckets,
    flags,
    isRootCommand,
    name,
    subcommands,
  })

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
