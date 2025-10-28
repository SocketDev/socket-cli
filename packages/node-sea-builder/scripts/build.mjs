/**
 * Build script for creating self-executable Socket CLI applications.
 * Uses Node.js Single Executable Application (SEA) feature.
 *
 * IMPORTANT: This builds a FULL SEA with the complete CLI embedded.
 * The binary contains:
 * - Node.js runtime (~50MB)
 * - Full Socket CLI from packages/cli/dist/cli.js (~11MB)
 * - All dependencies and node_modules
 *
 * Expected binary size: ~110MB+ per platform.
 *
 * Prerequisites:
 * - Run `pnpm run build:cli` first to create packages/cli/dist/cli.js
 *
 * Supported platforms:
 * - Windows (x64, arm64)
 * - macOS (x64, arm64)
 * - Linux (x64, arm64)
 *
 * Usage:
 * - Build current platform: pnpm run build
 * - Build all platforms: pnpm run build:all
 * - Build specific platform: node scripts/build.mjs --platform=darwin --arch=x64
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete } from '@socketsecurity/lib/fs'
import { logger } from '@socketsecurity/lib/logger'
import { normalizePath } from '@socketsecurity/lib/path'
import { spawn } from '@socketsecurity/lib/spawn'
import colors from 'yoctocolors-cjs'

import {
  generateHashComment,
  shouldExtract,
} from '@socketsecurity/build-infra/lib/extraction-cache'

import constants from './constants.mjs'

// Inline NODE_SEA_FUSE constant (not exported from constants.mjs).
const NODE_SEA_FUSE = 'NODE_SEA_FUSE'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

// Supported Node.js versions for SEA.
// Node v24+ has better SEA support and smaller binary sizes.
// const SUPPORTED_NODE_VERSIONS = ['20.11.0', '22.0.0', '24.8.0']

/**
 * Fetch the latest stable Node.js version for v24+.
 */
async function getLatestNode24Version() {
  try {
    const response = await fetch('https://nodejs.org/dist/index.json')
    if (!response.ok) {
      throw new Error(
        `Failed to fetch Node.js releases: ${response.statusText}`,
      )
    }

    const releases = await response.json()

    // Find the latest v24+ version.
    const latestV24 = releases
      .filter(release => release.version.startsWith('v24.'))
      .sort((a, b) =>
        b.version.localeCompare(a.version, undefined, { numeric: true }),
      )[0]

    if (latestV24) {
      return latestV24.version.slice(1) // Remove 'v' prefix.
    }

    // Fallback to hardcoded version if no v24 found.
    return '24.8.0'
  } catch (error) {
    logger.log(
      `Warning: Failed to fetch latest Node.js version, using fallback: ${error instanceof Error ? error.message : String(error)}`,
    )
    return '24.8.0'
  }
}

/**
 * Get the default Node.js version for SEA builds.
 */
async function getDefaultNodeVersion() {
  return (
    constants.ENV.SOCKET_CLI_SEA_NODE_VERSION ||
    (await getLatestNode24Version())
  )
}

/**
 * Generate build targets for different platforms.
 */
async function getBuildTargets() {
  const defaultNodeVersion = await getDefaultNodeVersion()

  return [
    {
      platform: 'win32',
      arch: 'x64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-win-x64.exe',
    },
    {
      platform: 'win32',
      arch: 'arm64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-win-arm64.exe',
    },
    {
      platform: 'darwin',
      arch: 'x64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-macos-x64',
    },
    {
      platform: 'darwin',
      arch: 'arm64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-macos-arm64',
    },
    {
      platform: 'linux',
      arch: 'x64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-linux-x64',
    },
    {
      platform: 'linux',
      arch: 'arm64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-linux-arm64',
    },
  ]
}

/**
 * Download Node.js binary for a specific platform.
 */
