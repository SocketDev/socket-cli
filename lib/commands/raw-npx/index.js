import { spawn } from 'child_process'

import meow from 'meow'

import { validationFlags } from '../../flags/index.js'
import { printFlagList } from '../../utils/formatting.js'

/** @type {import('../../utils/meow-with-subcommands.js').CliSubcommand} */
export const rawNpx = {
  description: 'Temporarily disable the Socket npm/npx wrapper',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' raw-npx'

    setupCommand(name, rawNpx.description, argv, importMeta)
  }
}

/**
 * @param {string} name
 * @param {string} description
 * @param {readonly string[]} argv
 * @param {ImportMeta} importMeta
 * @returns {void}
 */
function setupCommand (name, description, argv, importMeta) {
  const flags = validationFlags

  const cli = meow(`
    Usage
      $ ${name} <npx command>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} install
  `, {
    argv,
    description,
    importMeta,
    flags
  })

  if (!argv[0]) {
    cli.showHelp()
    return
  }

  spawn('npx', [argv.join(' ')], {
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
