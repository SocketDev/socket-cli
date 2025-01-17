import path from 'node:path'
import process from 'node:process'

import spawn from '@npmcli/promise-spawn'

import { installLinks } from './link'
import constants from '../constants'

const { NPM, abortSignal } = constants

export default async function shadowBin(
  binName: 'npm' | 'npx',
  binArgs = process.argv.slice(2)
) {
  process.exitCode = 1
  const spawnPromise = spawn(
    // Lazily access constants.execPath.
    constants.execPath,
    [
      // Lazily access constants.nodeNoWarningsFlags.
      ...constants.nodeNoWarningsFlags,
      '--require',
      // Lazily access constants.distPath.
      path.join(constants.distPath, 'npm-injection.js'),
      // Lazily access constants.shadowBinPath.
      await installLinks(constants.shadowBinPath, binName),
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
