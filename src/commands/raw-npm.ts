import process from 'node:process'

import spawn from '@npmcli/promise-spawn'
import meow from 'meow'

import constants from '../constants'
import { commonFlags, validationFlags } from '../flags'
import { getNpmBinPath } from '../shadow/npm-paths'
import { getFlagListOutput } from '../utils/output-formatting'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const { NPM, abortSignal } = constants

const binName = NPM

const description = `Temporarily disable the Socket ${binName} wrapper`

export const rawNpmCommand: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    await setupCommand(
      `${parentName} raw-${binName}`,
      description,
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
  const spawnPromise = spawn(getNpmBinPath(), <string[]>argv, {
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
