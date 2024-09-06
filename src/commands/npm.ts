import { execSync } from 'node:child_process'
import path from 'node:path'

import spawn from '@npmcli/promise-spawn'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const distPath = __dirname
const description = 'npm wrapper functionality'

export const npm: CliSubcommand = {
  description,
  async run(argv, _importMeta, _ctx) {
    const npmVersion = execSync('npm -v').toString()
    const wrapperPath = path.join(distPath, 'npm-cli.js')

    process.exitCode = 1

    const spawnPromise = spawn(process.execPath, [wrapperPath, ...argv], {
      env: {
        ...process.env,
        NPM_VERSION: npmVersion
      },
      stdio: 'inherit'
    })
    spawnPromise.process.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal)
      } else if (code !== null) {
        process.exit(code)
      }
    })
    await spawnPromise
  }
}
