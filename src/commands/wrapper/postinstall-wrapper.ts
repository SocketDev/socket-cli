import fs from 'node:fs'
import os from 'node:os'
import process from 'node:process'
import readline from 'node:readline'

import { addSocketWrapper } from './add-socket-wrapper.ts'
import { checkSocketWrapperSetup } from './check-socket-wrapper-setup.ts'

const HOME_DIR = os.homedir()
const BASH_FILE = `${HOME_DIR}/.bashrc`
const ZSH_BASH_FILE = `${HOME_DIR}/.zshrc`

export function postinstallWrapper() {
  const socketWrapperEnabled =
    (fs.existsSync(BASH_FILE) && checkSocketWrapperSetup(BASH_FILE)) ||
    (fs.existsSync(ZSH_BASH_FILE) && checkSocketWrapperSetup(ZSH_BASH_FILE))

  if (!socketWrapperEnabled) {
    installSafeNpm(`The Socket CLI is now successfully installed! 🎉

      To better protect yourself against supply-chain attacks, our "safe npm" wrapper can warn you about malicious packages whenever you run 'npm install'.

      Do you want to install "safe npm" (this will create an alias to the socket-npm command)? (y/n)`)
  }
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

function askQuestion(rl: readline.Interface, query: string): void {
  rl.question(query, (ans: string) => {
    if (ans.toLowerCase() === 'y') {
      try {
        if (fs.existsSync(BASH_FILE)) {
          addSocketWrapper(BASH_FILE)
        }
        if (fs.existsSync(ZSH_BASH_FILE)) {
          addSocketWrapper(ZSH_BASH_FILE)
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
