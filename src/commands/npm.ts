import path from 'node:path'

import spawn from '@npmcli/promise-spawn'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const distPath = __dirname
const description = 'npm wrapper functionality'

export const npm: CliSubcommand = {
  description,
  async run(argv, _importMeta, _ctx) {
    process.exitCode = 1
    const wrapperPath = path.join(distPath, 'npm-cli.js')
    const spawnPromise = spawn(process.execPath, [wrapperPath, ...argv], {
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
