/**
 * @fileoverview Binary post-processing utilities (strip, SEA injection, signing, compression)
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { signBinary } from './code-signing.mjs'
import { exec, logger, moveWithRetry } from './core.mjs'

/**
 * Get file size in MB
 */
async function getSize(filePath) {
  const stats = await fs.stat(filePath)
  return `${(stats.size / (1024 * 1024)).toFixed(1)}MB`
}

/**
 * Post-process the binary (strip, SEA injection, sign, compress)
 */
export async function postProcessBinary(binaryPath, buildConfig) {
  const platform = process.platform
  const arch = process.arch

  logger.log('\n📏 Binary optimization...')
  const originalSize = await getSize(binaryPath)
  logger.log(`   Original size: ${originalSize}`)

  // Strip debug symbols (Unix-like systems only)
  if (platform !== 'win32') {
    try {
      logger.log('🔪 Stripping debug symbols...')
      const strippedPath = `${binaryPath}-stripped`

      if (platform === 'darwin') {
        await exec('strip', ['-x', binaryPath, '-o', strippedPath])
      } else {
        await exec('strip', [binaryPath, '-o', strippedPath])
      }

      await moveWithRetry(strippedPath, binaryPath)
      const strippedSize = await getSize(binaryPath)
      logger.log(`   After stripping: ${strippedSize}`)
    } catch {
      logger.warn('  strip command not available, skipping debug symbol removal')
    }
  }

  // Inject empty SEA blob (makes isSea() return true)
  await injectSeaBlob(binaryPath, buildConfig, platform)

  // Sign binary (must be done AFTER postject injection for macOS)
  logger.log('\n🔏 Signing binary...')
  const signResult = await signBinary(binaryPath, { force: true })
  if (signResult.success) {
    logger.success(` Binary signed successfully${signResult.tool ? ` with ${signResult.tool}` : ''}`)
  } else if (signResult.message) {
    if (platform === 'darwin' && arch === 'arm64') {
      // Critical failure for macOS ARM64
      logger.error(` ${signResult.message}`)
      throw new Error('Failed to sign macOS ARM64 binary - it will not run!')
    } else {
      logger.warn(` ${signResult.message}`)
    }
  }

  // UPX compression for non-macOS (optional)
  if (platform !== 'darwin') {
    try {
      logger.log('\n📦 Attempting compression with UPX...')
      await exec('upx', ['--best', '--lzma', binaryPath])
      const compressedSize = await getSize(binaryPath)
      logger.log(`   After UPX: ${compressedSize}`)
    } catch {
      logger.warn('  UPX not available, skipping compression')
    }
  }
}

/**
 * Inject empty SEA blob into Node.js binary
 */
async function injectSeaBlob(binaryPath, buildConfig, platform) {
  logger.log('\nInjecting empty SEA blob...')

  try {
    // Read SEA configuration from build-config.json5
    const seaMainContent = buildConfig?.sea?.main || '// Empty SEA main - actual code injected via other mechanism\n'
    const seaConfigFromFile = { ...(buildConfig?.sea || {}) }

    // Create empty main script
    const emptyMain = path.join(path.dirname(binaryPath), 'empty-sea-main.js')
    await fs.writeFile(emptyMain, seaMainContent)

    // Create SEA config, merging build config with required paths
    const seaConfig = path.join(path.dirname(binaryPath), 'sea-config.json')
    const seaBlob = path.join(path.dirname(binaryPath), 'sea.blob')

    // Remove 'main' from config since it contains the content, not the path
    delete seaConfigFromFile.main

    const seaConfigObj = {
      ...seaConfigFromFile,
      main: emptyMain,
      output: seaBlob
    }

    await fs.writeFile(seaConfig, JSON.stringify(seaConfigObj, null, 2))

    // Generate SEA blob
    logger.log('   Generating SEA blob...')
    await exec('node', ['--experimental-sea-config', seaConfig])

    // Inject blob with postject
    logger.log('   Injecting blob with postject...')
    const postjectArgs = [
      binaryPath,
      'NODE_SEA_BLOB',
      seaBlob,
      '--sentinel-fuse',
      'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
    ]

    // Add macOS-specific segment name if on macOS
    if (platform === 'darwin') {
      postjectArgs.push('--macho-segment-name', 'NODE_SEA')
    }

    await exec('npx', ['--yes', 'postject', ...postjectArgs])

    const blobSize = await getSize(binaryPath)
    logger.log(`   After SEA injection: ${blobSize}`)
    logger.success(' Empty SEA blob injected (isSea() will return true)')
  } catch (error) {
    logger.error(`   Failed to inject SEA blob: ${error.message}`)
    throw error
  }
}

/**
 * Copy binary to pkg cache
 */
export async function copyToPkgCache(binaryPath, nodeVersion) {
  const homeDir = os.homedir()
  const pkgCacheDir = path.join(homeDir, '.pkg-cache', '6.0.0')

  if (!existsSync(pkgCacheDir)) {
    await fs.mkdir(pkgCacheDir, { recursive: true })
  }

  const platform = process.platform === 'darwin' ? 'macos' : process.platform
  const arch = process.arch
  const cacheName = `built-${nodeVersion}-${platform}-${arch}`
  const cachePath = path.join(pkgCacheDir, cacheName)

  logger.log('\n📦 Copying to pkg cache...')
  logger.log(`   Cache path: ${cachePath}`)

  await fs.copyFile(binaryPath, cachePath)
  logger.success(' Binary copied to pkg cache')

  return cachePath
}
