/**
 * @fileoverview PNPM wrapper command for Socket CLI.
 *
 * This command wraps pnpm with Socket security scanning.
 *
 * Routing Logic (undocumented):
 * - If --config or -c flags are provided: Uses shadow pnpm binary with Socket registry overrides
 * - Otherwise: Forwards to Socket Firewall (sfw) for security scanning
 *
 * This conditional routing allows advanced users with Socket registry configs to use
 * registry overrides, while providing sfw scanning for standard usage.
 *
 * Usage:
 *   socket pnpm install
 *   socket pnpm add <package>
 *   socket pnpm dlx <package>
 */

import { createRequire } from 'node:module'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants, { PNPM } from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { filterFlags, forwardToSfw } from '../../utils/cmd.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

const require = createRequire(import.meta.url)

export const CMD_NAME = PNPM

const description = 'Run pnpm with Socket security scanning'

const hidden = false

export const cmdPnpm = {
  description,
  hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  context: CliCommandContext,
): Promise<void> {
  const { parentName } = { __proto__: null, ...context } as CliCommandContext
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: {
      ...commonFlags,
    },
    help: command => `
    Usage
      $ ${command} ...

    Note: Everything after "${CMD_NAME}" is forwarded to pnpm with Socket security scanning.

    Examples
      $ ${command} install
      $ ${command} add package-name
      $ ${command} dlx package-name
    `,
  }

  const cli = meowOrExit({
    argv,
    config,
    parentName,
    importMeta,
  })

  const dryRun = !!cli.flags['dryRun']

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  // Conditional routing (undocumented feature):
  // - With --config/-c: Use shadow pnpm binary for Socket registry overrides
  // - Without config: Forward to sfw for security scanning
  // This allows advanced users to use registry configs while defaulting to sfw.
  const hasConfigFlag =
    argv.includes('--config') ||
    argv.includes('-c') ||
    argv.some(arg => arg.startsWith('--config='))

  if (hasConfigFlag) {
    // Use shadow pnpm binary with Socket registry config
    const shadowPnpmBin = /*@__PURE__*/ require(constants.shadowPnpmBinPath)

    process.exitCode = 1

    // Filter Socket flags from argv.
    const filteredArgv = filterFlags(argv, config.flags)

    const { spawnPromise } = await shadowPnpmBin(filteredArgv, {
      stdio: 'inherit',
    })

    await spawnPromise
    process.exitCode = 0
  } else {
    // Forward to sfw (Socket Firewall)
    const argsToForward = filterFlags(argv, commonFlags, [])

    const result = await forwardToSfw('pnpm', argsToForward)

    if (!result.ok) {
      process.exitCode = result.code || 1
    }
  }
}
