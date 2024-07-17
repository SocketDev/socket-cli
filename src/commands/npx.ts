import { spawn } from 'child_process'
import path from 'node:path'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const distPath = __dirname
const description = 'npx wrapper functionality'

export const npx: CliSubcommand = {
  description,
  run: async (argv, _importMeta, _ctx) => {
    const wrapperPath = path.join(distPath, 'npx-cli.js')
    process.exitCode = 1
    spawn(process.execPath, [wrapperPath, ...argv], {
      stdio: 'inherit'
    }).on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal)
      } else if (code !== null) {
        process.exit(code)
      }
    })
  }
}
