/**
 * Generate socket package directory from template.
 * Creates the socket npm wrapper package that will be used
 * for publishing the CLI with optional binary dependencies.
 *
 * Usage:
 *   node scripts/generate-socket-package.mjs
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const logger = getDefaultLogger()

/**
 * Copy directory recursively.
 */
async function copyDirectory(src, dest) {
  await fs.cp(src, dest, { recursive: true })
}

/**
 * Main generation logic.
 */
async function main() {
  logger.log('')
  logger.log('Generating socket package from template...')
  logger.log('='.repeat(50))
  logger.log('')

  const templatePath = path.join(rootPath, 'templates/socket-package')
  const packagePath = path.join(rootPath, 'generated-packages/socket')

  // Copy entire template directory.
  await copyDirectory(templatePath, packagePath)

  logger.success('Generated socket package')
  logger.log('')
}

main().catch(e => {
  logger.error('Package generation failed:', e)
  process.exit(1)
})
