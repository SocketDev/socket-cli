import spawn from '@npmcli/promise-spawn'
import meow from 'meow'

import constants from '../constants'
import { commonFlags, validationFlags } from '../flags'
import { printFlagList } from '../utils/formatting'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const { abortSignal } = constants

export const rawNpm: CliSubcommand = {
  description: 'Temporarily disable the Socket npm wrapper',
  async run(argv, importMeta, { parentName }) {
    await setupCommand(
      `${parentName} raw-npm`,
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
      $ ${name} <npm command>

    Options
      ${printFlagList(flags, 6)}

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
  const spawnPromise = spawn('npm', <string[]>argv, {
    signal: abortSignal,
    stdio: 'inherit'
  })
  spawnPromise.process.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
    } else if (code !== null) {
      process.exit(code)
    }
  })
  await spawnPromise
}
