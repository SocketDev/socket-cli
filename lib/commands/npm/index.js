import { spawn, execSync } from 'child_process'
import { fileURLToPath } from 'url'

const description = 'npm wrapper functionality'

/** @type {import('../../utils/meow-with-subcommands.js').CliSubcommand} */
export const npm = {
  description,
  run: async (argv, _importMeta, _ctx) => {
    const npmVersion = execSync('npm -v').toString()
    const wrapperPath = fileURLToPath(new URL('../../shadow/npm-cli.cjs', import.meta.url))
    process.exitCode = 1
    spawn(process.execPath, [wrapperPath, ...argv], {
      stdio: 'inherit',
      env: {
        ...process.env,
        NPM_VERSION: npmVersion
      }
    }).on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal)
      } else if (code !== null) {
        process.exit(code)
      }
    })
  }
}
