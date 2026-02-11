/**
 * Unified SEA test script with multiple execution modes.
 * Consolidates test-sea-standalone, test-sea-vfs, and test-sea-with-tools.
 *
 * Usage:
 *   node scripts/test-sea.mjs --mode=standalone
 *   node scripts/test-sea.mjs --mode=vfs
 *   node scripts/test-sea.mjs --mode=with-tools
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Spawn a process and return result.
 */
function spawn(command, args, options = {}) {
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
 * Parse command line arguments.
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const mode =
    args
      .find(a => a.startsWith('--mode='))
      ?.split('=')[1]
      ?.toLowerCase() || 'with-tools'

  if (!['standalone', 'vfs', 'with-tools'].includes(mode)) {
    console.error('Invalid mode. Use: standalone, vfs, or with-tools')
    process.exit(1)
  }

  return { mode }
}

/**
 * Load tool paths from previous download.
 */
async function loadToolPaths() {
  const platform = `${process.platform}-${process.arch}`
  const toolPathsFile = path.join(
    __dirname,
    '../../../build-infra/build/security-tools-test',
    platform,
    'tool-paths.json',
  )

  if (!existsSync(toolPathsFile)) {
    console.error(`Tool paths not found: ${toolPathsFile}`)
    console.error('Run: node scripts/test-download-security-tools.mjs')
    process.exit(1)
  }

  const toolPathsData = JSON.parse(await fs.readFile(toolPathsFile, 'utf8'))
  return { platform, toolPaths: toolPathsData.tools }
}

/**
 * Display tool information.
 */
async function displayToolInfo(toolPaths) {
  console.log('Security tools to bundle:')
  let totalToolSize = 0
  for (const [toolName, toolPath] of Object.entries(toolPaths)) {
    if (existsSync(toolPath)) {
      const stats = await fs.stat(toolPath)
      const sizeMB = stats.size / 1024 / 1024
      totalToolSize += stats.size
      console.log(`  ${toolName}: ${sizeMB.toFixed(2)} MB`)
    }
  }
  console.log(`  Total: ${(totalToolSize / 1024 / 1024).toFixed(2)} MB`)
  console.log('')
  return totalToolSize
}

/**
 * Generate SEA configuration.
 */
