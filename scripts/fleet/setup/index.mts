#!/usr/bin/env node
/**
 * @file Full repo setup wizard — runs all setup steps in order. Each step is
 *   also runnable independently via pnpm run setup:<name>. Usage: pnpm
 *   setup-all pnpm setup-all --rotate pnpm setup-all --skip-tools pnpm
 *   setup-all --skip-native-host.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..', '..')

function run(script: string, extraArgs: string[] = []): boolean {
  const r = spawnSync(
    'node',
    ['--experimental-strip-types', script, ...extraArgs],
    { cwd: repoRoot, stdio: 'inherit' },
  )
  return r.status === 0
}

function main(): void {
  const logger = getDefaultLogger()
  const argv = process.argv.slice(2)
  const rotate = argv.includes('--rotate')
  const skipNativeHost = argv.includes('--skip-native-host')
  const skipTools = argv.includes('--skip-tools')

  const results: Array<[string, boolean]> = []

  logger.log('=== Socket Repo Setup ===')
  logger.log('')

  logger.log('── Token ──────────────────────────────────')
  results.push([
    'Token',
    run(path.join(__dirname, 'token.mts'), rotate ? ['--rotate'] : []),
  ])
  logger.log('')

  if (!skipNativeHost) {
    logger.log('── Native Messaging Host ──────────────────')
    results.push(['Native host', run(path.join(__dirname, 'native-host.mts'))])
    logger.log('')
  }

  logger.log('── Trusted Publisher Extension ────────────')
  results.push([
    'Extension',
    run(path.join(__dirname, 'trusted-publisher-extension.mts')),
  ])
  logger.log('')

  if (!skipTools) {
    logger.log('── Security Tools ─────────────────────────')
    results.push([
      'Security tools',
      run(
        path.join(
          repoRoot,
          '.claude',
          'hooks',
          'fleet',
          'setup-security-tools',
          'install.mts',
        ),
      ),
    ])
    logger.log('')
  }

  logger.log('=== Summary ===')
  for (const [name, ok] of results) {
    logger.log(`  ${ok ? '✓' : '✗'} ${name}`)
  }

  if (!results.every(([, ok]) => ok)) {
    logger.error('')
    logger.warn('Some steps failed — see above.')
    process.exitCode = 1
  } else {
    logger.log('')
    logger.log('All setup steps complete.')
  }
}

main()
