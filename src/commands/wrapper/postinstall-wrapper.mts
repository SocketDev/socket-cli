/** @fileoverview Postinstall wrapper utility for Socket CLI. Executes during package installation to set up Socket CLI integration. Prompts user for wrapper installation and manages setup process. */

import fs, { existsSync } from 'node:fs'

import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm } from '@socketsecurity/registry/lib/prompts'

import { addSocketWrapper } from './add-socket-wrapper.mts'
import { checkSocketWrapperSetup } from './check-socket-wrapper-setup.mts'
import constants from '../../constants.mts'
import { getBashrcDetails } from '../../utils/completion.mts'
import { debugDir, debugFn } from '../../utils/debug.mts'
import { getErrorCause } from '../../utils/errors.mts'
import { updateInstalledTabCompletionScript } from '../install/setup-tab-completion.mts'

export async function postinstallWrapper() {
  const { bashRcPath, zshRcPath } = constants
  const socketWrapperEnabled =
    (existsSync(bashRcPath) && checkSocketWrapperSetup(bashRcPath)) ||
    (existsSync(zshRcPath) && checkSocketWrapperSetup(zshRcPath))

  if (!socketWrapperEnabled) {
    await setupShadowNpm(
      `
The Socket CLI is now successfully installed! 🎉

To better protect yourself against supply-chain attacks, our Socket npm wrapper can warn you about malicious packages whenever you run 'npm install'.

Do you want to install the Socket npm wrapper (this will create an alias to the \`socket npm\` command)?
    `.trim(),
    )
  }

  // Attempt to update the existing tab completion
  let updatedTabCompletion = false
  try {
    // Note: command is not relevant, we just want the config path
    const details = getBashrcDetails('')
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
    debugFn('warn', 'Tab completion setup failed (non-fatal)')
    debugDir('warn', e)
    // Ignore. Skip tab completion setup.
  }
  if (!updatedTabCompletion) {
    // Setting up tab completion requires bashrc modification. I'm not sure if
    // it's cool to just do that from an npm install...
    logger.log('Run `socket install completion` to setup bash tab completion')
  }
}

async function setupShadowNpm(query: string): Promise<void> {
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
        `There was an issue setting up the alias: ${getErrorCause(e)}`,
      )
    }
  }
}
