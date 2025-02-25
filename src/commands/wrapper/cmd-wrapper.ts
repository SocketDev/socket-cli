import fs from 'node:fs'
import os from 'node:os'

import { addSocketWrapper } from './add-socket-wrapper.ts'
import { checkSocketWrapperSetup } from './check-socket-wrapper-setup.ts'
import { postinstallWrapper } from './postinstall-wrapper.ts'
import { removeSocketWrapper } from './remove-socket-wrapper.ts'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const HOME_DIR = os.homedir()
const BASH_FILE = `${HOME_DIR}/.bashrc`
const ZSH_BASH_FILE = `${HOME_DIR}/.zshrc`

const config: CliCommandConfig = {
  commandName: 'wrapper',
  description: 'Enable or disable the Socket npm/npx wrapper',
  hidden: false,
  flags: {
    enable: {
      type: 'boolean',
      default: false,
      description: 'Enables the Socket npm/npx wrapper'
    },
    disable: {
      type: 'boolean',
      default: false,
      description: 'Disables the Socket npm/npx wrapper'
    }
  },
  help: (command, config) => `
    Usage
      $ ${command} <flag>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} --enable
      $ ${command} --disable
  `
}

export const cmdWrapper = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: ReadonlyArray<string>,
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  // I don't think meow would mess with this but ...
  if (argv[0] === '--postinstall') {
    postinstallWrapper()
    return
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  const { disable, enable } = cli.flags
  if (!enable && !disable) {
    cli.showHelp()
    return
  }

  if (enable) {
    if (fs.existsSync(BASH_FILE)) {
      const socketWrapperEnabled = checkSocketWrapperSetup(BASH_FILE)
      !socketWrapperEnabled && addSocketWrapper(BASH_FILE)
    }
    if (fs.existsSync(ZSH_BASH_FILE)) {
      const socketWrapperEnabled = checkSocketWrapperSetup(ZSH_BASH_FILE)
      !socketWrapperEnabled && addSocketWrapper(ZSH_BASH_FILE)
    }
  } else {
    if (fs.existsSync(BASH_FILE)) {
      removeSocketWrapper(BASH_FILE)
    }
    if (fs.existsSync(ZSH_BASH_FILE)) {
      removeSocketWrapper(ZSH_BASH_FILE)
    }
  }
  if (!fs.existsSync(BASH_FILE) && !fs.existsSync(ZSH_BASH_FILE)) {
    console.error(
      'There was an issue setting up the alias in your bash profile'
    )
  }
}
