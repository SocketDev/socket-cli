/**
 * `meowOrExit` — single-command meow parsing with the router's shared help,
 * banner, and machine-output-mode wiring.
 *
 * Extracted from with-subcommands.mts to keep that file under the 1000-line
 * File size hard cap.
 */

import { getCI } from '@socketsecurity/lib-stable/env/ci'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { hasOwn } from '@socketsecurity/lib-stable/objects/predicates'
import { trimNewlines } from '@socketsecurity/lib-stable/strings/transform'

import { VITEST } from '../../env/vitest.mts'
import { meow } from '../../meow.mts'
import { isDebug } from '../debug.mts'
import {
  resetMachineOutputMode,
  setMachineOutputMode,
} from '../output/ambient-mode.mts'
import { emitBanner, shouldSuppressBanner } from './with-subcommands-banner.mts'

import type { CliCommandConfig } from './with-subcommands.mts'
import type { MeowFlags } from '../../flags.mts'
import type { Result } from '../../meow.mts'

const logger = getDefaultLogger()

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
 *
 * @example
 *   meowOrExit(
 *     { argv, config, parentName, importMeta },
 *     { allowUnknownFlags: false },
 *   )
 *
 * @param config Configuration object with argv, config, parentName, and
 *   importMeta.
 * @param options Optional settings like allowUnknownFlags.
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
  })

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

  const compactMode = compactHeaderFlag || (getCI() && !VITEST)
  const noSpinner = !spinnerFlag || isDebug()

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
    // oxlint-disable-next-line socket/no-logger-newline-literal -- CLI output formatting: multi-line user-facing message where embedded \n produces the intended layout.
    logger.error('Unknown flag\n--version')
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
    allowUnknownFlags: allowUnknownFlags,
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
