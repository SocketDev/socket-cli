import path from 'node:path'

import spawn from '@npmcli/promise-spawn'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import constants from '../constants'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const { SOCKET_CLI_FIX_PACKAGE_LOCK_FILE, abortSignal, execPath, rootBinPath } =
  constants

export const fix: CliSubcommand = {
  description: 'Fix "fixable" Socket alerts',
  async run() {
    const wrapperPath = path.join(rootBinPath, 'npm-cli.js')
    const npmSpawnOptions: Parameters<typeof spawn>[2] = {
      signal: abortSignal,
      stdio: 'ignore',
      env: {
        ...process.env,
        [SOCKET_CLI_FIX_PACKAGE_LOCK_FILE]: '1'
      }
    }
    const spinner = new Spinner().start()
    try {
      await spawn(
        execPath,
        [wrapperPath, 'install', '--silent'],
        npmSpawnOptions
      )
    } finally {
      spinner.stop()
    }
  }
}
