/**
 * @fileoverview Socket cargo command - forwards cargo operations to Socket Firewall (sfw).
 *
 * This command wraps cargo with Socket Firewall security scanning, providing real-time
 * security analysis of Rust packages before installation.
 *
 * Architecture:
 * - Parses Socket CLI flags (--help, --config, etc.)
 * - Filters out Socket-specific flags
 * - Forwards remaining arguments to Socket Firewall via pnpm dlx
 * - Socket Firewall acts as a proxy for cargo operations
 *
 * Usage:
 *   socket cargo install <package>
 *   socket cargo build
 *   socket cargo add <crate>
 *
 * Environment:
 *   Requires Node.js and pnpm
 *   Socket Firewall (sfw) is downloaded automatically via pnpm dlx on first use
 *
 * See also:
 *   - Socket Firewall: https://www.npmjs.com/package/sfw
 */

import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { spawnSfwDlx } from '../../utils/dlx/spawn.mjs'
import { filterFlags } from '../../utils/process/cmd.mts'
import {
  trackSubprocessExit,
  trackSubprocessStart,
} from '../../utils/telemetry/integration.mjs'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const CMD_NAME = 'cargo'
const description = 'Run cargo with Socket Firewall security'

/**
 * Command export for socket cargo.
 * Provides description and run function for CLI registration.
 */
export const cmdCargo = {
  description,
  hidden: false,
  run,
}

/**
 * Execute the socket cargo command.
 *
 * Flow:
 * 1. Parse CLI flags with meow to handle --help
 * 2. Filter out Socket CLI flags (--config, --org, etc.)
 * 3. Forward remaining arguments to Socket Firewall via pnpm dlx
 * 4. Socket Firewall proxies the cargo command with security scanning
 * 5. Exit with the same code as the cargo command
 *
 * @param argv - Command arguments (after "cargo")
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
          Socket Firewall provides real-time security scanning for cargo packages.

    Examples
      $ ${command} install ripgrep
      $ ${command} build
      $ ${command} add serde
    `,
  }

  // Parse flags to handle --help.
  meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  // Filter out Socket CLI flags before forwarding to sfw.
  const argsToForward = filterFlags(argv, commonFlags, [])

  // Set default exit code to 1 (failure). Will be overwritten on success.
  process.exitCode = 1

  // Track subprocess start.
  const subprocessStartTime = await trackSubprocessStart(CMD_NAME)

  // Forward arguments to sfw (Socket Firewall) using Socket's dlx.
  const { spawnPromise } = await spawnSfwDlx(['cargo', ...argsToForward], {
    stdio: 'inherit',
  })

  // Handle exit codes and signals using event-based pattern.
  // See https://nodejs.org/api/child_process.html#event-exit.
  const { process: childProcess } = spawnPromise as any
  childProcess.on(
    'exit',
    async (code: number | null, signalName: NodeJS.Signals | null) => {
      await trackSubprocessExit(CMD_NAME, subprocessStartTime, code)

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
