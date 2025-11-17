/**
 * @fileoverview Socket pip command - forwards pip operations to Socket Firewall (sfw).
 *
 * This command wraps pip with Socket Firewall security scanning, providing real-time
 * security analysis of Python packages before installation.
 *
 * Architecture:
 * - Parses Socket CLI flags (--help, --config, etc.)
 * - Filters out Socket-specific flags
 * - Detects pip vs pip3 based on context.invokedAs (from alias)
 * - Auto-detects available binary (pip/pip3) with fallback
 * - Forwards remaining arguments to Socket Firewall via npx
 * - Socket Firewall acts as a proxy for pip operations
 *
 * Usage:
 *   socket pip install <package>     # Uses 'pip' binary (or 'pip3' if pip missing)
 *   socket pip3 install <package>    # Uses 'pip3' binary (or 'pip' if pip3 missing)
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

import { whichReal } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { spawn } from '@socketsecurity/lib/spawn'

import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { resolveSfw } from '../../utils/dlx/resolve-binary.mjs'
import { filterFlags } from '../../utils/process/cmd.mts'
import { spawnNode } from '../../utils/spawn/spawn-node.mjs'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mts'

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
 * Determine the pip binary name to use based on invocation and availability.
 *
 * Priority:
 * 1. If invoked as `socket pip3`, use 'pip3'
 * 2. If invoked as `socket pip`, check if 'pip' exists, fallback to 'pip3'
 * 3. If pip3 requested but doesn't exist, fallback to 'pip'
 *
 * @param invokedAs - The alias name used to invoke the command (e.g., 'pip3')
 * @returns The pip binary name to use ('pip' or 'pip3')
 */
async function getPipBinName(invokedAs?: string): Promise<string> {
  // Determine the requested binary based on how the command was invoked.
  const requested = invokedAs === 'pip3' ? invokedAs : 'pip'
  const fallback = requested === 'pip' ? 'pip3' : 'pip'

  // Check if the requested binary is available.
  const requestedPath = await whichReal(requested, { nothrow: true })
  if (requestedPath) {
    return requested
  }

  // Requested binary not found, check if fallback exists.
  const fallbackPath = await whichReal(fallback, { nothrow: true })
  if (fallbackPath) {
    return fallback
  }

  // Neither found, return the requested binary and let it fail naturally.
  return requested
}

/**
 * Execute the socket pip command.
 *
 * Flow:
 * 1. Parse CLI flags with meow to handle --help
 * 2. Filter out Socket CLI flags (--config, --org, etc.)
 * 3. Forward remaining arguments to Socket Firewall via npx
 * 4. Socket Firewall proxies the pip command with security scanning
 * 5. Exit with the same code or signal as the pip command
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
  const { invokedAs, parentName } = {
    __proto__: null,
    ...context,
  } as CliCommandContext
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

  const resolution = resolveSfw()

  // Determine which pip binary to use (pip or pip3) with auto-detection.
  const pipBinName = await getPipBinName(invokedAs)

  // Set default exit code to 1 (failure). Will be overwritten on success.
  process.exitCode = 1

  // Forward arguments to sfw (Socket Firewall).
  // Use local sfw if available, otherwise use pnpm dlx with pinned version.
  const spawnPromise =
    resolution.type === 'local'
      ? spawnNode([resolution.path, pipBinName, ...argsToForward], {
          shell: WIN32,
          stdio: 'inherit',
        })
      : spawn(
          'pnpm',
          [
            'dlx',
            `${resolution.details.name}@${resolution.details.version}`,
            pipBinName,
            ...argsToForward,
          ],
          {
            shell: WIN32,
            stdio: 'inherit',
          },
        )

  // Handle exit codes and signals using event-based pattern.
  // See https://nodejs.org/api/child_process.html#event-exit.
  const { process: childProcess } = spawnPromise as any
  childProcess.on(
    'exit',
    (code: number | null, signalName: NodeJS.Signals | null) => {
      if (signalName) {
        process.kill(process.pid, signalName)
      } else if (typeof code === 'number') {
        // eslint-disable-next-line n/no-process-exit
        process.exit(code)
      }
    },
  )

  await spawnPromise
}
