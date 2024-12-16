import { realpathSync } from 'node:fs'
import path from 'node:path'

import spawn from '@npmcli/promise-spawn'

import constants from '../constants'
import { installLinks } from './link'
import { findRoot } from '../utils/path-resolve'

const { distPath, execPath, shadowBinPath } = constants

const injectionPath = path.join(distPath, 'npm-injection.js')

export default async function shadow(binName: 'npm' | 'npx') {
  const binPath = await installLinks(shadowBinPath, binName)
  // Adding the `--quiet` and `--no-progress` flags when the `proc-log` module
  // is found to fix a UX issue when running the command with recent versions of
  // npm (input swallowed by the standard npm spinner)
  const binArgs: string[] = process.argv.slice(2)

  if (
    binName === 'npm' &&
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
    { stdio: 'inherit' }
  )
  spawnPromise.process.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
    } else if (code !== null) {
      process.exit(code)
    }
  })
  await spawnPromise
}
