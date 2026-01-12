import { spawnSocketPatch } from '../../utils/socket-patch/spawn.mts'

import type {
  CliCommandContext,
  CliSubcommand,
} from '../../utils/cli/with-subcommands.mjs'

const description = 'Manage CVE patches for dependencies'

const hidden = false

export const cmdPatch: CliSubcommand = {
  description,
  hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  _importMeta: ImportMeta,
  _context: CliCommandContext,
): Promise<void> {
  // Forward all arguments to socket-patch.
  const result = await spawnSocketPatch([...argv])

  if (!result.ok) {
    process.exitCode = 1
  }
}
