import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { FLAG_DRY_RUN, FLAG_HELP } from '../../constants/cli.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { outputDryRunExecute } from '../../util/dry-run/output.mts'
import { getNpmBinPath } from '../../util/npm/paths.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'

export const CMD_NAME = 'raw-npm'

const description = 'Run npm without the Socket wrapper'

const hidden = false

// Helper functions.

export async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: defineFlags({
      ...commonFlags,
    }),
    help: (command: string) => `
    Usage
      $ ${command} ...

    Execute \`npm\` without gating installs through the Socket API.
    Useful when  \`socket wrapper on\` is enabled and you want to bypass
    the Socket wrapper. Use at your own risk.

    Note: Everything after "raw-npm" is passed to the npm command.
          Only the \`${FLAG_DRY_RUN}\` and \`${FLAG_HELP}\` flags are caught here.

    Examples
      $ ${command} install -g cowsay
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const dryRun = cli.flags['dryRun']

  if (dryRun) {
    outputDryRunExecute(getNpmBinPath(), argv, 'raw npm command')
    return
  }

  await runRawNpm(argv)
}

export async function runRawNpm(
  argv: string[] | readonly string[],
): Promise<void> {
  process.exitCode = 1

  const spawnPromise = spawn(getNpmBinPath(), argv, {
    // On Windows, npm is often a .cmd file that requires shell execution.
    // The spawn function from @socketsecurity/registry will handle this properly
    // when shell is true.
    shell: WIN32,
    stdio: 'inherit',
  })

  // See https://nodejs.org/api/child_process.html#event-exit.
  spawnPromise.process.on(
    'exit',
    (code: number | null, signalName: string | null) => {
      if (signalName) {
        process.kill(process.pid, signalName)
      } else if (typeof code === 'number') {
        process.exit(code)
      }
    },
  )

  await spawnPromise
}

// Exported command.

export const cmdRawNpm = {
  description,
  hidden,
  run,
}
