import { Spinner } from '@socketsecurity/registry/lib/spinner'

import constants from '../constants'
import { shadowNpmInstall } from '../utils/npm'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const { SOCKET_CLI_IN_FIX_CMD, SOCKET_IPC_HANDSHAKE } = constants

export const fix: CliSubcommand = {
  description: 'Fix "fixable" Socket alerts',
  hidden: true,
  async run() {
    const spinner = new Spinner().start()
    try {
      await shadowNpmInstall({
        ipc: {
          [SOCKET_IPC_HANDSHAKE]: {
            [SOCKET_CLI_IN_FIX_CMD]: true
          }
        }
      })
    } catch (e: any) {
      console.error(e)
    } finally {
      spinner.stop()
    }
  }
}
