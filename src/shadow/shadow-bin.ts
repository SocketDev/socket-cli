import path from 'node:path'

import spawn from '@npmcli/promise-spawn'

import constants from '../constants'
import { installLinks } from './link'

const { NPM, abortSignal, distPath, execPath, shadowBinPath } = constants

const injectionPath = path.join(distPath, 'npm-injection.js')

export default async function shadow(
  binName: 'npm' | 'npx',
  binArgs = process.argv.slice(2)
) {
  process.exitCode = 1
  const spawnPromise = spawn(
    execPath,
    [
      // Lazily access constants.nodeNoWarningsFlags.
      ...constants.nodeNoWarningsFlags,
      '--require',
      injectionPath,
      await installLinks(shadowBinPath, binName),
      ...binArgs,
      // Add the `--quiet` and `--no-progress` flags to fix input being swallowed
      // by the spinner when running the command with recent versions of npm.
      ...(binName === NPM &&
      binArgs.includes('install') &&
      !binArgs.includes('--no-progress') &&
      !binArgs.includes('--quiet')
        ? ['--no-progress', '--quiet']
        : [])
    ],
    {
      signal: abortSignal,
      stdio: 'inherit'
    }
  )
  // See https://nodejs.org/api/all.html#all_child_process_event-exit.
  spawnPromise.process.on('exit', (code, signalName) => {
    if (abortSignal.aborted) {
      return
    }
    if (signalName) {
      process.kill(process.pid, signalName)
    } else if (code !== null) {
      process.exit(code)
    }
  })
  await spawnPromise
}
