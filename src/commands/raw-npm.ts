import spawn from '@npmcli/promise-spawn'
import meow from 'meow'

import constants from '../constants'
import { commonFlags, validationFlags } from '../flags'
import { getFlagListOutput } from '../utils/formatting'
import { findBinPathDetails } from '../utils/path-resolve'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const { NPM, abortSignal } = constants

const binName = NPM

export const rawNpm: CliSubcommand = {
  description: `Temporarily disable the Socket ${binName} wrapper`,
  async run(argv, importMeta, { parentName }) {
    await setupCommand(
      `${parentName} raw-${binName}`,
      rawNpm.description,
      argv,
      importMeta
    )
  }
}

async function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): Promise<void> {
  const flags: { [key: string]: any } = {
    ...commonFlags,
    ...validationFlags
  }
  const cli = meow(
    `
    Usage
      $ ${name} <${binName} command>

    Options
      ${getFlagListOutput(flags, 6)}

    Examples
      $ ${name} install
  `,
    {
      argv,
      description,
      importMeta,
      flags
    }
  )
  let showHelp = cli.flags['help']
  if (!argv[0]) {
    showHelp = true
  }
  if (showHelp) {
    cli.showHelp()
    return
  }
  const { path: binPath } = await findBinPathDetails(binName)
  if (!binPath) {
    // The exit code 127 indicates that the command or binary being executed
    // could not be found.
    console.error(
      `Socket unable to locate ${binName}; ensure it is available in the PATH environment variable.`
    )
    process.exit(127)
  }
  const spawnPromise = spawn(binPath, <string[]>argv, {
    signal: abortSignal,
    stdio: 'inherit'
  })
  // See https://nodejs.org/api/all.html#all_child_process_event-exit.
  spawnPromise.process.on('exit', (code, signalName) => {
    if (abortSignal.aborted) {
      return
    }
    if (signalName) {
      process.kill(process.pid, signalName)
    } else if (code !== null) {
      process.exit(code)
    }
  })
  await spawnPromise
}
