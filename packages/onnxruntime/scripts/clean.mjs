/**
 * Clean onnxruntime build artifacts.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { cleanCheckpoint } from '@socketsecurity/build-infra/lib/checkpoint-manager'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, '..')
const BUILD_DIR = path.join(ROOT_DIR, 'build')

async function clean() {
  const logger = getDefaultLogger()
  logger.info('Cleaning onnxruntime build artifacts...')

  await safeDelete(BUILD_DIR)
  logger.success('Build directory cleaned')

  await cleanCheckpoint('onnxruntime')
  logger.success('Checkpoints cleaned')
}

clean().catch(e => {
  logger.error(e.message)
  process.exit(1)
})
