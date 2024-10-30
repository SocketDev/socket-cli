import path from 'node:path'

import spawn from '@npmcli/promise-spawn'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const distPath = __dirname
const description = 'npx wrapper functionality'

export const npx: CliSubcommand = {
  description,
  async run(argv, _importMeta, _ctx) {
    const wrapperPath = path.join(distPath, 'npx-cli.js')
    process.exitCode = 1
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
