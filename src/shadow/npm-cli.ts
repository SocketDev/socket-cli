#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import path from 'node:path'

import spawn from '@npmcli/promise-spawn'

import constants from '../constants'
import { installLinks } from './link'
import { findRoot } from '../utils/path-resolve'

const { distPath, shadowBinPath } = constants

const npmPath = installLinks(shadowBinPath, 'npm')
const injectionPath = path.join(distPath, 'npm-injection.js')

// Adding the `--quiet` and `--no-progress` flags when the `proc-log` module
// is found to fix a UX issue when running the command with recent versions of
// npm (input swallowed by the standard npm spinner)
const npmArgs: string[] = process.argv.slice(2)
if (
  npmArgs.includes('install') &&
  !npmArgs.includes('--no-progress') &&
  !npmArgs.includes('--quiet')
) {
  const npmEntrypoint = realpathSync(npmPath)
  const npmRootPath = findRoot(path.dirname(npmEntrypoint))
  if (npmRootPath === undefined) {
    process.exit(127)
  }
  const npmDepPath = path.join(npmRootPath, 'node_modules')
  let procLog
  try {
    procLog = require(path.join(npmDepPath, 'proc-log/lib/index.js')).log
  } catch {}
  if (procLog) {
    npmArgs.push('--no-progress', '--quiet')
  }
}

process.exitCode = 1
const spawnPromise = spawn(
  process.execPath,
  [
    '--disable-warning',
    'ExperimentalWarning',
    '--require',
    injectionPath,
    npmPath,
    ...npmArgs
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
void spawnPromise
