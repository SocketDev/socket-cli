/**
 * Clean codet5-models build artifacts.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanCheckpoint } from '@socketsecurity/build-infra/lib/checkpoint-manager'
import { exec } from '@socketsecurity/build-infra/lib/build-exec'
import { printHeader, printSuccess } from '@socketsecurity/build-infra/lib/build-output'
import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT_DIR = path.join(__dirname, '..')
const MODELS_DIR = path.join(ROOT_DIR, '.models')
const BUILD_DIR = path.join(ROOT_DIR, 'build')

async function main() {
  printHeader('Cleaning codet5-models')

  // Remove models directory.
  await exec(`rm -rf ${MODELS_DIR}`, { stdio: 'inherit' })

  // Remove build directory.
  await exec(`rm -rf ${BUILD_DIR}`, { stdio: 'inherit' })

  // Clean checkpoints.
  await cleanCheckpoint('codet5-models')

  printSuccess('Clean complete')
}

main().catch((e) => {
  logger.error('Clean failed:', e.message)
  process.exit(1)
})
