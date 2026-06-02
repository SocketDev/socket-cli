#!/usr/bin/env node
/**
 * @file Build the Socket Trusted Publisher extension and print load-unpacked
 *   instructions for Chrome. Run after setup/token.mts and
 *   setup/native-host.mts. Usage: node
 *   scripts/fleet/setup/trusted-publisher-extension.mts.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..', '..')
const extDir = path.join(repoRoot, 'tools', 'trusted-publisher-extension')

function main(): void {
  const logger = getDefaultLogger()

  logger.log('Building Socket Trusted Publisher extension…')
  const build = spawnSync(
    'pnpm',
    ['--filter', '@socketsecurity/trusted-publisher-extension', 'build'],
    { cwd: repoRoot, stdio: 'inherit' },
  )

  if (build.status !== 0) {
    logger.error('Build failed.')
    process.exitCode = 1
    return
  }

  logger.log('')
  logger.log('Build complete. Load the extension in Chrome:')
  logger.log('')
  logger.log('  1. Open chrome://extensions')
  logger.log('  2. Enable Developer mode (top-right toggle)')
  logger.log('  3. Click "Load unpacked"')
  logger.log(`  4. Select: ${extDir}`)
  logger.log('     (the directory containing manifest.json — not dist/)')
  logger.log('')
  logger.log('Pin the Socket shield icon in the toolbar for easy access.')
  logger.log('')
  logger.log('To verify the native host connection:')
  logger.log('  Open the extension popup → Staged Release Review section.')
  logger.log('  If it shows "token not found", run: pnpm run setup:1-token')
}

main()
