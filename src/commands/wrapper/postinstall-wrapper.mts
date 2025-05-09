import { existsSync } from 'node:fs'

import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm } from '@socketsecurity/registry/lib/prompts'

import { addSocketWrapper } from './add-socket-wrapper.mts'
import { checkSocketWrapperSetup } from './check-socket-wrapper-setup.mts'
import constants from '../../constants.mts'
// import { getBashrcDetails } from '../../utils/completion.mjs'
// import { debugLog } from '@socketsecurity/registry/lib/debug'
// import { setupTabCompletion } from '../install/setup-tab-completion.mjs'

export async function postinstallWrapper() {
  // Lazily access constants.bashRcPath and constants.zshRcPath.
  const { bashRcPath, zshRcPath } = constants
  const socketWrapperEnabled =
    (existsSync(bashRcPath) && checkSocketWrapperSetup(bashRcPath)) ||
    (existsSync(zshRcPath) && checkSocketWrapperSetup(zshRcPath))

  if (!socketWrapperEnabled) {
    await installSafeNpm(
      `
The Socket CLI is now successfully installed! 🎉

To better protect yourself against supply-chain attacks, our "safe npm" wrapper can warn you about malicious packages whenever you run 'npm install'.

Do you want to install "safe npm" (this will create an alias to the socket-npm command)?
    `.trim()
    )
  }

  // Setting up tab completion requires bashrc modification. I'm not sure it's
  // cool to just do that from an npm install...
  logger.log('Run `socket install completion` to setup bash tab completion')
  // // Attempt to setup tab completion
  // try {
  //   const details = getBashrcDetails("socket")
  //   if (details.ok) {
  //     // Just overwrite it if it already exists
  //     await setupTabCompletion('socket')
  //   }
  // } catch (e) {
  //   debugLog('Failed to setup tab completion:')
  //   debugLog(e);
  //   // Ignore. Skip tab completion setup.
  // }
}

async function installSafeNpm(query: string): Promise<void> {
  logger.log(`
 _____         _       _
|   __|___ ___| |_ ___| |_
|__   | . |  _| '_| -_|  _|
|_____|___|___|_,_|___|_|

`)
  if (
    await confirm({
      message: query,
      default: true
    })
  ) {
    // Lazily access constants.bashRcPath and constants.zshRcPath.
    const { bashRcPath, zshRcPath } = constants
    try {
      if (existsSync(bashRcPath)) {
        addSocketWrapper(bashRcPath)
      }
      if (existsSync(zshRcPath)) {
        addSocketWrapper(zshRcPath)
      }
    } catch (e) {
      throw new Error(
        `There was an issue setting up the alias: ${(e as any)?.['message']}`
      )
    }
  }
}
