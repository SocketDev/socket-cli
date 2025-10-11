/**
 * @fileoverview Socket yarn command - forwards yarn operations to Socket Firewall (sfw).
 *
 * This command wraps yarn with Socket Firewall security scanning, providing real-time
 * security analysis of JavaScript packages before installation.
 *
 * Architecture:
 * - Parses Socket CLI flags (--help, --config, etc.)
 * - Filters out Socket-specific flags
 * - Forwards remaining arguments to Socket Firewall via npx
 * - Socket Firewall acts as a proxy for yarn operations
 *
 * Usage:
 *   socket yarn install
 *   socket yarn add <package>
 *   socket yarn dlx <package>
 *
 * Environment:
 *   Requires Node.js and npx (bundled with npm)
 *   Socket Firewall (sfw) is downloaded automatically via npx on first use
 *
 * See also:
 *   - Socket Firewall: https://www.npmjs.com/package/sfw
 */

import { YARN } from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { filterFlags, forwardToSfw } from '../../utils/cmd.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

export const CMD_NAME = YARN

const description = 'Run yarn with Socket Firewall security'

const hidden = false

export const cmdYarn = {
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

    Note: Everything after "${CMD_NAME}" is forwarded to Socket Firewall (sfw).
          Socket Firewall provides real-time security scanning for yarn packages.

    Examples
      $ ${command} install
      $ ${command} add package-name
    `,
  }

  // Parse flags to handle --help
  meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  // Filter out Socket CLI flags before forwarding to sfw
  // Exception: Keep --dry-run to forward to yarn (yarn supports --dry-run natively)
  const argsToForward = filterFlags(argv, commonFlags, ['dry-run'])

  // Forward arguments to sfw (Socket Firewall) via our shadow runner.
  const result = await forwardToSfw('yarn', argsToForward)

  if (!result.ok) {
    process.exitCode = result.code || 1
  }
}
