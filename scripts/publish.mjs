#!/usr/bin/env node

/**
 * Unified publish script router.
 * Routes publish commands to appropriate packages based on --target flag.
 */

import process from 'node:process'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

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
  node: '@socketbin/node-smol-builder-builder',
  sea: '@socketbin/node-sea-builder-builder',
  socket: 'socket',
  'win32-arm64': '@socketbin/cli-win32-arm64',
  'win32-x64': '@socketbin/cli-win32-x64'
}

const args = process.argv.slice(2)
let target = 'cli'
const publishArgs = []

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--target' && i + 1 < args.length) {
    target = args[++i]
  } else {
    publishArgs.push(arg)
  }
}

async function main() {
  const packageFilter = TARGET_PACKAGES[target]
  if (!packageFilter) {
    getDefaultLogger().error(`Unknown publish target: ${target}`)
    getDefaultLogger().error(`Available targets: ${Object.keys(TARGET_PACKAGES).join(', ')}`)
    process.exit(1)
  }

  // Special handling for 'all' target.
  if (target === 'all') {
    getDefaultLogger().log('Publishing all packages...')
    getDefaultLogger().log('Note: Packages are published in dependency order by pnpm')
  }

  const pnpmArgs = [
    '--filter',
    packageFilter,
    'publish',
    ...publishArgs
  ]

  getDefaultLogger().log(`Publishing ${target}...`)
  getDefaultLogger().log(`Command: pnpm ${pnpmArgs.join(' ')}`)
  getDefaultLogger().log('')

  const result = await spawn('pnpm', pnpmArgs, {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (result.code === 0) {
    getDefaultLogger().log('')
    getDefaultLogger().success(`Successfully published ${target}`)
  } else {
    getDefaultLogger().log('')
    getDefaultLogger().error(`Failed to publish ${target}`)
  }

  process.exit(result.code ?? 1)
}

main().catch(e => {
  getDefaultLogger().error(e)
  process.exit(1)
})
