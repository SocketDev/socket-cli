import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { spawnSocketPatchDlx } from '../../utils/dlx/spawn.mjs'

import type {
  CliCommandConfig,
  CliCommandContext,
  CliSubcommand,
} from '../../utils/cli/with-subcommands.mjs'

export const CMD_NAME = 'patch'

const description = 'Manage CVE patches for dependencies'

const hidden = false

export const cmdPatch: CliSubcommand = {
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

  // Check if there are any non-flag arguments (subcommands).
  const hasSubcommand = argv.some(arg => !arg.startsWith('-'))

  // Only show Socket CLI help if no subcommand is provided.
  // If a subcommand is present (like 'list', 'info'), forward to socket-patch.
  if (!hasSubcommand) {
    const config: CliCommandConfig = {
      commandName: CMD_NAME,
      description,
      hidden,
      flags: {},
      help: command => `
    Usage
      $ ${command} ...

    Note: All arguments are forwarded to socket-patch.

    Examples
      $ ${command} list
      $ ${command} get <package>
      $ ${command} apply
    `,
    }

    // Parse arguments to handle --help for patch-level help.
    meowOrExit({
      argv,
      config,
      importMeta,
      parentName,
    })
  }

  process.exitCode = 1

  // Forward all arguments to socket-patch via DLX.
  const { spawnPromise } = await spawnSocketPatchDlx([...argv], {
    stdio: 'inherit',
  })

  // Wait for the spawn to complete and set exit code.
  const result = await spawnPromise

  if (result.code !== null && result.code !== 0) {
    process.exitCode = result.code
  } else if (result.code === 0) {
    process.exitCode = 0
  }
}