async function downloadNodeBinary(version, platform, arch) {
  const isPlatWin = platform === 'win32'
  const nodeDir = normalizePath(
    path.join(os.homedir(), '.socket', 'node-binaries'),
  )
  const platformArch = `${platform}-${arch}`
  const nodeFilename = platform === 'win32' ? 'node.exe' : 'node'
  const nodePath = normalizePath(
    path.join(nodeDir, `v${version}`, platformArch, nodeFilename),
  )

  // Check if already downloaded.
  if (existsSync(nodePath)) {
    logger.log(`Using cached Node.js ${version} for ${platformArch}`)
    return nodePath
  }

  // Construct download URL.
  const baseUrl =
    constants.ENV.SOCKET_NODE_DOWNLOAD_URL ||
    'https://nodejs.org/download/release'
  const archMap = {
    x64: 'x64',
    arm64: 'arm64',
    ia32: 'x86',
  }
  const platformMap = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'win',
  }

  const nodePlatform = platformMap[platform]
  const nodeArch = archMap[arch]
  const tarName = `node-v${version}-${nodePlatform}-${nodeArch}`
  const extension = isPlatWin ? '.zip' : '.tar.gz'
  const downloadUrl = `${baseUrl}/v${version}/${tarName}${extension}`

  logger.log(`Downloading Node.js ${version} for ${platformArch}...`)
  logger.log(`URL: ${downloadUrl}`)

  // Download the archive.
  const response = await fetch(downloadUrl)
  if (!response.ok) {
    throw new Error(`Failed to download Node.js: ${response.statusText}`)
  }

  // Create temp directory.
  const tempDir = normalizePath(
    path.join(
      nodeDir,
      'tmp',
      crypto.createHash('sha256').update(downloadUrl).digest('hex'),
    ),
  )
  await fs.mkdir(tempDir, { recursive: true })

  try {
    // Save archive.
    const archivePath = normalizePath(path.join(tempDir, `node${extension}`))
    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(archivePath, buffer)

    // Extract archive.
    if (isPlatWin) {
      // For Windows binaries, use unzip if available, otherwise skip.
      // Note: We're building cross-platform, so we may be on macOS/Linux building for Windows.
      if (WIN32) {
        // On Windows, use PowerShell.
        await spawn(
          'powershell',
          [
            '-Command',
            `Expand-Archive -Path '${archivePath}' -DestinationPath '${tempDir}'`,
          ],
          { stdio: 'ignore' },
        )
      } else {
        // On Unix building for Windows, check for unzip availability.
        try {
          await spawn('which', ['unzip'], { stdio: 'ignore' })
        } catch {
          throw new Error(
            'unzip is required to extract Windows Node.js binaries on Unix systems.\n' +
              'Please install unzip: apt-get install unzip (Debian/Ubuntu) or brew install unzip (macOS)',
          )
        }
        await spawn('unzip', ['-q', archivePath, '-d', tempDir], {
          stdio: 'ignore',
        })
      }
    } else {
      // Check for tar availability on Unix systems.
      try {
        await spawn('which', ['tar'], { stdio: 'ignore' })
      } catch {
        throw new Error(
          'tar is required to extract Node.js archives.\n' +
            'Please install tar for your system.',
        )
      }
      await spawn('tar', ['-xzf', archivePath, '-C', tempDir], {
        stdio: 'ignore',
      })
    }

    // Find and move the Node binary.
    const extractedDir = normalizePath(path.join(tempDir, tarName))
    const extractedBinary = normalizePath(
      path.join(extractedDir, platform === 'win32' ? 'node.exe' : 'bin/node'),
    )

    // Ensure target directory exists.
    const targetDir = path.dirname(nodePath)
    await fs.mkdir(targetDir, { recursive: true })

    // Move binary to final location.
    await fs.copyFile(extractedBinary, nodePath)

    // Make executable on Unix.
    if (!isPlatWin) {
      await fs.chmod(nodePath, 0o755)
    }

    logger.log(`Downloaded Node.js ${version} for ${platformArch}`)
    return nodePath
  } finally {
    // Clean up the temp directory safely.
    await safeDelete(tempDir)
  }
}

/**
 * Generate SEA configuration.
 */
