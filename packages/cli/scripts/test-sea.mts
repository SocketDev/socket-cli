/* max-file-lines: cohesive-module — tracks one cohesive module domain; splitting would scatter tightly coupled helpers. */
/**
 * Unified SEA test script with multiple execution modes. Consolidates
 * test-sea-standalone, test-sea-vfs, and test-sea-with-tools.
 *
 * Usage: node scripts/test-sea.mts --mode=standalone node scripts/test-sea.mts
 * --mode=vfs node scripts/test-sea.mts --mode=with-tools.
 */

// oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: fs.stat() reads .size, not existence; per-call would produce many redundant disables.
// oxlint-disable socket/prefer-exists-sync -- all fs.stat() calls here read .size for size reporting; not existence checks.

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Build SEA blob.
 */
async function buildBlob(configPath) {
  logger.log('Generating SEA blob…')
  const result = await spawn(
    process.execPath,
    ['--experimental-sea-config', configPath],
    {
      stdio: 'inherit',
    },
  )

  if (result.code !== 0) {
    throw new Error(`Failed to generate SEA blob: exit code ${result.code}`)
  }
}

/**
 * Display tool information.
 */
async function displayToolInfo(toolPaths) {
  logger.log('External tools to bundle:')
  let totalToolSize = 0
  for (const [toolName, toolPath] of Object.entries(toolPaths)) {
    if (existsSync(toolPath)) {
      const stats = await fs.stat(toolPath)
      const sizeMB = stats.size / 1024 / 1024
      totalToolSize += stats.size
      logger.log(`  ${toolName}: ${sizeMB.toFixed(2)} MB`)
    }
  }
  logger.log(`  Total: ${(totalToolSize / 1024 / 1024).toFixed(2)} MB`)
  logger.log('')
  return totalToolSize
}

/**
 * Generate SEA configuration.
 */
