import { commonFlags } from '../../flags.mjs'
import { runPatchList } from './handle-list.mts'
import { runPatchRemove } from './handle-remove.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { spawnSocketPatch } from '../../core/patch/spawn.mts'
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
  const forwardArgs = filterFlags(argv, commonFlags, ['--help', '-h'])
  const dryRun = argv.includes('--dry-run')
  const hasSubcommand = forwardArgs.some(arg => !arg.startsWith('-'))

  if (!hasSubcommand) {
    const config = {
      commandName: CMD_NAME,
      description,
      hidden,
      flags: {},
      help: (command: string) => `
      Usage
      $ ${command} ...

    Examples
      $ ${command} list
      $ ${command} get <package>
      $ ${command} apply
    `,
    }
    const cli = meowOrExit({ argv, config, importMeta, parentName })
    cli.showHelp(2)
  }

  const subcommand = forwardArgs[0]
  const subcommandArgs = forwardArgs.slice(1)
  if (subcommand === 'list') {
    await runPatchList(subcommandArgs)
    return
  }
  if (subcommand === 'remove' && subcommandArgs.includes('--skip-rollback')) {
    await runPatchRemove(subcommandArgs, dryRun ? 'preview' : 'apply')
    return
  }
  if (dryRun) {
    outputDryRunExecute('socket-patch', forwardArgs, 'socket-patch')
    return
  }

  process.exitCode = 1
  const { spawnPromise } = await spawnSocketPatch(forwardArgs, {
    stdio: 'inherit',
  })
  const result = await spawnPromise
  if (result.code != null && result.code !== 0) {
    process.exitCode = result.code
  } else if (result.code === 0) {
    process.exitCode = 0
  }
}
