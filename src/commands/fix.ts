import path from 'node:path'

import spawn from '@npmcli/promise-spawn'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import constants from '../constants'
import { shadowNpmInstall } from '../utils/shadow-npm'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const { SOCKET_CLI_FIX_PACKAGE_LOCK_FILE } = constants

export const fix: CliSubcommand = {
  description: 'Fix "fixable" Socket alerts',
  async run() {
    const spinner = new Spinner().start()
    try {
      await shadowNpmInstall({
        env: {
          [SOCKET_CLI_FIX_PACKAGE_LOCK_FILE]: '1'
        }
      })
    } catch (e: any) {
      console.error(e)
    } finally {
      spinner.stop()
    }
  }
}
