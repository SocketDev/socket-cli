#!/usr/bin/env node
/**
 * Build script for creating self-executable Socket CLI applications.
 * Uses Node.js Single Executable Application (SEA) feature.
 *
 * IMPORTANT: This builds a THIN WRAPPER that downloads @socketsecurity/cli on first use.
 * The binary contains only:
 * - Node.js runtime
 * - Bootstrap code to download/execute @socketsecurity/cli
 * - No actual CLI implementation
 *
 * The real Socket CLI code lives in the @socketsecurity/cli npm package,
 * which is downloaded from npm registry on first run.
 *
 * Supported platforms:
 * - Windows (x64, arm64)
 * - macOS (x64, arm64)
 * - Linux (x64, arm64)
 *
 * Usage:
 * - Build all platforms: npm run build:sea
 * - Build specific platform: npm run build:sea -- --platform=darwin --arch=x64
 * - Use advanced bootstrap: npm run build:sea -- --advanced
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'

import trash from 'trash'

import { spawn } from '@socketsecurity/registry/lib/spawn'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

interface BuildTarget {
  platform: NodeJS.Platform
  arch: string
  nodeVersion: string
  outputName: string
}

interface BuildOptions {
  platform?: NodeJS.Platform
  arch?: string
  nodeVersion?: string
  outputDir?: string
}

// Supported Node.js versions for SEA.
// Node v24+ has better SEA support and smaller binary sizes.
// const SUPPORTED_NODE_VERSIONS = ['20.11.0', '22.0.0', '24.8.0']

// Default Node.js version for SEA.
// Using v20 which has stable SEA support.
const DEFAULT_NODE_VERSION = '20.11.0'

// Build targets for different platforms.
const BUILD_TARGETS: BuildTarget[] = [
  {
    platform: 'win32',
    arch: 'x64',
    nodeVersion: DEFAULT_NODE_VERSION,
    outputName: 'socket-win-x64.exe',
  },
  {
    platform: 'win32',
    arch: 'arm64',
    nodeVersion: DEFAULT_NODE_VERSION,
    outputName: 'socket-win-arm64.exe',
  },
  {
    platform: 'darwin',
    arch: 'x64',
    nodeVersion: DEFAULT_NODE_VERSION,
    outputName: 'socket-macos-x64',
  },
  {
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: DEFAULT_NODE_VERSION,
    outputName: 'socket-macos-arm64',
  },
  {
    platform: 'linux',
    arch: 'x64',
    nodeVersion: DEFAULT_NODE_VERSION,
    outputName: 'socket-linux-x64',
  },
  {
    platform: 'linux',
    arch: 'arm64',
    nodeVersion: DEFAULT_NODE_VERSION,
    outputName: 'socket-linux-arm64',
  },
]

/**
 * Download Node.js binary for a specific platform.
 */