async function generateSeaConfig(entryPoint, outputPath, toolPaths, mode) {
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
              `security-tools/${toolName}`,
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
 * Build SEA blob.
 */
async function buildBlob(configPath) {
  console.log('Generating SEA blob...')
  const result = await spawn(
    process.execPath,
    ['--experimental-sea-config', configPath],
    {
      stdio: 'inherit',
    },
  )

  if (result.exitCode !== 0) {
    throw new Error(`Failed to generate SEA blob: exit code ${result.exitCode}`)
  }
}

/**
 * Mode: standalone - Uses standard Node.js + postject.
 */
async function runStandaloneMode(platform, toolPaths) {
  console.log('Mode: standalone (Node.js + postject)')
  console.log('='.repeat(60))
  console.log('')

  const totalToolSize = await displayToolInfo(toolPaths)

  // Setup output.
  const entryPoint = path.join(__dirname, 'test-entry.mjs')
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
  console.log(`Blob size: ${blobSizeMB.toFixed(2)} MB`)
  console.log('')

  // Copy current node binary as base.
  console.log('Copying Node.js binary as base...')
  await fs.copyFile(process.execPath, outputPath)
  await fs.chmod(outputPath, 0o755)

  const baseStats = await fs.stat(outputPath)
  console.log(`Base binary: ${(baseStats.size / 1024 / 1024).toFixed(2)} MB`)
  console.log('')

  // Inject blob using postject.
  console.log('Injecting blob with postject...')
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

  if (injectResult.exitCode !== 0) {
    throw new Error('Postject injection failed')
  }

  // Sign binary (required on macOS).
  if (process.platform === 'darwin') {
    console.log('')
    console.log('Signing binary (macOS)...')
    const signResult = await spawn('codesign', ['-s', '-', outputPath], {
      stdio: 'inherit',
    })
    if (signResult.exitCode !== 0) {
      throw new Error('Codesign failed')
    }
  }

  // Results.
  const finalStats = await fs.stat(outputPath)
  const finalSizeMB = finalStats.size / 1024 / 1024
  const uncompressedTotal = (totalToolSize + baseStats.size) / 1024 / 1024
  const compression = ((1 - finalSizeMB / uncompressedTotal) * 100).toFixed(1)

  console.log('')
  console.log('='.repeat(60))
  console.log('RESULTS')
  console.log('='.repeat(60))
  console.log('')
  console.log(
    `Tools (uncompressed): ${(totalToolSize / 1024 / 1024).toFixed(2)} MB`,
  )
  console.log(
    `Base Node binary: ${(baseStats.size / 1024 / 1024).toFixed(2)} MB`,
  )
  console.log(`Blob: ${blobSizeMB.toFixed(2)} MB`)
  console.log(`Final SEA binary: ${finalSizeMB.toFixed(2)} MB`)
  console.log(`Compression: ${compression}% reduction`)
  console.log(`Savings: ${(uncompressedTotal - finalSizeMB).toFixed(2)} MB`)
  console.log('')
  console.log(`Output: ${outputPath}`)
  console.log('')

  return outputPath
}

/**
 * Mode: vfs - Uses binject with --vfs compression.
 */
async function runVfsMode(platform) {
  console.log('Mode: vfs (binject with --vfs compression)')
  console.log('='.repeat(60))
  console.log('')

  const outputDir = path.join(__dirname, '../dist/sea-test')
  const vfsTarGz = path.join(outputDir, 'security-tools.tar.gz')
  const outputPath = path.join(outputDir, `socket-vfs-${platform}`)

  // Check that tar.gz exists.
  if (!existsSync(vfsTarGz)) {
    console.error(`VFS tar.gz not found: ${vfsTarGz}`)
    console.error(
      'Create it with: tar -czf packages/cli/dist/sea-test/security-tools.tar.gz -C build-infra/build/security-tools-test/darwin-arm64 trivy trufflehog opengrep',
    )
    process.exit(1)
  }

  const vfsStats = await fs.stat(vfsTarGz)
  console.log(`VFS tar.gz: ${(vfsStats.size / 1024 / 1024).toFixed(2)} MB`)
  console.log('')

  // Create minimal SEA config (no assets).
  const entryPoint = path.join(__dirname, 'test-entry.mjs')
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
  console.log('Generated minimal SEA config (no assets)')
  console.log('')

  // Build SEA blob.
  await buildBlob(configPath)

  const blobStats = await fs.stat(blobPath)
  console.log(`Blob size: ${(blobStats.size / 1024 / 1024).toFixed(2)} MB`)
  console.log('')

  // Copy current node binary as base.
  console.log('Copying Node.js binary as base...')
  await fs.copyFile(process.execPath, outputPath)
  await fs.chmod(outputPath, 0o755)

  const baseStats = await fs.stat(outputPath)
  console.log(`Base binary: ${(baseStats.size / 1024 / 1024).toFixed(2)} MB`)
  console.log('')

  // Inject blob + VFS using binject.
  console.log('Injecting blob + VFS with binject...')
  const binjectPath = path.join(
    __dirname,
    `../../../build-infra/build/downloaded/binject/${platform}/binject`,
  )

  if (!existsSync(binjectPath)) {
    console.error(`binject not found: ${binjectPath}`)
    console.error('Run build or download binject first')
    process.exit(1)
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

  if (injectResult.exitCode !== 0) {
    throw new Error('binject injection failed')
  }

  // Check signing (binject may auto-sign).
  if (process.platform === 'darwin') {
    const checkSign = await spawn('codesign', ['-d', outputPath])
    if (checkSign.exitCode !== 0) {
      console.log('')
      console.log('Signing binary (macOS)...')
      const signResult = await spawn('codesign', ['-s', '-', outputPath], {
        stdio: 'inherit',
      })
      if (signResult.exitCode !== 0) {
        throw new Error('Codesign failed')
      }
    } else {
      console.log('')
      console.log('Binary already signed by binject')
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

  console.log('')
  console.log('='.repeat(60))
  console.log('RESULTS (binject --vfs compression)')
  console.log('='.repeat(60))
  console.log('')
  console.log(`VFS tar.gz: ${(vfsStats.size / 1024 / 1024).toFixed(2)} MB`)
  console.log(
    `Base Node binary: ${(baseStats.size / 1024 / 1024).toFixed(2)} MB`,
  )
  console.log(`Blob: ${(blobStats.size / 1024 / 1024).toFixed(2)} MB`)
  console.log(`Final SEA binary: ${finalSizeMB.toFixed(2)} MB`)
  console.log(
    `Uncompressed size (Node SEA assets): ${uncompressedTotal.toFixed(2)} MB`,
  )
  console.log(`Compressed size (binject --vfs): ${finalSizeMB.toFixed(2)} MB`)
  console.log(`Compression: ${compressionRatio}% reduction`)
  console.log(`Savings: ${savings.toFixed(2)} MB`)
  console.log('')
  console.log(`Output: ${outputPath}`)
  console.log('')

  return outputPath
}

/**
 * Mode: with-tools - Uses Socket infrastructure (downloadNodeBinary + injectSeaBlob).
 */
async function runWithToolsMode(platform, toolPaths) {
  console.log('Mode: with-tools (Socket infrastructure)')
  console.log('='.repeat(60))
  console.log('')

  // Dynamic import Socket modules.
  const { getDefaultLogger } = await import('@socketsecurity/lib/logger')
  const { buildSeaBlob, injectSeaBlob } = await import(
    './sea-build-utils/builder.mjs'
  )
  const { downloadNodeBinary } = await import(
    './sea-build-utils/downloads.mjs'
  )

  const logger = getDefaultLogger()
  const totalToolSize = await displayToolInfo(toolPaths)

  // Setup output.
  const entryPoint = path.join(__dirname, 'test-entry.mjs')
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
      assets[`security-tools/${toolName}`] = toolPath
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

  // Build SEA blob.
  logger.log('Generating SEA blob...')
  await buildSeaBlob(configPath)
  const blobStats = await fs.stat(blobPath)
  logger.log(`Blob size: ${(blobStats.size / 1024 / 1024).toFixed(2)} MB`)
  logger.log('')

  // Download node-smol binary.
  logger.log('Downloading node-smol binary...')
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

  // Inject blob into node binary.
  logger.log('Injecting blob into node binary...')
  const cacheId = platform
  await injectSeaBlob(nodeBinary, blobPath, outputPath, cacheId)

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
 * Test the generated binary.
 */
async function testBinary(outputPath) {
  console.log('Testing binary...')
  console.log('-'.repeat(60))
  const testResult = await spawn(outputPath, [], { stdio: 'inherit' })
  console.log('-'.repeat(60))

  if (testResult.exitCode === 0) {
    console.log('✅ Binary works!')
  } else {
    console.log('❌ Binary test failed')
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
  console.error(e)
  process.exit(1)
})
