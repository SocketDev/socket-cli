/**
 * Download Yoga Layout WASM.
 *
 * WHAT THIS EXTRACTS:
 * - Yoga Layout WASM (~95KB) - extracted from yoga-layout package
 *
 * OUTPUT:
 * File saved to .cache/models/yoga.wasm
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '../..')
const cacheDir = path.join(rootPath, '.cache/models')


/**
 * Extract yoga WASM from base64-encoded file.
 */
async function extractYogaWasm(dest, description) {
  logger.info(`📦 Extracting ${description}...`)

  const yogaBase64File = path.join(
    rootPath,
    'node_modules/yoga-layout/dist/binaries/yoga-wasm-base64-esm.js',
  )

  if (!existsSync(yogaBase64File)) {
    throw new Error(`yoga-layout not installed: ${yogaBase64File}`)
  }

  const content = await fs.readFile(yogaBase64File, 'utf-8')

  // Extract base64 WASM data.
  // Pattern: H="data:application/octet-stream;base64,<BASE64DATA>"
  const match = content.match(
    /H="data:application\/octet-stream;base64,([^"]+)"/,
  )

  if (!match) {
    throw new Error(
      'Could not find WASM base64 data in yoga-layout binary file',
    )
  }

  const base64Data = match[1]
  const wasmBuffer = Buffer.from(base64Data, 'base64')

  await fs.writeFile(dest, wasmBuffer)

  const sizeKB = (wasmBuffer.length / 1024).toFixed(2)
  logger.substep(`✓ Extracted ${sizeKB} KB`)
  logger.substep(`✓ Saved to ${dest}\n`)

  return wasmBuffer.length
}

/**
 * Main extraction logic.
 */
export async function extractYoga() {
  logger.info('╔═══════════════════════════════════════════════════╗')
  logger.info('║   Extract Yoga Layout WASM                        ║')
  logger.info('╚═══════════════════════════════════════════════════╝\n')

  // Create cache directory.
  await fs.mkdir(cacheDir, { recursive: true })
  logger.info(`✓ Cache directory: ${cacheDir}\n`)

  const outputPath = path.join(cacheDir, 'yoga.wasm')

  // Check if file already exists.
  try {
    await fs.access(outputPath)
    const stats = await fs.stat(outputPath)
    const sizeKB = (stats.size / 1024).toFixed(2)
    logger.info(`✓ Yoga Layout WASM already exists (${sizeKB} KB)`)
    logger.substep(`${outputPath}\n`)
    return true
  } catch {
    // File doesn't exist - extract it.
  }

  // Extract yoga WASM.
  try {
    await extractYogaWasm(outputPath, 'Yoga Layout WASM')
  } catch (e) {
    logger.error(`✗ Failed to extract: ${e.message}`)
    logger.error('   Please ensure yoga-layout is installed: pnpm install\n')
    return false
  }

  logger.info('╔═══════════════════════════════════════════════════╗')
  logger.info('║   Extraction Summary                              ║')
  logger.info('╚═══════════════════════════════════════════════════╝\n')
  logger.info('✓ Yoga Layout WASM extracted successfully')
  return true
}

// Run if called directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const success = await extractYoga()
  process.exit(success ? 0 : 1)
}