async function generateSeaConfig(entryPoint, outputPath) {
  const configPath = normalizePath(
    path.join(path.dirname(outputPath), 'sea-config.json'),
  )
  const blobPath = normalizePath(
    path.join(path.dirname(outputPath), 'sea-blob.blob'),
  )

  const config = {
    main: entryPoint,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false, // Disable for compatibility.
    useCodeCache: true, // Enable code cache for optimization.
    assets: {}, // No assets to minimize size.
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
  return configPath
}

/**
 * Build SEA blob.
 */
async function buildSeaBlob(nodeBinary, configPath) {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'))
  const blobPath = config.output

  logger.log('Generating SEA blob...')

  // Generate the blob using the CURRENT platform's Node binary.
  // The blob is platform-independent, so we can generate it with any Node version.
  // We'll inject it into the target platform's binary later.
  const spawnPromise = spawn(
    process.execPath,
    ['--experimental-sea-config', configPath],
    { stdio: 'inherit' },
  )

  const result = await spawnPromise
  if (
    result &&
    typeof result === 'object' &&
    'exitCode' in result &&
    result.code !== 0
  ) {
    throw new Error(`Failed to generate SEA blob: exit code ${result.code}`)
  }

  return blobPath
}

/**
 * Finds the postject executable path.
 *
 * @returns {string} Path to postject executable.
 * @throws {Error} If postject cannot be found.
 */
function findPostject() {
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
  const isWindows = process.platform === 'win32'
  const extension = isWindows ? '.cmd' : ''

  const potentialPaths = [
    // Package-local node_modules.
    path.resolve(__dirname, `../node_modules/.bin/postject${extension}`),
    // Root node_modules.
    path.resolve(__dirname, `../../../node_modules/.bin/postject${extension}`),
  ]

  for (const p of potentialPaths) {
    if (existsSync(p)) {
      return p
    }
  }

  throw new Error(
    'postject executable not found in node_modules/.bin/\n' +
      'Please ensure postject is installed: pnpm install',
  )
}

/**
 * Inject SEA blob into Node binary.
 */
async function injectSeaBlob(nodeBinary, blobPath, outputPath, fuseSentinel) {
  logger.log('Creating self-executable...')

  // Find postject executable.
  const postjectPath = findPostject()
  logger.log(`Using postject at: ${postjectPath}`)

  // Copy the Node binary.
  await fs.copyFile(nodeBinary, outputPath)

  if (process.platform === 'darwin') {
    // Check for codesign availability on macOS.
    let codesignAvailable = false
    try {
      await spawn('which', ['codesign'], { stdio: 'ignore' })
      codesignAvailable = true
    } catch {
      // codesign not available.
    }
    if (!codesignAvailable) {
      logger.warn(
        'Warning: codesign not found. The binary may not work correctly on macOS.\n' +
          'Install Xcode Command Line Tools: xcode-select --install',
      )
    } else {
      // On macOS, remove signature before injection.
      logger.log('Removing signature...')
      await spawn('codesign', ['--remove-signature', outputPath], {
        stdio: 'inherit',
      })
    }

    // Inject with macOS-specific flags.
    // Following Node.js SEA documentation: https://nodejs.org/api/single-executable-applications.html
    // Step 6: Inject the blob into the copied binary using postject with these options:
    // - outputPath: The name of the copy of the node executable created earlier
    // - NODE_SEA_BLOB: The name of the resource/section where blob contents are stored
    // - blobPath: The name of the blob created by --experimental-sea-config
    // - --sentinel-fuse: Fuse used by Node.js to detect if a file has been injected
    // - --macho-segment-name NODE_SEA: (macOS only) Name of the segment where blob contents are stored
    logger.log('Injecting SEA blob...')
    await spawn(
      postjectPath,
      [
        outputPath,
        'NODE_SEA_BLOB',
        blobPath,
        '--sentinel-fuse',
        fuseSentinel,
        '--macho-segment-name',
        'NODE_SEA',
      ],
      { stdio: 'inherit' },
    )

    // Re-sign the binary if codesign is available.
    if (codesignAvailable) {
      logger.log('Re-signing binary...')
      await spawn('codesign', ['--sign', '-', outputPath], {
        stdio: 'inherit',
      })
    }
  } else if (process.platform === 'win32') {
    // Windows injection.
    // Following Node.js SEA documentation: https://nodejs.org/api/single-executable-applications.html
    // Step 6: Inject the blob into the copied binary using postject with these options:
    // - outputPath: The name of the copy of the node executable created earlier
    // - NODE_SEA_BLOB: The name of the resource where blob contents are stored
    // - blobPath: The name of the blob created by --experimental-sea-config
    // - --sentinel-fuse: Fuse used by Node.js to detect if a file has been injected
    await spawn(
      postjectPath,
      [
        outputPath,
        'NODE_SEA_BLOB',
        blobPath,
        '--sentinel-fuse',
        fuseSentinel,
      ],
      { stdio: 'inherit' },
    )
    logger.log('Note: Windows binary may need signing for distribution')
  } else {
    // Linux injection.
    // Following Node.js SEA documentation: https://nodejs.org/api/single-executable-applications.html
    // Step 6: Inject the blob into the copied binary using postject with these options:
    // - outputPath: The name of the copy of the node executable created earlier
    // - NODE_SEA_BLOB: The name of the section where blob contents are stored
    // - blobPath: The name of the blob created by --experimental-sea-config
    // - --sentinel-fuse: Fuse used by Node.js to detect if a file has been injected
    await spawn(
      postjectPath,
      [
        outputPath,
        'NODE_SEA_BLOB',
        blobPath,
        '--sentinel-fuse',
        fuseSentinel,
      ],
      { stdio: 'inherit' },
    )
  }
}

/**
 * Build a single target.
 */
async function buildTarget(target, options) {
  const { outputDir = normalizePath(path.join(__dirname, '../dist/sea')) } =
    options

  // Use Node.js's standard SEA fuse sentinel.
  const fuseSentinel = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

  logger.log(
    `\nBuilding full SEA for ${target.platform}-${target.arch}...`,
  )
  logger.log('(Embedding full CLI from packages/cli/dist/cli.js)')

  // Use the already-built CLI from packages/cli/dist/cli.js.
  const cliPath = normalizePath(
    path.join(__dirname, '../../..', 'packages', 'cli', 'dist', 'cli.js'),
  )

  // Verify CLI exists.
  if (!existsSync(cliPath)) {
    throw new Error(
      `CLI not found at ${cliPath}. Run 'pnpm run build:cli' first.`,
    )
  }

  logger.log(`Using CLI from: ${cliPath}`)

  // Ensure output directory exists.
  await fs.mkdir(outputDir, { recursive: true })

  // Generate output path.
  const outputPath = normalizePath(path.join(outputDir, target.outputName))

  // Check if we can use cached SEA build.
  // Hash the CLI bundle and build script since those are the inputs.
  const sourcePaths = [cliPath, url.fileURLToPath(import.meta.url)]

  // Store hash in centralized build/.cache/ directory.
  const cacheDir = normalizePath(path.join(__dirname, '../build/.cache'))
  await fs.mkdir(cacheDir, { recursive: true })
  const hashFilePath = normalizePath(path.join(cacheDir, `${target.outputName}.hash`))

  const needsExtraction = await shouldExtract({
    sourcePaths,
    outputPath: hashFilePath,
    validateOutput: () => {
      // Verify both SEA binary and hash file exist.
      return existsSync(outputPath) && existsSync(hashFilePath)
    },
  })

  if (!needsExtraction) {
    // Cache hit! SEA binary is up to date.
    logger.log('')
    logger.log(`${colors.green('✓')} Using cached SEA binary`)
    logger.log('CLI bundle unchanged since last build.')
    logger.log('')
    logger.log(`Binary: ${outputPath}`)
    logger.log('')
    return
  }

  // Create a modified copy of the CLI with SEA compatibility fixes.
  const modifiedCliPath = normalizePath(path.join(outputDir, 'cli-modified.js'))
  let cliContent = await fs.readFile(cliPath, 'utf8')

  // Fix 1: Replace the sentinel constant with a split string that won't match the sentinel search.
  cliContent = cliContent.replace(
    /"NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"/g,
    '"NODE_SEA" + "_FUSE_fce680ab2cc467b6e072b8b5df1996b2"',
  )

  // Fix 2: Add defensive checks for require.resolve in SEA context.
  // Replace: if (require.resolve.paths)
  // With: if (require.resolve && require.resolve.paths)
  cliContent = cliContent.replace(
    /if\s*\(\s*require\.resolve\.paths\s*\)/g,
    'if (require.resolve && require.resolve.paths)',
  )

  // Fix 3: Add SEA compatibility polyfill after shebang.
  const seaPolyfill = `
// SEA Compatibility Polyfill
if (typeof require !== 'undefined' && (!require.resolve || !require.resolve.paths)) {
  if (!require.resolve) {
    require.resolve = function(id, options) {
      // Basic resolve that returns the id for SEA context.
      return id;
    };
  }
  if (!require.resolve.paths) {
    require.resolve.paths = function(request) {
      // Return empty array for SEA context where path resolution isn't available.
      return [];
    };
  }
}
`

  // Insert polyfill after shebang (if present) or at the beginning.
  let modifiedContent
  if (cliContent.startsWith('#!')) {
    const firstNewline = cliContent.indexOf('\n')
    const shebang = cliContent.substring(0, firstNewline + 1)
    const rest = cliContent.substring(firstNewline + 1)
    modifiedContent = shebang + seaPolyfill + rest
  } else {
    modifiedContent = seaPolyfill + cliContent
  }

  await fs.writeFile(modifiedCliPath, modifiedContent)

  // Verify transformations were applied correctly.
  logger.log('Verifying SEA compatibility transformations...')
  const verifyScript = normalizePath(path.join(__dirname, 'verify-sea-transforms.mjs'))
  try {
    await spawn('node', [verifyScript], { stdio: 'pipe' })
    logger.log(`${colors.green('✓')} All transformations verified`)
  } catch (error) {
    logger.error(`${colors.yellow('⚠')} Transformation verification failed`)
    logger.error('  The build will continue, but runtime issues may occur')
    // Don't fail the build - polyfill provides runtime safety net.
  }

  // Use the modified CLI as the entry point.
  const entryPoint = modifiedCliPath

  // Download Node.js binary for target platform.
  const nodeBinary = await downloadNodeBinary(
    target.nodeVersion,
    target.platform,
    target.arch,
  )

  // Generate SEA configuration.
  const configPath = await generateSeaConfig(entryPoint, outputPath)

  try {
    // Build SEA blob using the downloaded Node binary.
    const blobPath = await buildSeaBlob(nodeBinary, configPath)

    // Inject blob into Node binary.
    await injectSeaBlob(nodeBinary, blobPath, outputPath, fuseSentinel)

    // Make executable on Unix.
    if (target.platform !== 'win32') {
      await fs.chmod(outputPath, 0o755)
    }

    logger.log(`${colors.green('✓')} Built ${target.outputName}`)

    // Write source hash to cache file for future builds.
    const sourceHashComment = await generateHashComment(sourcePaths)
    await fs.writeFile(hashFilePath, sourceHashComment, 'utf-8')

    // Clean up temporary files using trash.
    const filesToClean = [
      blobPath,
      entryPoint.endsWith('.compiled.mjs') ? entryPoint : null,
      entryPoint.endsWith('.mjs') && !entryPoint.endsWith('.compiled.mjs')
        ? entryPoint
        : null,
    ].filter(Boolean)

    if (filesToClean.length > 0) {
      await safeDelete(filesToClean).catch(() => {})
    }
  } finally {
    // Clean up config.
    await safeDelete(configPath).catch(() => {})
  }
}

/**
 * Main build function.
 */
async function main() {
  // Parse command-line arguments.
  // Filter out leading '--' that pnpm adds when passing args to npm scripts.
  const rawArgs = process.argv.slice(2)
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs

  const { values: options } = parseArgs({
    args,
    options: {
      arch: { type: 'string' },
      'node-version': { type: 'string' },
      'output-dir': { type: 'string' },
      platform: { type: 'string' },
    },
    strict: false,
  })

  logger.log('Socket CLI Self-Executable Builder')
  logger.log('====================================')
  logger.log(
    'Building THIN WRAPPER that downloads @socketsecurity/cli on first use',
  )

  // Generate and filter targets based on options.
  let targets = await getBuildTargets()

  if (options.platform) {
    targets = targets.filter(t => t.platform === options.platform)
  } else {
    // If no platform specified, only build for current platform to avoid cross-platform issues.
    targets = targets.filter(t => t.platform === process.platform)
  }

  if (options.arch) {
    targets = targets.filter(t => t.arch === options.arch)
  } else if (!options.platform) {
    // If no arch specified and building for current platform, use current arch.
    targets = targets.filter(t => t.arch === process.arch)
  }

  if (options.nodeVersion) {
    targets = targets.map(t => ({
      ...t,
      nodeVersion: options.nodeVersion || t.nodeVersion,
    }))
  }

  if (!targets.length) {
    throw new Error('No build targets match the specified criteria')
  }

  // Build each target.
  for (const target of targets) {
    await buildTarget(target, options)
  }

  // Copy to project root build/bins/ with variant-specific names.
  logger.log('\nCopying to Project Root build/bins/')
  logger.log('Creating variant-specific binaries in project root...')

  const PROJECT_ROOT = normalizePath(path.join(__dirname, '../../..'))
  const binsDir = normalizePath(path.join(PROJECT_ROOT, 'build/bins'))
  await fs.mkdir(binsDir, { recursive: true })

  const outputDir = options.outputDir || normalizePath(path.join(__dirname, '../dist/sea'))
  const variant = 'sea' // This is the SEA builder, smol comes from node-smol-builder.

  // Generate timestamp for build (YYYYMMDD-HHMMSS format).
  const now = new Date()
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/T/, '-')
    .slice(0, 15) // YYYYMMDD-HHMMSS

  for (const target of targets) {
    const sourceFile = normalizePath(path.join(outputDir, target.outputName))

    // Generate variant-specific binary name: node-{variant}-{platform}-{arch}-{timestamp}[.exe].
    const ext = target.platform === 'win32' ? '.exe' : ''
    const binaryName = `node-${variant}-${target.platform}-${target.arch}-${timestamp}${ext}`
    const variantBinaryPath = normalizePath(path.join(binsDir, binaryName))

    // Copy binary to build/bins/.
    await fs.copyFile(sourceFile, variantBinaryPath)

    // Make executable on Unix.
    if (target.platform !== 'win32') {
      await fs.chmod(variantBinaryPath, 0o755)
    }

    logger.log(`  ${colors.green('✓')} Copied to build/bins/${binaryName}`)
  }

  logger.log(`\nBins directory: ${binsDir}`)
  logger.log('All SEA binaries copied to project root.')

  // Also copy current platform binary to dist/socket-sea for e2e testing.
  const currentPlatform = os.platform()
  const currentArch = os.arch()
  const currentTarget = targets.find(
    t => t.platform === currentPlatform && t.arch === currentArch
  )

  if (currentTarget) {
    const distDir = normalizePath(path.join(__dirname, '..', 'dist'))
    await fs.mkdir(distDir, { recursive: true })

    const sourceFile = normalizePath(path.join(outputDir, currentTarget.outputName))
    const e2eTestBinary = normalizePath(path.join(distDir, 'socket-sea'))

    await fs.copyFile(sourceFile, e2eTestBinary)
    await fs.chmod(e2eTestBinary, 0o755)

    logger.log(`\n${colors.green('✓')} Copied ${currentTarget.outputName} to dist/socket-sea for e2e testing`)
  }

  logger.log(`\n${colors.green('✓')} Build complete!`)
  logger.log(`Output directory: ${options.outputDir || 'dist/sea'}`)
  logger.log(`Variant directory: ${binsDir}`)
  logger.log('\nNOTE: These binaries are thin wrappers that will download')
  logger.log('@socketsecurity/cli from npm on first run.')
}

// Run if executed directly.
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    logger.error('Build failed:', error)

    process.exit(1)
  })
}

export { buildTarget, downloadNodeBinary, main }
