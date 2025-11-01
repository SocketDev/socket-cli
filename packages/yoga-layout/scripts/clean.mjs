/**
 * Clean yoga-layout build artifacts.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanCheckpoint } from '@socketsecurity/build-infra/lib/checkpoint-manager'
import { printHeader, printSuccess } from '@socketsecurity/build-infra/lib/build-output'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT_DIR = path.join(__dirname, '..')
const BUILD_DIR = path.join(ROOT_DIR, 'build')

async function main() {
  printHeader('Cleaning yoga-layout')

  // Remove build directory (includes source).
  await fs.rm(BUILD_DIR, { recursive: true, force: true }).catch(() => {})

  // Clean checkpoints.
  await cleanCheckpoint('yoga-layout')

  printSuccess('Clean complete')
}

main().catch((e) => {
  getDefaultLogger().error('Clean failed:', e.message)
  process.exit(1)
})
