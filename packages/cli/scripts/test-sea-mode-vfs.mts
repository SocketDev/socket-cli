/**
 * SEA test mode: vfs — builds a SEA binary using binject's --vfs compression
 * to bundle external tools as a compressed virtual filesystem instead of raw
 * SEA assets.
 */

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildBlob } from './test-sea-shared.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logger = getDefaultLogger()

/**
 * Mode: vfs - Uses binject with --vfs compression.
 */
export async function runVfsMode(platform) {
  logger.log('Mode: vfs (binject with --vfs compression)')
  logger.log('='.repeat(60))
  logger.log('')

  const outputDir = path.join(__dirname, '../dist/sea-test')
  const vfsTarGz = path.join(outputDir, 'external-tools.tar.gz')
  const outputPath = path.join(outputDir, `socket-vfs-${platform}`)

  // Check that tar.gz exists.
  if (!existsSync(vfsTarGz)) {
    logger.fail(`VFS tar.gz not found: ${vfsTarGz}`)
    logger.fail(
      'Create it with: tar -czf packages/cli/dist/sea-test/external-tools.tar.gz -C build-infra/build/external-tools-test/darwin-arm64 trivy trufflehog opengrep',
    )
    throw new Error('VFS tar.gz not found')
  }

  const vfsStats = await fs.stat(vfsTarGz)
  logger.log(`VFS tar.gz: ${(vfsStats.size / 1024 / 1024).toFixed(2)} MB`)
  logger.log('')

  // Create minimal SEA config (no assets).
  const entryPoint = path.join(__dirname, 'test-entry.mts')
  const configPath = path.join(outputDir, 'sea-config-vfs.json')
  const blobPath = path.join(outputDir, 'sea-blob-vfs.blob')

  const config = {
    disableExperimentalSEAWarning: true,
    main: entryPoint,
    output: blobPath,
    useCodeCache: true,
    useSnapshot: false,
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
  logger.log('Generated minimal SEA config (no assets)')
  logger.log('')

  // Build SEA blob.
  await buildBlob(configPath)

  const blobStats = await fs.stat(blobPath)
  logger.log(`Blob size: ${(blobStats.size / 1024 / 1024).toFixed(2)} MB`)
  logger.log('')

  // Copy current node binary as base.
  logger.log('Copying Node.js binary as base…')
  await fs.copyFile(process.execPath, outputPath)
  await fs.chmod(outputPath, 0o755)

  const baseStats = await fs.stat(outputPath)
  logger.log(`Base binary: ${(baseStats.size / 1024 / 1024).toFixed(2)} MB`)
  logger.log('')

  // Inject blob + VFS using binject.
  logger.log('Injecting blob + VFS with binject…')
  const binjectPath = path.join(
    __dirname,
    `../../build-infra/build/downloaded/binject/${platform}/binject`,
  )

  if (!existsSync(binjectPath)) {
    logger.fail(`binject not found: ${binjectPath}`)
    logger.fail('Run build or download binject first')
    throw new Error('binject not found')
  }

  const injectResult = await spawn(
    binjectPath,
    [
      'inject',
      '--executable',
      outputPath,
      '--output',
      outputPath,
      '--sea',
      blobPath,
      '--vfs',
      vfsTarGz,
    ],
    { stdio: 'inherit' },
  )

  if (injectResult.code !== 0) {
    throw new Error('binject injection failed')
  }

  // Check signing (binject may auto-sign).
  if (process.platform === 'darwin') {
    const checkSign = await spawn('codesign', ['-d', outputPath])
    if (checkSign.code !== 0) {
      logger.log('')
      logger.log('Signing binary (macOS)...')
      const signResult = await spawn('codesign', ['-s', '-', outputPath], {
        stdio: 'inherit',
      })
      if (signResult.code !== 0) {
        throw new Error('Codesign failed')
      }
    } else {
      logger.log('')
      logger.log('Binary already signed by binject')
    }
  }

  // Results.
  const finalStats = await fs.stat(outputPath)
  const finalSizeMB = finalStats.size / 1024 / 1024
  const uncompressedToolsSize = 460.78
  const uncompressedTotal =
    uncompressedToolsSize +
    baseStats.size / 1024 / 1024 +
    blobStats.size / 1024 / 1024
  const savings = uncompressedTotal - finalSizeMB
  const compressionRatio = (
    (1 - finalSizeMB / uncompressedTotal) *
    100
  ).toFixed(1)

  logger.log('')
  logger.log('='.repeat(60))
  logger.log('RESULTS (binject --vfs compression)')
  logger.log('='.repeat(60))
  logger.log('')
  logger.log(`VFS tar.gz: ${(vfsStats.size / 1024 / 1024).toFixed(2)} MB`)
  logger.log(
    `Base Node binary: ${(baseStats.size / 1024 / 1024).toFixed(2)} MB`,
  )
  logger.log(`Blob: ${(blobStats.size / 1024 / 1024).toFixed(2)} MB`)
  logger.log(`Final SEA binary: ${finalSizeMB.toFixed(2)} MB`)
  logger.log(
    `Uncompressed size (Node SEA assets): ${uncompressedTotal.toFixed(2)} MB`,
  )
  logger.log(`Compressed size (binject --vfs): ${finalSizeMB.toFixed(2)} MB`)
  logger.log(`Compression: ${compressionRatio}% reduction`)
  logger.log(`Savings: ${savings.toFixed(2)} MB`)
  logger.log('')
  logger.log(`Output: ${outputPath}`)
  logger.log('')

  return outputPath
}