export async function generateSeaConfig(
  entryPoint,
  outputPath,
  toolPaths,
  mode,
) {
  const outputName = path.basename(outputPath, path.extname(outputPath))
  const configPath = path.join(
    path.dirname(outputPath),
    `sea-config-${mode}-${outputName}.json`,
  )
  const blobPath = path.join(
    path.dirname(outputPath),
    `sea-blob-${mode}-${outputName}.blob`,
  )

  // For VFS mode, no assets in config (they come via external tar.gz).
  // For other modes, include assets in config.
  const assets =
    mode === 'vfs'
      ? undefined
      : Object.fromEntries(
          Object.entries(toolPaths)
            .filter(([, toolPath]) => existsSync(toolPath))
            .map(([toolName, toolPath]) => [
              `external-tools/${toolName}`,
              toolPath,
            ]),
        )

  const config = {
    ...(assets ? { assets } : {}),
    disableExperimentalSEAWarning: true,
    main: entryPoint,
    output: blobPath,
    useCodeCache: true,
    useSnapshot: false,
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
  return { blobPath, configPath }
}

/**
 * Load tool paths from previous download.
 */
async function loadToolPaths() {
  const platform = `${process.platform}-${process.arch}`
  const toolPathsFile = path.join(
    __dirname,
    '../../build-infra/build/external-tools-test',
    platform,
    'tool-paths.json',
  )

  if (!existsSync(toolPathsFile)) {
    logger.fail(`Tool paths not found: ${toolPathsFile}`)
    logger.fail('Run: node scripts/test-download-external-tools.mts')
    throw new Error('Tool paths not found')
  }

  let toolPathsData
  try {
    toolPathsData = JSON.parse(await fs.readFile(toolPathsFile, 'utf8'))
  } catch (e) {
    logger.fail(
      `Failed to parse tool paths from ${toolPathsFile}: ${e.message}`,
    )
    logger.fail('Run: node scripts/test-download-external-tools.mts')
    throw new Error('Invalid tool paths JSON')
  }
  return { platform, toolPaths: toolPathsData.tools }
}

/**
 * Parse command line arguments.
 */
export function parseArgs() {
  const args = process.argv.slice(2)
  const mode =
    args
      .find(a => a.startsWith('--mode='))
      ?.split('=')[1]
      ?.toLowerCase() || 'with-tools'

  if (!['standalone', 'vfs', 'with-tools'].includes(mode)) {
    logger.fail('Invalid mode. Use: standalone, vfs, or with-tools')
    throw new Error('Invalid mode')
  }

  return { mode }
}

/**
 * Mode: standalone - Uses standard Node.js + postject.
 */
async function runStandaloneMode(platform, toolPaths) {
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

/**
 * Mode: vfs - Uses binject with --vfs compression.
 */
async function runVfsMode(platform) {
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

/**
 * Mode: with-tools - Uses Socket infrastructure (downloadNodeBinary +
 * injectSeaBlob).
 */
async function runWithToolsMode(platform, toolPaths) {
  logger.log('Mode: with-tools (Socket infrastructure)')
  logger.log('='.repeat(60))
  logger.log('')

  // Dynamic import Socket modules.
  const { getDefaultLogger } = await import('@socketsecurity/lib-stable/logger')
  const { injectSeaBlob } = await import('./sea-build-util/builder.mts')
  const { downloadNodeBinary } = await import('./sea-build-util/downloads.mts')

  const logger = getDefaultLogger()
  const totalToolSize = await displayToolInfo(toolPaths)

  // Setup output.
  const entryPoint = path.join(__dirname, 'test-entry.mts')
  const outputDir = path.join(__dirname, '../dist/sea-test')
  await fs.mkdir(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `socket-with-tools-${platform}`)

  // Generate SEA config.
  const outputName = path.basename(outputPath, path.extname(outputPath))
  const configPath = path.join(
    path.dirname(outputPath),
    `sea-config-test-${outputName}.json`,
  )
  const blobPath = path.join(
    path.dirname(outputPath),
    `sea-blob-test-${outputName}.blob`,
  )

  // Build assets object with security tools.
  const assets = { __proto__: null }
  for (const [toolName, toolPath] of Object.entries(toolPaths)) {
    if (existsSync(toolPath)) {
      assets[`external-tools/${toolName}`] = toolPath
      const stats = await fs.stat(toolPath)
      logger.log(
        `  Including ${toolName}: ${(stats.size / 1024 / 1024).toFixed(2)} MB`,
      )
    }
  }

  const config = {
    assets,
    disableExperimentalSEAWarning: true,
    main: entryPoint,
    output: blobPath,
    useCodeCache: true,
    useSnapshot: false,
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
  logger.log(`Wrote SEA config: ${configPath}`)
  logger.log('')

  // Download node-smol binary.
  logger.log('Downloading node-smol binary…')
  const nodeVersion = '20251213-7cf90d2'
  const nodeBinary = await downloadNodeBinary(
    nodeVersion,
    process.platform,
    process.arch,
  )
  const nodeStats = await fs.stat(nodeBinary)
  logger.log(
    `Node binary size: ${(nodeStats.size / 1024 / 1024).toFixed(2)} MB`,
  )
  logger.log('')

  // Inject blob and VFS into binary.
  // binject will generate the blob automatically using the target binary's
  // Node.js version when --sea points to a config file.
  logger.log('Generating SEA blob and injecting into binary…')
  const cacheId = platform
  await injectSeaBlob(nodeBinary, configPath, outputPath, cacheId)

  // Get blob size after it's generated by binject.
  if (existsSync(blobPath)) {
    const blobStats = await fs.stat(blobPath)
    logger.log(`Blob size: ${(blobStats.size / 1024 / 1024).toFixed(2)} MB`)
  }

  // Results.
  const finalStats = await fs.stat(outputPath)
  const finalSizeMB = finalStats.size / 1024 / 1024
  const compressionRatio = (
    (1 - finalSizeMB / ((totalToolSize + nodeStats.size) / 1024 / 1024)) *
    100
  ).toFixed(1)

  logger.log('')
  logger.log('='.repeat(60))
  logger.log('RESULTS')
  logger.log('='.repeat(60))
  logger.log('')
  logger.log(
    `Tools (uncompressed): ${(totalToolSize / 1024 / 1024).toFixed(2)} MB`,
  )
  logger.log(`Node binary: ${(nodeStats.size / 1024 / 1024).toFixed(2)} MB`)
  logger.log(`Blob: ${(blobStats.size / 1024 / 1024).toFixed(2)} MB`)
  logger.log(`Final SEA binary: ${finalSizeMB.toFixed(2)} MB`)
  logger.log('')
  logger.log(`Output: ${outputPath}`)
  logger.log('')
  logger.log(
    `Compression: ${compressionRatio}% reduction from uncompressed size`,
  )
  logger.log('')

  return outputPath
}

/**
 * Spawn a process and return result.
 */
export function spawn(command, args, options = {}) {
  return new Promise(resolve => {
    const child = nodeSpawn(command, args, options)

    let stdout = ''
    let stderr = ''

    if (child.stdout) {
      child.stdout.on('data', data => {
        stdout += data
      })
    }
    if (child.stderr) {
      child.stderr.on('data', data => {
        stderr += data
      })
    }

    child.on('close', exitCode => {
      resolve({ exitCode, stderr, stdout })
    })
  })
}

/**
 * Test the generated binary.
 */
async function testBinary(outputPath) {
  logger.log('Testing binary…')
  logger.log('-'.repeat(60))
  const testResult = await spawn(outputPath, [], { stdio: 'inherit' })
  logger.log('-'.repeat(60))

  if (testResult.code === 0) {
    logger.success('Binary works!')
  } else {
    logger.fail('Binary test failed')
    process.exitCode = 1
  }
}

/**
 * Main function.
 */
async function main() {
  const { mode } = parseArgs()

  let outputPath

  if (mode === 'vfs') {
    // VFS mode doesn't need tool paths (uses external tar.gz).
    const { platform } = await loadToolPaths()
    outputPath = await runVfsMode(platform)
  } else {
    // Other modes need tool paths.
    const { platform, toolPaths } = await loadToolPaths()

    if (mode === 'standalone') {
      outputPath = await runStandaloneMode(platform, toolPaths)
    } else if (mode === 'with-tools') {
      outputPath = await runWithToolsMode(platform, toolPaths)
    }
  }

  await testBinary(outputPath)
}

main().catch(e => {
  logger.fail(e)
  process.exitCode = 1
})
