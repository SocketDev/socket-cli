import fs, { existsSync } from 'node:fs'

import { debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm } from '@socketsecurity/registry/lib/prompts'

import { addSocketWrapper } from './add-socket-wrapper.mts'
import { checkSocketWrapperSetup } from './check-socket-wrapper-setup.mts'
import constants from '../../constants.mts'
import { getBashrcDetails } from '../../utils/completion.mts'
import { updateInstalledTabCompletionScript } from '../install/setup-tab-completion.mts'

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
    `.trim(),
    )
  }

  // Attempt to update the existing tab completion
  let updatedTabCompletion = false
  try {
    const details = getBashrcDetails('') // Note: command is not relevant, we just want the config path
    if (details.ok) {
      if (fs.existsSync(details.data.targetPath)) {
        // Replace the file with the one from this installation
        const result = updateInstalledTabCompletionScript(
          details.data.targetPath,
        )
        if (result.ok) {
          // This will work no matter what alias(es) were registered since that
          // is controlled by bashrc and they all share the same tab script.
          logger.success('Updated the installed Socket tab completion script')
          updatedTabCompletion = true
        }
      }
    }
  } catch (e) {
    debugFn('fail: setup tab completion\n', e)
    // Ignore. Skip tab completion setup.
  }
  if (!updatedTabCompletion) {
    // Setting up tab completion requires bashrc modification. I'm not sure if
    // it's cool to just do that from an npm install...
    logger.log('Run `socket install completion` to setup bash tab completion')
  }
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
      default: true,
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
        `There was an issue setting up the alias: ${(e as any)?.['message']}`,
      )
    }
  }
}
