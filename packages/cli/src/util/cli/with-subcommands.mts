import { getCI } from '@socketsecurity/lib-stable/env/ci'
import { getSocketApiToken } from '@socketsecurity/lib-stable/env/socket'
import {
  getSocketCliConfig,
  getSocketCliNoApiToken,
} from '@socketsecurity/lib-stable/env/socket-cli'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { getOwn } from '@socketsecurity/lib-stable/objects/inspect'
import { indentString } from '@socketsecurity/lib-stable/strings/format'

import { DRY_RUN_LABEL } from '../../constants/cli.mts'
import { VITEST } from '../../env/vitest.mts'
import { commonFlags } from '../../flags.mts'
import { meow } from '../../meow.mts'
import { overrideCachedConfig, overrideConfigApiToken } from '../config.mts'
import { isDebug } from '../debug.mts'
import {
  resetMachineOutputMode,
  setMachineOutputMode,
} from '../output/ambient-mode.mts'
import { applyMachineOutputStreamPolicy } from '../output/machine-output-streams.mts'

import { buildHelpLines } from './with-subcommands-help.mts'
import { tryDispatchSubcommand } from './with-subcommands-dispatch.mts'
import { applyRootCommandFlagVisibility } from './with-subcommands-root-flags.mts'

import type { MeowFlags } from '../../flags.mts'

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

import type { CliSubcommand, MeowOptions } from './with-subcommands-shared.mts'

// `findBestCommandMatch` / `levenshteinDistance` extracted to keep this
// file under the 1000-line File-size cap. See with-subcommands-fuzzy-match.mts.
export {
  findBestCommandMatch,
  levenshteinDistance,
} from './with-subcommands-fuzzy-match.mts'

// `meowOrExit` extracted to keep this file under the 1000-line File-size cap.
// See with-subcommands-meow-exit.mts.
export {
  meowOrExit,
  type MeowOrExitConfig,
  type MeowOrExitOptions,
} from './with-subcommands-meow-exit.mts'

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
  rawArgv?: string[] | readonly string[] | undefined
  invokedAs?: string | undefined
}

export interface MeowConfig {
  name: string
  argv: string[] | readonly string[]
  importMeta: ImportMeta
  subcommands: Record<string, CliSubcommand>
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
 * Main function for handling CLI with subcommands using meow.
 *
 * @example
 *   meowWithSubcommands(
 *     { name, argv, importMeta, subcommands },
 *     { aliases, defaultSub },
 *   )
 *
 * @param config Configuration object with name, argv, importMeta, and
 *   subcommands.
 * @param options Optional settings like aliases and defaultSub.
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

  applyRootCommandFlagVisibility(flags, { isRootCommand })

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
  // Route the logger's stdout-bound status helpers (step / substep) to stderr
  // when machine-output mode is engaged, so stdout carries only the payload.
  applyMachineOutputStreamPolicy({
    json: jsonFlag,
    markdown: markdownFlag,
    quiet: quietFlag,
  })

  const compactMode = compactHeaderFlag || (getCI() && !VITEST)
  const noSpinner = !spinnerFlag || isDebug()

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
  let configOverrideResult: ReturnType<typeof overrideCachedConfig> | undefined
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
    const tokenOverride = getSocketApiToken()
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
  const dispatched = await tryDispatchSubcommand({
    aliases,
    commandOrAliasName: commandOrAliasName || '',
    defaultSub,
    importMeta,
    name,
    rawCommandArgv,
    subcommands,
  })
  if (dispatched) {
    return
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
  /* c8 ignore start - --version causes meow to print and exit; tests avoid invoking this path to prevent process.exit */
  if (versionFlag) {
    cli2.showVersion()
  }
  /* c8 ignore stop */

  // ...else we provide basic instructions and help.
  if (!shouldSuppressBanner(cli2.flags)) {
    emitBanner(name, orgFlag, compactMode, cli2.flags)
    // Meow will add newline so don't add stderr spacing here.
  }
  /* c8 ignore start - dry-run process.exit branch; tests avoid invoking this to prevent process termination */
  if (!helpFlag && dryRun) {
    // Dry-run previews are contextual output, not payload — stderr per the
    // stream discipline (see util/dry-run/output.mts).
    logger.error(`${DRY_RUN_LABEL}: No-op, call a sub-command; ok`)
    // Exit immediately to prevent tests from hanging waiting for stdin.
    process.exit(0)
    /* c8 ignore stop */
  } else {
    // When you explicitly request --help, the command should be successful
    // so we exit(0). If we do it because we need more input, we exit(2).
    cli2.showHelp(helpFlag ? 0 : 2)
  }
}
