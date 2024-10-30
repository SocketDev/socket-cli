#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import path from 'node:path'

import spawn from '@npmcli/promise-spawn'

import { installLinks } from './link'
import { findRoot } from '../utils/path-resolve'

const realFilename = realpathSync(__filename)
const realDirname = path.dirname(realFilename)

const npmPath = installLinks(path.join(realDirname, 'bin'), 'npm')
const injectionPath = path.join(realDirname, 'npm-injection.js')

// Adding the `--quiet` and `--no-progress` flags when the `proc-log` module
// is found to fix a UX issue when running the command with recent versions of
// npm (input swallowed by the standard npm spinner)
let npmArgs: string[] = []
if (process.argv.slice(2).includes('install')) {
  const npmEntrypoint = realpathSync(npmPath)
  const npmRootPath = findRoot(path.dirname(npmEntrypoint))
  if (npmRootPath === undefined) {
    process.exit(127)
  }
  const npmDepPath = path.join(npmRootPath, 'node_modules')
  let npmlog
  try {
    npmlog = require(path.join(npmDepPath, 'proc-log/lib/index.js')).log
  } catch {}
  if (npmlog) {
    npmArgs = ['--quiet', '--no-progress']
  }
}

process.exitCode = 1
const spawnPromise = spawn(
  process.execPath,
  ['--require', injectionPath, npmPath, ...process.argv.slice(2), ...npmArgs],
  {
    stdio: 'inherit'
  }
)
spawnPromise.process.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
  } else if (code !== null) {
    process.exit(code)
  }
})
void spawnPromise
