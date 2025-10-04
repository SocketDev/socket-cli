/**
 * @fileoverview Socket pip command - forwards pip operations to Socket Firewall (sfw).
 *
 * This command wraps pip with Socket Firewall security scanning, providing real-time
 * security analysis of Python packages before installation.
 *
 * Architecture:
 * - Parses Socket CLI flags (--help, --config, etc.)
 * - Filters out Socket-specific flags
 * - Detects pip or pip3 binary availability
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
 *   Checks for pip, falls back to pip3 if pip is not found
 *
 * See also:
 *   - Socket Firewall: https://www.npmjs.com/package/sfw
 *   - Python CLI: src/utils/python-standalone.mts
 */

import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { filterFlags, forwardToSfw } from '../../utils/cmd.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

const { WIN32 } = constants

const CMD_NAME = 'pip'
const description = 'Run pip with Socket Firewall security'

/**
 * Detect which pip binary is available (pip or pip3).
 * macOS systems typically have pip3, while others may have pip.
 */
async function detectPipBinary(): Promise<string> {
  // Try pip first
  try {
    const result = await spawn('which', ['pip'], {
      stdio: 'ignore',
      shell: WIN32,
    })
    if (result.code === 0) {
      return 'pip'
    }
  } catch {
    // pip not found, try pip3
  }

  // Fall back to pip3
  try {
    const result = await spawn('which', ['pip3'], {
      stdio: 'ignore',
      shell: WIN32,
    })
    if (result.code === 0) {
      return 'pip3'
    }
  } catch {
    // pip3 not found
  }

  // Default to pip (sfw will handle the error)
  return 'pip'
}

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

  // Detect pip or pip3 binary
  const pipBinary = await detectPipBinary()

  // Forward arguments to sfw (Socket Firewall) via npx.
  const result = await forwardToSfw(pipBinary, argsToForward)

  if (!result.ok) {
    process.exitCode = result.code || 1
  }
}
