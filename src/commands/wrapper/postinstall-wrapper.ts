import { existsSync } from 'node:fs'
import process from 'node:process'
import readline from 'node:readline'

import { logger } from '@socketsecurity/registry/lib/logger'

import { addSocketWrapper } from './add-socket-wrapper'
import { checkSocketWrapperSetup } from './check-socket-wrapper-setup'
import constants from '../../constants'

export function postinstallWrapper() {
  // Lazily access constants.bashRcPath and constants.zshRcPath.
  const { bashRcPath, zshRcPath } = constants
  const socketWrapperEnabled =
    (existsSync(bashRcPath) && checkSocketWrapperSetup(bashRcPath)) ||
    (existsSync(zshRcPath) && checkSocketWrapperSetup(zshRcPath))

  if (!socketWrapperEnabled) {
    installSafeNpm(`The Socket CLI is now successfully installed! 🎉

      To better protect yourself against supply-chain attacks, our "safe npm" wrapper can warn you about malicious packages whenever you run 'npm install'.

      Do you want to install "safe npm" (this will create an alias to the socket-npm command)? (y/n)`)
  }
}

function installSafeNpm(query: string): void {
  logger.log(`
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
      // Lazily access constants.bashRcPath and constants.zshRcPath.
      const { bashRcPath, zshRcPath } = constants
      try {
        if (existsSync(bashRcPath)) {
          addSocketWrapper(bashRcPath)
        }
        if (existsSync(zshRcPath)) {
          addSocketWrapper(zshRcPath)
        }
      } catch (e: any) {
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