async function downloadNodeBinary(
  version: string,
  platform: NodeJS.Platform,
  arch: string,
): Promise<string> {
  const nodeDir = path.join(os.homedir(), '.socket', 'node-binaries')
  const platformArch = `${platform}-${arch}`
  const nodeFilename = platform === 'win32' ? 'node.exe' : 'node'
  const nodePath = path.join(nodeDir, `v${version}`, platformArch, nodeFilename)

  // Check if already downloaded.
  if (existsSync(nodePath)) {
    console.log(`Using cached Node.js ${version} for ${platformArch}`)
    return nodePath
  }

  // Construct download URL.
  const baseUrl = 'https://nodejs.org/download/release'
  const archMap: Record<string, string> = {
    x64: 'x64',
    arm64: 'arm64',
    ia32: 'x86',
  }
  const platformMap: Record<string, string> = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'win',
  }

  const nodePlatform = platformMap[platform]
  const nodeArch = archMap[arch]
  const tarName = `node-v${version}-${nodePlatform}-${nodeArch}`
  const extension = platform === 'win32' ? '.zip' : '.tar.gz'
  const downloadUrl = `${baseUrl}/v${version}/${tarName}${extension}`

  console.log(`Downloading Node.js ${version} for ${platformArch}...`)
  console.log(`URL: ${downloadUrl}`)

  // Download the archive.
  const response = await fetch(downloadUrl)
  if (!response.ok) {
    throw new Error(`Failed to download Node.js: ${response.statusText}`)
  }

  // Create temp directory.
  const tempDir = path.join(
    nodeDir,
    'tmp',
    crypto.createHash('sha256').update(downloadUrl).digest('hex'),
  )
  await fs.mkdir(tempDir, { recursive: true })

  try {
    // Save archive.
    const archivePath = path.join(tempDir, `node${extension}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(archivePath, buffer)

    // Extract archive.
    if (platform === 'win32') {
      // For Windows binaries, use unzip if available, otherwise skip.
      // Note: We're building cross-platform, so we may be on macOS/Linux building for Windows.
      if (process.platform === 'win32') {
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
        // On Unix building for Windows, try unzip.
        await spawn('unzip', ['-q', archivePath, '-d', tempDir], {
          stdio: 'ignore',
        })
      }
    } else {
      // Use tar for Unix systems.
      await spawn('tar', ['-xzf', archivePath, '-C', tempDir], {
        stdio: 'ignore',
      })
    }

    // Find and move the Node binary.
    const extractedDir = path.join(tempDir, tarName)
    const extractedBinary = path.join(
      extractedDir,
      platform === 'win32' ? 'node.exe' : 'bin/node',
    )

    // Ensure target directory exists.
    const targetDir = path.dirname(nodePath)
    await fs.mkdir(targetDir, { recursive: true })

    // Move binary to final location.
    await fs.copyFile(extractedBinary, nodePath)

    // Make executable on Unix.
    if (platform !== 'win32') {
      await fs.chmod(nodePath, 0o755)
    }

    console.log(`Downloaded Node.js ${version} for ${platformArch}`)
    return nodePath
  } finally {
    // Clean up temp directory using trash.
    await trash(tempDir).catch(() => {})
  }
}

/**
 * Generate SEA configuration.
 */
async function generateSeaConfig(
  entryPoint: string,
  outputPath: string,
): Promise<string> {
  const configPath = path.join(path.dirname(outputPath), 'sea-config.json')
  const blobPath = path.join(path.dirname(outputPath), 'sea-blob.blob')

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
async function buildSeaBlob(
  nodeBinary: string,
  configPath: string,
): Promise<string> {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'))
  const blobPath = config.output

  console.log('Generating SEA blob...')

  // Generate the blob using the Node binary.
  const spawnPromise = spawn(
    nodeBinary,
    ['--experimental-sea-config', configPath],
    { stdio: 'inherit' },
  )

  const result = await spawnPromise
  if (
    result &&
    typeof result === 'object' &&
    'exitCode' in result &&
    result['exitCode'] !== 0
  ) {
    throw new Error(
      `Failed to generate SEA blob: exit code ${result['exitCode']}`,
    )
  }

  return blobPath
}

/**
 * Inject SEA blob into Node binary.
 */
async function injectSeaBlob(
  nodeBinary: string,
  blobPath: string,
  outputPath: string,
): Promise<void> {
  console.log('Creating self-executable...')

  // Copy the Node binary.
  await fs.copyFile(nodeBinary, outputPath)

  if (process.platform === 'darwin') {
    // On macOS, remove signature before injection.
    console.log('Removing signature...')
    await spawn('codesign', ['--remove-signature', outputPath], {
      stdio: 'inherit',
    })

    // Inject with macOS-specific flags.
    console.log('Injecting SEA blob...')
    await spawn(
      'pnpm',
      [
        'exec',
        'postject',
        outputPath,
        'NODE_SEA_BLOB',
        blobPath,
        '--sentinel-fuse',
        'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
        '--macho-segment-name',
        'NODE_SEA',
      ],
      { stdio: 'inherit' },
    )

    // Re-sign the binary.
    console.log('Re-signing binary...')
    await spawn('codesign', ['--sign', '-', outputPath], {
      stdio: 'inherit',
    })
  } else if (process.platform === 'win32') {
    // Windows injection.
    await spawn(
      'pnpm',
      [
        'exec',
        'postject',
        outputPath,
        'NODE_SEA_BLOB',
        blobPath,
        '--sentinel-fuse',
        'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
      ],
      { stdio: 'inherit' },
    )
    console.log('Note: Windows binary may need signing for distribution')
  } else {
    // Linux injection.
    await spawn(
      'pnpm',
      [
        'exec',
        'postject',
        outputPath,
        'NODE_SEA_BLOB',
        blobPath,
        '--sentinel-fuse',
        'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
      ],
      { stdio: 'inherit' },
    )
  }
}

/**
 * Build a single target.
 */
async function buildTarget(
  target: BuildTarget,
  options: BuildOptions,
): Promise<void> {
  const { outputDir = path.join(__dirname, '../../dist/sea') } = options

  console.log(
    `\nBuilding thin wrapper for ${target.platform}-${target.arch}...`,
  )
  console.log('(Actual CLI will be downloaded from npm on first use)')

  // Use the thin bootstrap for minimal size.
  const tsEntryPoint = path.join(__dirname, 'bootstrap.mts')

  // Ensure output directory exists.
  await fs.mkdir(outputDir, { recursive: true })

  // Build the bootstrap with Rollup to CommonJS for SEA.
  const entryPoint = path.join(outputDir, 'bootstrap.cjs')
  console.log('Building bootstrap...')

  // Set environment variables for the rollup config.
  process.env['SEA_BOOTSTRAP'] = tsEntryPoint
  process.env['SEA_OUTPUT'] = entryPoint

  await spawn('pnpm', ['run', 'build:sea:internal:bootstrap'], {
    stdio: 'inherit',
  })

  // Download Node.js binary for target platform.
  const nodeBinary = await downloadNodeBinary(
    target.nodeVersion,
    target.platform,
    target.arch,
  )

  // Generate output path.
  const outputPath = path.join(outputDir, target.outputName)
  await fs.mkdir(outputDir, { recursive: true })

  // Generate SEA configuration.
  const configPath = await generateSeaConfig(entryPoint, outputPath)

  try {
    // Build SEA blob using the downloaded Node binary.
    const blobPath = await buildSeaBlob(nodeBinary, configPath)

    // Inject blob into Node binary.
    await injectSeaBlob(nodeBinary, blobPath, outputPath)

    // Make executable on Unix.
    if (target.platform !== 'win32') {
      await fs.chmod(outputPath, 0o755)
    }

    console.log(`✓ Built ${target.outputName}`)

    // Clean up temporary files using trash.
    const filesToClean = [
      blobPath,
      entryPoint.endsWith('.compiled.mjs') ? entryPoint : null,
      entryPoint.endsWith('.mjs') && !entryPoint.endsWith('.compiled.mjs')
        ? entryPoint
        : null,
    ].filter(Boolean) as string[]

    if (filesToClean.length > 0) {
      await trash(filesToClean).catch(() => {})
    }
  } finally {
    // Clean up config.
    await trash(configPath).catch(() => {})
  }
}

/**
 * Parse command-line arguments.
 */
function parseArgs(): BuildOptions {
  const args = process.argv.slice(2)
  const options: BuildOptions = {}

  for (const arg of args) {
    if (arg.startsWith('--platform=')) {
      const platform = arg.split('=')[1]
      if (platform) {
        options.platform = platform as NodeJS.Platform
      }
    } else if (arg.startsWith('--arch=')) {
      const arch = arg.split('=')[1]
      if (arch) {
        options.arch = arch
      }
    } else if (arg.startsWith('--node-version=')) {
      const nodeVersion = arg.split('=')[1]
      if (nodeVersion) {
        options.nodeVersion = nodeVersion
      }
    } else if (arg.startsWith('--output-dir=')) {
      const outputDir = arg.split('=')[1]
      if (outputDir) {
        options.outputDir = outputDir
      }
    }
  }

  return options
}

/**
 * Main build function.
 */
async function main(): Promise<void> {
  const options = parseArgs()

  console.log('Socket CLI Self-Executable Builder')
  console.log('====================================')
  console.log(
    'Building THIN WRAPPER that downloads @socketsecurity/cli on first use',
  )

  // Filter targets based on options.
  let targets = BUILD_TARGETS

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
    // eslint-disable-next-line no-await-in-loop
    await buildTarget(target, options)
  }

  console.log('\n✅ Build complete!')
  console.log(`Output directory: ${options.outputDir || 'dist/sea'}`)
  console.log('\nNOTE: These binaries are thin wrappers that will download')
  console.log('@socketsecurity/cli from npm on first run.')
}

// Run if executed directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Build failed:', error)
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  })
}

export { buildTarget, downloadNodeBinary, main }
