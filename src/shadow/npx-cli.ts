#!/usr/bin/env node

import path from 'node:path'

import spawn from '@npmcli/promise-spawn'

import constants from '../constants'
import { installLinks } from './link'

const { distPath, shadowBinPath } = constants

const npxPath = installLinks(shadowBinPath, 'npx')
const injectionPath = path.join(distPath, 'npm-injection.js')

process.exitCode = 1
const spawnPromise = spawn(
  process.execPath,
  [
    // Lazily access constants.nodeNoWarningsFlags.
    ...constants.nodeNoWarningsFlags,
    '--require',
    injectionPath,
    npxPath,
    ...process.argv.slice(2)
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
