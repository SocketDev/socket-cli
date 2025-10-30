/**
 * Clean onnxruntime build artifacts.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { logger } from '@socketsecurity/lib/logger'
import { cleanCheckpoint } from '@socketsecurity/build-infra/lib/checkpoint-manager'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, '..')
const BUILD_DIR = path.join(ROOT_DIR, 'build')

async function clean() {
  logger.info('Cleaning onnxruntime build artifacts...')

  try {
    await fs.rm(BUILD_DIR, { recursive: true, force: true })
    logger.success('Build directory cleaned')
  } catch (e) {
    logger.warn(`Could not clean build directory: ${e.message}`)
  }

  await cleanCheckpoint('onnxruntime')
  logger.success('Checkpoints cleaned')
}

clean().catch(e => {
  logger.error(e.message)
  process.exit(1)
})
