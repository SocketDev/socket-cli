#!/usr/bin/env node
/**
 * @fileoverview Pre-e2e build script
 * Ensures SEA and smol binaries exist before running e2e tests.
 * Builds SEA if missing (fast ~10s), warns about smol if missing (slow 30-60min).
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { logger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_DIR = path.resolve(__dirname, '..')
const MONOREPO_ROOT = path.resolve(CLI_DIR, '../..')

const BINARIES = {
  __proto__: null,
  sea: {
    buildCommand: ['pnpm', '--filter', '@socketbin/node-sea-builder', 'run', 'build'],
    name: 'SEA Binary',
    path: path.join(CLI_DIR, 'dist/socket-sea'),
  },
  smol: {
    buildCommand: ['pnpm', '--filter', '@socketbin/node-smol-builder', 'run', 'build'],
    name: 'Smol Binary',
    path: path.join(CLI_DIR, 'dist/socket-smol'),
  },
}

async function buildBinary(type) {
  const binary = BINARIES[type]

  logger.log('')
  logger.log(`${colors.blue('ℹ')} ${binary.name} not found at ${binary.path}`)
  logger.log(`${colors.blue('ℹ')} Building ${binary.name}...`)
  logger.log(`${colors.blue('ℹ')} Running: ${binary.buildCommand.join(' ')}`)
  logger.log('')

  try {
    const result = await spawn(binary.buildCommand[0], binary.buildCommand.slice(1), {
      cwd: MONOREPO_ROOT,
      stdio: 'inherit',
    })

    if (result.code !== 0) {
      throw new Error(`Build failed with exit code ${result.code}`)
    }

    logger.log('')
    logger.success(`${binary.name} built successfully`)
    return true
  } catch (e) {
    logger.log('')
    logger.error(`Failed to build ${binary.name}: ${e.message}`)
    return false
  }
}

async function main() {
  logger.log('')
  logger.log('═══════════════════════════════════════════════════════')
  logger.log('  Pre-E2E Build Check')
  logger.log('═══════════════════════════════════════════════════════')
  logger.log('')

  const seaExists = existsSync(BINARIES.sea.path)
  const smolExists = existsSync(BINARIES.smol.path)

  logger.log(`${colors.blue('ℹ')} Checking for required binaries...`)
  logger.log('')

  if (seaExists) {
    logger.success(`${BINARIES.sea.name} found at ${BINARIES.sea.path}`)
  }

  if (smolExists) {
    logger.success(`${BINARIES.smol.name} found at ${BINARIES.smol.path}`)
  }

  logger.log('')

  // Build SEA if missing (fast build ~10s).
  if (!seaExists) {
    logger.log(`${colors.yellow('⚠')} ${BINARIES.sea.name} is missing`)
    const built = await buildBinary('sea')
    if (!built) {
      logger.log('')
      logger.error('Failed to build SEA binary')
      logger.log('')
      process.exit(1)
    }
  }

  // Build smol if missing (note about potential build time).
  if (!smolExists) {
    logger.log('')
    logger.log(`${colors.yellow('⚠')} ${BINARIES.smol.name} is missing`)
    logger.log(`${colors.yellow('⚠')} Note: smol build may take 30-60 minutes on first build`)
    logger.log(`${colors.blue('ℹ')} Subsequent builds are faster with caching (ninja)`)
    logger.log('')
    const built = await buildBinary('smol')
    if (!built) {
      logger.log('')
      logger.log(`${colors.yellow('⚠')} Failed to build smol binary`)
      logger.log(`${colors.blue('ℹ')} E2E tests will run without smol binary (smol tests will be skipped)`)
      logger.log('')
    }
  }

  logger.log('═══════════════════════════════════════════════════════')
  logger.success('Pre-E2E build check complete')
  logger.log('═══════════════════════════════════════════════════════')
  logger.log('')
}

main().catch(e => {
  logger.error('Pre-E2E build failed:', e)
  process.exit(1)
})
