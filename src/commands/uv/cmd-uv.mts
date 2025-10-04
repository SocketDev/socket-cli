/**
 * @fileoverview Socket uv command - forwards uv operations to Socket Firewall (sfw).
 *
 * This command wraps uv (Python package installer) with Socket Firewall security scanning,
 * providing real-time security analysis of Python packages before installation.
 *
 * Architecture:
 * - Parses Socket CLI flags (--help, --config, etc.)
 * - Filters out Socket-specific flags
 * - Forwards remaining arguments to Socket Firewall via npx
 * - Socket Firewall acts as a proxy for uv operations
 *
 * Usage:
 *   socket uv pip install <package>
 *   socket uv add <package>
 *   socket uv sync
 *
 * Environment:
 *   Requires Node.js and npx (bundled with npm)
 *   Socket Firewall (sfw) is downloaded automatically via npx on first use
 *
 * See also:
 *   - Socket Firewall: https://www.npmjs.com/package/sfw
 *   - uv: https://github.com/astral-sh/uv
 */

import { commonFlags } from '../../flags.mts'
import { filterFlags, forwardToSfw } from '../../utils/cmd.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

const CMD_NAME = 'uv'
const description = 'Run uv with Socket Firewall security'

/**
 * Command export for socket uv.
 * Provides description and run function for CLI registration.
 */
export const cmdUv = {
  description,
  hidden: false,
  run,
}

/**
 * Execute the socket uv command.
 *
 * Flow:
 * 1. Parse CLI flags with meow to handle --help
 * 2. Filter out Socket CLI flags (--config, --org, etc.)
 * 3. Forward remaining arguments to Socket Firewall via npx
 * 4. Socket Firewall proxies the uv command with security scanning
 * 5. Exit with the same code as the uv command
 *
 * @param argv - Command arguments (after "uv")
 * @param importMeta - Import metadata for meow
 * @param context - CLI command context (parent name, etc.)
 */
async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  context: CliCommandContext,
): Promise<void> {
  const { parentName } = { __proto__: null, ...context } as CliCommandContext
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
    description,
    hidden: false,
    flags: {
      ...commonFlags,
    },
    help: command => `
    Usage
      $ ${command} ...

    Note: Everything after "${CMD_NAME}" is forwarded to Socket Firewall (sfw).
          Socket Firewall provides real-time security scanning for uv packages.

    Examples
      $ ${command} pip install flask
      $ ${command} add requests
      $ ${command} sync
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
  const argsToForward = filterFlags(argv, commonFlags, [])

  // Forward arguments to sfw (Socket Firewall) via npx.
  const result = await forwardToSfw('uv', argsToForward)

  if (!result.ok) {
    process.exitCode = result.code || 1
  }
}
