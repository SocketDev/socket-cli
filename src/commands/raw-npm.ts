import { spawn } from 'node:child_process'

import meow from 'meow'

import { validationFlags } from '../flags'
import { printFlagList } from '../utils/formatting'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

export const rawNpm: CliSubcommand = {
  description: 'Temporarily disable the Socket npm wrapper',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} raw-npm`
    setupCommand(name, rawNpm.description, argv, importMeta)
  }
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): void {
  const flags: { [key: string]: any } = validationFlags

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

  if (!argv[0]) {
    cli.showHelp()
    return
  }

  spawn('npm', [argv.join(' ')], {
    stdio: 'inherit',
    shell: true
  }).on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
    } else if (code !== null) {
      process.exit(code)
    }
  })
}
