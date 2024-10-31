import spawn from '@npmcli/promise-spawn'
import meow from 'meow'

import { commonFlags, validationFlags } from '../flags'
import { printFlagList } from '../utils/formatting'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

export const rawNpx: CliSubcommand = {
  description: 'Temporarily disable the Socket npm/npx wrapper',
  async run(argv, importMeta, { parentName }) {
    await setupCommand(
      `${parentName} raw-npx`,
      rawNpx.description,
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
      $ ${name} <npx command>

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
  const spawnPromise = spawn('npx', [argv.join(' ')], {
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
