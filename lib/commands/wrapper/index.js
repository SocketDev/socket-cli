/* eslint-disable no-console */
import { exec } from 'child_process'
import fs from 'fs'
import homedir from 'os'
import readline from 'readline'

import meow from 'meow'

import { commandFlags } from '../../flags/index.js'
import { printFlagList } from '../../utils/formatting.js'

const BASH_FILE = `${homedir.homedir()}/.bashrc`
const ZSH_BASH_FILE = `${homedir.homedir()}/.zshrc`

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const wrapper = {
  description: 'Enable or disable the Socket npm/npx wrapper',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' wrapper'

    setupCommand(name, wrapper.description, argv, importMeta)
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
  const flags = commandFlags

  const cli = meow(`
    Usage
      $ ${name} <flag>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} --enable
      $ ${name} --disable
  `, {
    argv,
    description,
    importMeta,
    flags
  })

  const { enable, disable } = cli.flags

  if (argv[0] === '--postinstall') {
    installSafeNpm(`The Socket CLI is now successfully installed! 🎉

    To better protect yourself against supply-chain attacks, our "safe npm" wrapper can warn you about malicious packages whenever you run 'npm install'.

    Do you want to install "safe npm" (this will create an alias to the socket-npm command)? (y/n)`)

    return
  }

  if (!enable && !disable) {
    cli.showHelp()
    return
  }

  if (enable) {
      if (fs.existsSync(BASH_FILE)) {
        addAlias(BASH_FILE)
      } else if (fs.existsSync(ZSH_BASH_FILE)) {
        addAlias(ZSH_BASH_FILE)
      } else {
        console.error('There was an issue setting up the alias in your bash profile')
      }
  } else if (disable) {
    if (fs.existsSync(BASH_FILE)) {
      removeAlias(BASH_FILE)
    } else if (fs.existsSync(ZSH_BASH_FILE)) {
      removeAlias(ZSH_BASH_FILE)
    } else {
      console.error('There was an issue setting up the alias in your bash profile')
    }
  }

  return
}

/**
 * @param {string} query
 * @returns {void}
 */
const installSafeNpm = (query) => {
  console.log(`
 _____         _       _
|   __|___ ___| |_ ___| |_
|__   | . |  _| '_| -_|  _|
|_____|___|___|_,_|___|_|

`)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return askQuestion(rl, query)
}

/**
 * @param {any} rl
 * @param {string} query
 * @returns {void}
 */
const askQuestion = (rl, query) => {
  rl.question(query, (/** @type {string} */ ans) => {
    if (ans.toLowerCase() === 'y') {
      try {
        if (fs.existsSync(BASH_FILE)) {
          addAlias(BASH_FILE)
        } else if (fs.existsSync(ZSH_BASH_FILE)) {
          addAlias(ZSH_BASH_FILE)
        }
      } catch (e) {
        throw new Error(`There was an issue setting up the alias: ${e}`)
      }
      rl.close()
    } else if (ans.toLowerCase() !== 'n') {
      askQuestion(rl, 'Incorrect input: please enter either y (yes) or n (no): ')
    } else {
      rl.close()
    }
  })
}

/**
 * @param {string} file
 * @returns {void}
 */
const addAlias = (file) => {
  exec(`echo "alias npm='socket npm'\nalias npx='socket npx'" >> ${file}`, (err, _, stderr) => {
    if (err) {
      return new Error(`There was an error setting up the alias: ${stderr}`)
    }
    console.log(`
The alias was added to ${file}. Running 'npm install' will now be wrapped in Socket's "safe npm" 🎉
If you want to disable it at any time, run \`socket wrapper --disable\`
`)
  })
}

/**
 * @param {string} file
 * @returns {void}
 */
const removeAlias = (file) => {
  return fs.readFile(file, 'utf8', function (err, data) {
    if (err) {
      console.error(`There was an error removing the alias: ${err}`)
      return
    }
    const linesWithoutSocketAlias = data.split('\n').filter(l => l !== "alias npm='socket npm'" && l !== "alias npx='socket npx'")

    const updatedFileContent = linesWithoutSocketAlias.join('\n')

    fs.writeFile(file, updatedFileContent, function (err) {
      if (err) {
        console.log(err)
        return
      } else {
         console.log(`
The alias was removed from ${file}. Running 'npm install' will now run the standard npm command.
`)
      }
    })
  })
}
