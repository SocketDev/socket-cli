#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import path from 'node:path'

import { installLinks } from './link'

const realFilename = realpathSync(__filename)
const realDirname = path.dirname(realFilename)

const npxPath = installLinks(path.join(realDirname, 'bin'), 'npx')
const injectionPath = path.join(realDirname, 'npm-injection.js')

process.exitCode = 1

spawn(
  process.execPath,
  ['--require', injectionPath, npxPath, ...process.argv.slice(2)],
  {
    stdio: 'inherit'
  }
).on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
  } else if (code !== null) {
    process.exit(code)
  }
})
