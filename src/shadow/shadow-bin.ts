import { realpathSync } from 'node:fs'
import path from 'node:path'

import spawn from '@npmcli/promise-spawn'

import constants from '../constants'
import { installLinks } from './link'
import { findRoot } from '../utils/path-resolve'

const { NPM, abortSignal, distPath, execPath, shadowBinPath } = constants

const injectionPath = path.join(distPath, 'npm-injection.js')

export default async function shadow(
  binName: 'npm' | 'npx',
  binArgs = process.argv.slice(2)
) {
  const binPath = await installLinks(shadowBinPath, binName)
  if (abortSignal.aborted) {
    return
  }
  // Adding the `--quiet` and `--no-progress` flags when the `proc-log` module
  // is found to fix a UX issue when running the command with recent versions of
  // npm (input swallowed by the standard npm spinner)
  if (
    binName === NPM &&
    binArgs.includes('install') &&
    !binArgs.includes('--no-progress') &&
    !binArgs.includes('--quiet')
  ) {
    const npmEntrypoint = realpathSync(binPath)
    const npmRootPath = findRoot(path.dirname(npmEntrypoint))
    if (npmRootPath === undefined) {
      // The exit code 127 indicates that the command or binary being executed
      // could not be found.
      process.exit(127)
    }
    const npmDepPath = path.join(npmRootPath, 'node_modules')
    let procLog
    try {
      procLog = require(path.join(npmDepPath, 'proc-log/lib/index.js')).log
    } catch {}
    if (procLog) {
      binArgs.push('--no-progress', '--quiet')
    }
  }

  process.exitCode = 1
  const spawnPromise = spawn(
    execPath,
    [
      // Lazily access constants.nodeNoWarningsFlags.
      ...constants.nodeNoWarningsFlags,
      '--require',
      injectionPath,
      binPath,
      ...binArgs
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
