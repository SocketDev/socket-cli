#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import path from 'node:path'

import spawn from '@npmcli/promise-spawn'

import { installLinks } from './link'

const realFilename = realpathSync(__filename)
const realDirname = path.dirname(realFilename)

const npxPath = installLinks(path.join(realDirname, 'bin'), 'npx')
const injectionPath = path.join(realDirname, 'npm-injection.js')

process.exitCode = 1

const spawnPromise = spawn(
  process.execPath,
  ['--require', injectionPath, npxPath, ...process.argv.slice(2)],
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
