#!/usr/bin/env node
/**
 * Node.js Internal Bootstrap
 *
 * This file is loaded by the custom Node.js binary at startup via
 * internal/bootstrap/socketsecurity module.
 *
 * Responsibilities:
 * - Check if @socketsecurity/cli is installed in ~/.socket/_dlx/cli/
 * - If not installed: download and extract from npm
 * - Spawn the CLI with current arguments
 *
 * Size target: <2KB after minification + brotli compression
 * Build output: dist/bootstrap/node.js (copied to Node.js source)
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

import { getCliEntryPoint, getCliPackageDir } from './shared/paths.mjs'

/**
 * Check if CLI is installed.
 */
function isCliInstalled(): boolean {
  const entryPoint = getCliEntryPoint()
  const packageJson = `${getCliPackageDir()}/package.json`
  return existsSync(entryPoint) && existsSync(packageJson)
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  // Check if CLI is already installed.
  if (!isCliInstalled()) {
    // TODO: Implement download logic using shared utilities.
    console.error('Socket CLI not installed yet.')
    console.error('Installing from npm...')
    console.error('TODO: Implement download from npm registry')
    process.exit(1)
  }

  // CLI is installed, delegate to it.
  const cliPath = getCliEntryPoint()
  const args = process.argv.slice(2)

  const child = spawn(process.execPath, [cliPath, ...args], {
    stdio: 'inherit',
    env: process.env,
  })

  child.on('error', error => {
    console.error('Failed to spawn CLI:', error)
    process.exit(1)
  })

  child.on('exit', code => {
    process.exit(code ?? 0)
  })
}

// Only run if executed directly (not when loaded as module).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Bootstrap error:', error)
    process.exit(1)
  })
}
