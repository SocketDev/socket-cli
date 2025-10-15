/**
 * @fileoverview Socket pip command - forwards pip operations to Socket Firewall (sfw).
 *
 * This command wraps pip with Socket Firewall security scanning, providing real-time
 * security analysis of Python packages before installation.
 *
 * Architecture:
 * - Parses Socket CLI flags (--help, --config, etc.)
 * - Filters out Socket-specific flags
 * - Forwards remaining arguments to Socket Firewall via npx
 * - Socket Firewall acts as a proxy for pip operations
 *
 * Usage:
 *   socket pip install <package>
 *   socket pip install -r requirements.txt
 *   socket pip list
 *
 * Environment:
 *   Requires Node.js and npx (bundled with npm)
 *   Socket Firewall (sfw) is downloaded automatically via npx on first use
 *
 * See also:
 *   - Socket Firewall: https://www.npmjs.com/package/sfw
 *   - Python CLI: src/utils/python/standalone.mts
 */

import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { filterFlags } from '../../utils/process/cmd.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const { WIN32 } = constants

const CMD_NAME = 'pip'
const description = 'Run pip with Socket Firewall security'

/**
 * Command export for socket pip.
 * Provides description and run function for CLI registration.
 */
export const cmdPip = {
  description,
  hidden: false,
  run,
}

/**
 * Execute the socket pip command.
 *
 * Flow:
 * 1. Parse CLI flags with meow to handle --help
 * 2. Filter out Socket CLI flags (--config, --org, etc.)
 * 3. Forward remaining arguments to Socket Firewall via npx
 * 4. Socket Firewall proxies the pip command with security scanning
 * 5. Exit with the same code as the pip command
 *
 * @param argv - Command arguments (after "pip")
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
          Socket Firewall provides real-time security scanning for pip packages.

    Examples
      $ ${command} install flask
      $ ${command} install -r requirements.txt
      $ ${command} list
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
  const result = await spawn('npx', ['sfw', 'pip', ...argsToForward], {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    process.exitCode = result.code || 1
  }
}
