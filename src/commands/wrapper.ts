import fs from 'node:fs'
import os from 'node:os'
import process from 'node:process'
import readline from 'node:readline'

import meow from 'meow'

import { commandFlags } from '../flags'
import { getFlagListOutput } from '../utils/output-formatting'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const HOME_DIR = os.homedir()
const BASH_FILE = `${HOME_DIR}/.bashrc`
const ZSH_BASH_FILE = `${HOME_DIR}/.zshrc`

const description = 'Enable or disable the Socket npm/npx wrapper'

export const wrapperCommand: CliSubcommand = {
  description,
  async run(
    argv: readonly string[],
    importMeta: ImportMeta,
    { parentName }: { parentName: string }
  ) {
    setupCommand(`${parentName} wrapper`, description, argv, importMeta)
  }
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): void {
  const flags: { [key: string]: any } = commandFlags
  const cli = meow(
    `
    Usage
      $ ${name} <flag>

    Options
      ${getFlagListOutput(flags, 6)}

    Examples
      $ ${name} --enable
      $ ${name} --disable
  `,
    {
      argv,
      description,
      importMeta,
      flags
    }
  )
  if (argv[0] === '--postinstall') {
    const socketWrapperEnabled =
      (fs.existsSync(BASH_FILE) && checkSocketWrapperAlreadySetup(BASH_FILE)) ||
      (fs.existsSync(ZSH_BASH_FILE) &&
        checkSocketWrapperAlreadySetup(ZSH_BASH_FILE))

    if (!socketWrapperEnabled) {
      installSafeNpm(`The Socket CLI is now successfully installed! 🎉

      To better protect yourself against supply-chain attacks, our "safe npm" wrapper can warn you about malicious packages whenever you run 'npm install'.

      Do you want to install "safe npm" (this will create an alias to the socket-npm command)? (y/n)`)
    }
    return
  }
  const { disable, enable } = cli.flags
  let showHelp = cli.flags['help']
  if (!enable && !disable) {
    showHelp = true
  }
  if (showHelp) {
    cli.showHelp()
    return
  }
  if (enable) {
    if (fs.existsSync(BASH_FILE)) {
      const socketWrapperEnabled = checkSocketWrapperAlreadySetup(BASH_FILE)
      !socketWrapperEnabled && addAlias(BASH_FILE)
    }
    if (fs.existsSync(ZSH_BASH_FILE)) {
      const socketWrapperEnabled = checkSocketWrapperAlreadySetup(ZSH_BASH_FILE)
      !socketWrapperEnabled && addAlias(ZSH_BASH_FILE)
    }
  } else if (disable) {
    if (fs.existsSync(BASH_FILE)) {
      removeAlias(BASH_FILE)
    }
    if (fs.existsSync(ZSH_BASH_FILE)) {
      removeAlias(ZSH_BASH_FILE)
    }
  }
  if (!fs.existsSync(BASH_FILE) && !fs.existsSync(ZSH_BASH_FILE)) {
    console.error(
      'There was an issue setting up the alias in your bash profile'
    )
  }
}

function addAlias(file: string): void {
  return fs.appendFile(
    file,
    'alias npm="socket npm"\nalias npx="socket npx"\n',
    err => {
      if (err) {
        return new Error(`There was an error setting up the alias: ${err}`)
      }
      console.log(`
The alias was added to ${file}. Running 'npm install' will now be wrapped in Socket's "safe npm" 🎉
If you want to disable it at any time, run \`socket wrapper --disable\`
`)
    }
  )
}

function askQuestion(rl: readline.Interface, query: string): void {
  rl.question(query, (ans: string) => {
    if (ans.toLowerCase() === 'y') {
      try {
        if (fs.existsSync(BASH_FILE)) {
          addAlias(BASH_FILE)
        }
        if (fs.existsSync(ZSH_BASH_FILE)) {
          addAlias(ZSH_BASH_FILE)
        }
      } catch (e) {
        throw new Error(`There was an issue setting up the alias: ${e}`)
      }
      rl.close()
    } else if (ans.toLowerCase() !== 'n') {
      askQuestion(
        rl,
        'Incorrect input: please enter either y (yes) or n (no): '
      )
    } else {
      rl.close()
    }
  })
}

function checkSocketWrapperAlreadySetup(file: string): boolean {
  const fileContent = fs.readFileSync(file, 'utf8')
  const linesWithSocketAlias = fileContent
    .split('\n')
    .filter(
      l => l === 'alias npm="socket npm"' || l === 'alias npx="socket npx"'
    )

  if (linesWithSocketAlias.length) {
    console.log(
      `The Socket npm/npx wrapper is set up in your bash profile (${file}).`
    )
    return true
  }
  return false
}

function installSafeNpm(query: string): void {
  console.log(`
 _____         _       _
|   __|___ ___| |_ ___| |_
|__   | . |  _| '_| -_|  _|
|_____|___|___|_,_|___|_|

`)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  return askQuestion(rl, query)
}

function removeAlias(file: string): void {
  return fs.readFile(file, 'utf8', function (err, data) {
    if (err) {
      console.error(`There was an error removing the alias: ${err}`)
      return
    }
    const linesWithoutSocketAlias = data
      .split('\n')
      .filter(
        l => l !== 'alias npm="socket npm"' && l !== 'alias npx="socket npx"'
      )

    const updatedFileContent = linesWithoutSocketAlias.join('\n')

    fs.writeFile(file, updatedFileContent, function (err) {
      if (err) {
        console.log(err)
        return
      } else {
        console.log(
          `\nThe alias was removed from ${file}. Running 'npm install' will now run the standard npm command.\n`
        )
      }
    })
  })
}
