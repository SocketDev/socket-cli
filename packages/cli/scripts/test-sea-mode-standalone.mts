/**
 * SEA test mode: standalone — builds a SEA binary using Node.js's built-in
 * --experimental-sea-config generation plus postject injection (no Socket
 * build infrastructure).
 */

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildBlob,
  displayToolInfo,
  generateSeaConfig,
} from './test-sea-shared.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logger = getDefaultLogger()

/**
 * Mode: standalone - Uses standard Node.js + postject.
 */
export async function runStandaloneMode(platform, toolPaths) {
  logger.log('Mode: standalone (Node.js + postject)')
  logger.log('='.repeat(60))
  logger.log('')

  const totalToolSize = await displayToolInfo(toolPaths)

  // Setup output.
  const entryPoint = path.join(__dirname, 'test-entry.mts')
  const outputDir = path.join(__dirname, '../dist/sea-test')
  await fs.mkdir(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `socket-standalone-${platform}`)

  // Generate SEA config.
  const { blobPath, configPath } = await generateSeaConfig(
    entryPoint,
    outputPath,
    toolPaths,
    'standalone',
  )

  // Build blob.
  await buildBlob(configPath)

  // Check blob size.
  const blobStats = await fs.stat(blobPath)
  const blobSizeMB = blobStats.size / 1024 / 1024
  logger.log(`Blob size: ${blobSizeMB.toFixed(2)} MB`)
  logger.log('')

  // Copy current node binary as base.
  logger.log('Copying Node.js binary as base…')
  await fs.copyFile(process.execPath, outputPath)
  await fs.chmod(outputPath, 0o755)

  const baseStats = await fs.stat(outputPath)
  logger.log(`Base binary: ${(baseStats.size / 1024 / 1024).toFixed(2)} MB`)
  logger.log('')

  // Inject blob using postject.
  logger.log('Injecting blob with postject…')
  const injectResult = await spawn(
    'npx',
    [
      'postject',
      outputPath,
      'NODE_SEA_BLOB',
      blobPath,
      '--sentinel-fuse',
      'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
      ...(process.platform === 'darwin'
        ? ['--macho-segment-name', 'NODE_SEA']
        : []),
    ],
    { stdio: 'inherit' },
  )

  if (injectResult.code !== 0) {
    throw new Error('Postject injection failed')
  }

  // Sign binary (required on macOS).
  if (process.platform === 'darwin') {
    logger.log('')
    logger.log('Signing binary (macOS)...')
    const signResult = await spawn('codesign', ['-s', '-', outputPath], {
      stdio: 'inherit',
    })
    if (signResult.code !== 0) {
      throw new Error('Codesign failed')
    }
  }

  // Results.
  const finalStats = await fs.stat(outputPath)
  const finalSizeMB = finalStats.size / 1024 / 1024
  const uncompressedTotal = (totalToolSize + baseStats.size) / 1024 / 1024
  const compression = ((1 - finalSizeMB / uncompressedTotal) * 100).toFixed(1)

  logger.log('')
  logger.log('='.repeat(60))
  logger.log('RESULTS')
  logger.log('='.repeat(60))
  logger.log('')
  logger.log(
    `Tools (uncompressed): ${(totalToolSize / 1024 / 1024).toFixed(2)} MB`,
  )
  logger.log(
    `Base Node binary: ${(baseStats.size / 1024 / 1024).toFixed(2)} MB`,
  )
  logger.log(`Blob: ${blobSizeMB.toFixed(2)} MB`)
  logger.log(`Final SEA binary: ${finalSizeMB.toFixed(2)} MB`)
  logger.log(`Compression: ${compression}% reduction`)
  logger.log(`Savings: ${(uncompressedTotal - finalSizeMB).toFixed(2)} MB`)
  logger.log('')
  logger.log(`Output: ${outputPath}`)
  logger.log('')

  return outputPath
}
