/**
 * @fileoverview Socket go command - forwards go operations to Socket Firewall (sfw).
 *
 * This command wraps go with Socket Firewall security scanning, providing real-time
 * security analysis of Go packages before installation.
 *
 * Architecture:
 * - Parses Socket CLI flags (--help, --config, etc.)
 * - Filters out Socket-specific flags
 * - Forwards remaining arguments to Socket Firewall via pnpm dlx
 * - Socket Firewall acts as a proxy for go operations
 *
 * Usage:
 *   socket go get <package>
 *   socket go install <package>
 *   socket go mod download
 *
 * Environment:
 *   Requires Node.js and pnpm
 *   Socket Firewall (sfw) is downloaded automatically via pnpm dlx on first use
 *   Note: Wrapper mode works best on Linux (macOS has keychain issues)
 *
 * See also:
 *   - Socket Firewall: https://www.npmjs.com/package/sfw
 */

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
} from '../../utils/cli/with-subcommands.mjs'

const CMD_NAME = 'go'
const description = 'Run go with Socket Firewall security'

/**
 * Command export for socket go.
 * Provides description and run function for CLI registration.
 */
export const cmdGo = {
  description,
  hidden: false,
  run,
}

/**
 * Execute the socket go command.
 *
 * Flow:
 * 1. Parse CLI flags with meow to handle --help
 * 2. Filter out Socket CLI flags (--config, --org, etc.)
 * 3. Forward remaining arguments to Socket Firewall via pnpm dlx
 * 4. Socket Firewall proxies the go command with security scanning
 * 5. Exit with the same code or signal as the go command
 *
 * @param argv - Command arguments (after "go")
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
          Socket Firewall provides real-time security scanning for go packages.
          Wrapper mode works best on Linux (macOS may have keychain issues).

    Examples
      $ ${command} get github.com/gin-gonic/gin
      $ ${command} install golang.org/x/tools/cmd/goimports
      $ ${command} mod download
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

  const resolution = resolveSfw()

  // Set default exit code to 1 (failure). Will be overwritten on success.
  process.exitCode = 1

  // Forward arguments to sfw (Socket Firewall).
  // Use local sfw if available, otherwise use pnpm dlx with pinned version.
  const spawnPromise =
    resolution.type === 'local'
      ? spawnNode([resolution.path, 'go', ...argsToForward], {
          shell: WIN32,
          stdio: 'inherit',
        })
      : spawn(
          'pnpm',
          [
            'dlx',
            `${resolution.details.name}@${resolution.details.version}`,
            'go',
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
