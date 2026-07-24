import { commonFlags } from '../../flags.mjs'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { spawnSocketPatchDlx } from '../../util/dlx/spawn.mjs'
import { outputDryRunExecute } from '../../util/dry-run/output.mjs'
import { filterFlags } from '../../util/process/cmd.mjs'

import type {
  CliCommandContext,
  CliSubcommand,
} from '../../util/cli/with-subcommands.mjs'

export const CMD_NAME = 'patch'

const description = 'Manage CVE patches for dependencies'

const hidden = false

export const cmdPatch: CliSubcommand = {
  description,
  hidden,
  run,
}

export async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  context: CliCommandContext,
): Promise<void> {
  const { parentName } = { __proto__: null, ...context } as CliCommandContext

  // Strip Socket CLI global flags (--config, --dry-run, banner/header knobs)
  // before forwarding — socket-patch is a strict clap CLI that exits 2 on any
  // unknown flag. --help survives so `patch <sub> --help` reaches socket-patch.
  const forwardArgs = filterFlags(argv, commonFlags, ['--help', '-h'])
  const dryRun = argv.includes('--dry-run')

  // Check if there are any non-flag arguments (subcommands). Detect on the
  // filtered argv so a flag VALUE (e.g. the JSON payload of --config) does not
  // count as a subcommand.
  const hasSubcommand = forwardArgs.some(arg => !arg.startsWith('-'))

  // Only show Socket CLI help if no subcommand is provided.
  // If a subcommand is present (like 'list', 'info'), forward to socket-patch.
  if (!hasSubcommand) {
    const config = {
      commandName: CMD_NAME,
      description,
      hidden,
      flags: {},
      help: (command: string) => `
    Usage
      $ ${command} ...

    Note: All arguments are forwarded to socket-patch.

    Examples
      $ ${command} list
      $ ${command} get <package>
      $ ${command} apply
    `,
    }

    // Parse arguments to handle --help for patch-level help (exits 0).
    const cli = meowOrExit({
      argv,
      config,
      importMeta,
      parentName,
    })
    // No subcommand and no --help: missing input, show help and exit 2
    // (matching the with-subcommands convention).
    cli.showHelp(2)
  }

  if (dryRun) {
    outputDryRunExecute('socket-patch', forwardArgs, 'socket-patch')
    return
  }

  process.exitCode = 1

  // Forward the remaining arguments to socket-patch via DLX.
  const { spawnPromise } = await spawnSocketPatchDlx(forwardArgs, {
    stdio: 'inherit',
  })

  // Wait for the spawn to complete and set exit code.
  const result = await spawnPromise

  if (result.code != null && result.code !== 0) {
    process.exitCode = result.code
  } else if (result.code === 0) {
    process.exitCode = 0
  }
}
