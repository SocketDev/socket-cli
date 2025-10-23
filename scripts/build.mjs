#!/usr/bin/env node

/**
 * Unified build script router.
 * Routes build commands to appropriate packages based on --target flag.
 */

import { spawnSync } from 'node:child_process'
import process from 'node:process'

const TARGET_PACKAGES = {
  __proto__: null,
  all: './packages/**',
  'alpine-arm64': '@socketbin/cli-alpine-arm64',
  'alpine-x64': '@socketbin/cli-alpine-x64',
  cli: '@socketsecurity/cli',
  'cli-sentry': '@socketsecurity/cli-with-sentry',
  'darwin-arm64': '@socketbin/cli-darwin-arm64',
  'darwin-x64': '@socketbin/cli-darwin-x64',
  'linux-arm64': '@socketbin/cli-linux-arm64',
  'linux-x64': '@socketbin/cli-linux-x64',
  node: '@socketbin/custom-node',
  sea: '@socketbin/sea',
  socket: 'socket',
  'win32-arm64': '@socketbin/cli-win32-arm64',
  'win32-x64': '@socketbin/cli-win32-x64'
}

const args = process.argv.slice(2)
let target = 'cli'
const buildArgs = []

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--target' && i + 1 < args.length) {
    target = args[++i]
  } else {
    buildArgs.push(arg)
  }
}

const packageFilter = TARGET_PACKAGES[target]
if (!packageFilter) {
  console.error(`Unknown build target: ${target}`)
  console.error(`Available targets: ${Object.keys(TARGET_PACKAGES).join(', ')}`)
  process.exit(1)
}

const pnpmArgs = [
  '--filter',
  packageFilter,
  'run',
  'build',
  ...buildArgs
]

const result = spawnSync('pnpm', pnpmArgs, {
  encoding: 'utf8',
  shell: false,
  stdio: 'inherit'
})

process.exit(result.status ?? 1)
