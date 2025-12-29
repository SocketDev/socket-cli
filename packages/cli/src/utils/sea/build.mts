/**
 * @fileoverview SEA (Single Executable Application) build utilities for Socket ecosystem.
 * Provides comprehensive tools for building cross-platform SEA binaries.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { downloadReleaseAsset } from 'build-infra/lib/github-releases'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { httpRequest } from '@socketsecurity/lib/http-request'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'
import { spawn } from '@socketsecurity/lib/spawn'

import ENV from '../../constants/env.mts'

const logger = getDefaultLogger()

export interface BuildTargetOptions {
  arch: string
  nodeVersion: string
  outputName: string
  platform: NodeJS.Platform | string
}

export interface SeaBuildOptions {
  outputDir?: string | undefined
}

/**
 * Build SEA blob.
 * Uses the current Node.js process instead of the target binary to avoid issues
 * with cross-platform builds and potentially corrupted downloaded binaries.
 */
// c8 ignore start - Requires spawning node binary with experimental SEA config.
export async function buildSeaBlob(configPath: string): Promise<string> {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'))
  const blobPath = config.output

  // Generate the blob using the current Node.js process.
  // We use process.execPath (the current Node) instead of the target binary because:
  // 1. The blob format is platform-independent
  // 2. Downloaded node-smol binaries may have issues running on the host system
  // 3. Cross-platform builds wouldn't work (e.g., building Windows binary on macOS)
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
    result.exitCode !== 0
  ) {
    throw new Error(`Failed to generate SEA blob: exit code ${result.exitCode}`)
  }

  return blobPath
}
// c8 ignore stop

/**
 * Build a single SEA target.
 */
// c8 ignore start - Requires downloading binaries, building blobs, and binary injection.
export async function buildTarget(
  target: BuildTargetOptions,
  entryPoint: string,
  options?: SeaBuildOptions | undefined,
): Promise<string> {
  const { outputDir = normalizePath(path.join(process.cwd(), 'dist/sea')) } = {
    __proto__: null,
    ...options,
  } as SeaBuildOptions

  // Ensure output directory exists.
  await safeMkdir(outputDir, { recursive: true })

  // Download Node.js binary for target platform.
  const nodeBinary = await downloadNodeBinary(
    target.nodeVersion,
    target.platform,
    target.arch,
  )

  // Generate output path.
  const outputPath = normalizePath(path.join(outputDir, target.outputName))
  await safeMkdir(outputDir, { recursive: true })

  // Generate SEA configuration.
  const configPath = await generateSeaConfig(entryPoint, outputPath)

  try {
    // Build SEA blob using the current Node.js process.
    const blobPath = await buildSeaBlob(configPath)

    // Inject blob into Node binary.
    await injectSeaBlob(nodeBinary, blobPath, outputPath)

    // Make executable on Unix.
    if (target.platform !== 'win32') {
      await fs.chmod(outputPath, 0o755)
    }

    // Clean up temporary files.
    await safeDelete(blobPath).catch(() => {})
  } finally {
    // Clean up config.
    await safeDelete(configPath).catch(() => {})
  }

  return outputPath
}

/**
 * Get the root path of the CLI package (packages/cli).
 */
function getRootPath(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  return path.join(__dirname, '../../..')
}

/**
 * Download Node.js binary for a specific platform.
 * Caches downloads in build/node-smol/.
 *
 * Uses socket-btm smol releases (pre-compiled binaries).
 *
 * @example
 * downloadNodeBinary('20251213-7cf90d2', 'darwin', 'arm64')
 * // Fetches: https://github.com/SocketDev/socket-btm/releases/download/node-smol-20251213-7cf90d2/node-darwin-arm64
 */
export async function downloadNodeBinary(
  version: string,
  platform: NodeJS.Platform | string,
  arch: string,
): Promise<string> {
  const isPlatWin = platform === 'win32'
  const rootPath = getRootPath()
  const nodeDir = normalizePath(path.join(rootPath, 'build/node-smol'))
  const platformArch = `${platform}-${arch}`
  const nodeFilename = platform === 'win32' ? 'node.exe' : 'node'
  const nodePath = normalizePath(
    path.join(nodeDir, `v${version}`, platformArch, nodeFilename),
  )

  // Check if already downloaded.
  if (existsSync(nodePath)) {
    return nodePath
  }

  // Arch and platform mappings.
  const archMap = {
    __proto__: null,
    arm64: 'arm64',
    ia32: 'x86',
    x64: 'x64',
  } as unknown as Record<string, string | undefined>
  const platformMap = {
    __proto__: null,
    darwin: 'darwin',
    linux: 'linux',
    'linux-musl': 'linux',
    win32: 'win',
  } as unknown as Record<string, string | undefined>

  const nodePlatform = platformMap[platform]
  const nodeArch = archMap[arch]

  // Use socket-btm smol binaries from GitHub releases.
  // Tag format: node-smol-YYYYMMDD-HASH (e.g., node-smol-20251213-7cf90d2)
  // Asset format: node-{PLATFORM}-{ARCH}[-musl][.exe]
  const tag = `node-smol-${version}`
  const muslSuffix = platform === 'linux-musl' ? '-musl' : ''
  const binaryName = `node-${nodePlatform}-${nodeArch}${muslSuffix}${isPlatWin ? '.exe' : ''}`

  logger.log(`Downloading Node.js smol from socket-btm ${tag}...`)

  // Ensure target directory exists.
  const targetDir = path.dirname(nodePath)
  await safeMkdir(targetDir, { recursive: true })

  // Download using github-releases helper (handles HTTP 302 redirects automatically).
  await downloadReleaseAsset(tag, binaryName, nodePath)

  // Make executable on Unix.
  if (!isPlatWin) {
    await fs.chmod(nodePath, 0o755)
  }

  return nodePath
}

/**
 * Generate SEA configuration.
 */
// c8 ignore start - Requires fs.writeFile to write config to disk.
export async function generateSeaConfig(
  entryPoint: string,
  outputPath: string,
): Promise<string> {
  const configPath = normalizePath(
    path.join(path.dirname(outputPath), 'sea-config.json'),
  )
  const blobPath = normalizePath(
    path.join(path.dirname(outputPath), 'sea-blob.blob'),
  )

  const config = {
    // No assets to minimize size.
    assets: {},
    disableExperimentalSEAWarning: true,
    main: entryPoint,
    output: blobPath,
    // Enable code cache for optimization.
    useCodeCache: true,
    // Disable for compatibility.
    useSnapshot: false,
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
  return configPath
}
// c8 ignore stop

/**
 * Generate build targets for different platforms.
 */
export async function getBuildTargets(): Promise<BuildTargetOptions[]> {
  const defaultNodeVersion = await getDefaultNodeVersion()

  return [
    {
      arch: 'arm64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-win-arm64.exe',
      platform: 'win32',
    },
    {
      arch: 'x64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-win-x64.exe',
      platform: 'win32',
    },
    {
      arch: 'arm64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-darwin-arm64',
      platform: 'darwin',
    },
    {
      arch: 'x64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-darwin-x64',
      platform: 'darwin',
    },
    {
      arch: 'arm64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-linux-arm64',
      platform: 'linux',
    },
    {
      arch: 'x64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-linux-x64',
      platform: 'linux',
    },
    {
      arch: 'arm64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-linux-arm64-musl',
      platform: 'linux-musl',
    },
    {
      arch: 'x64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-linux-x64-musl',
      platform: 'linux-musl',
    },
  ]
}

/**
 * Get the default Node.js version for SEA builds.
 * Returns the socket-btm tag suffix (e.g., "20251213-7cf90d2").
 * Prefers SOCKET_CLI_SEA_NODE_VERSION env var, falls back to latest socket-btm release.
 */
export async function getDefaultNodeVersion(): Promise<string> {
  if (ENV.SOCKET_CLI_SEA_NODE_VERSION) {
    return ENV.SOCKET_CLI_SEA_NODE_VERSION
  }

  // Fetch the latest node-smol release tag from socket-btm.
  return await getLatestSocketBtmNodeRelease()
}

/**
 * Fetch the latest node-smol release tag from socket-btm.
 * Returns the tag suffix (e.g., "20251213-7cf90d2").
 * @throws {Error} When socket-btm releases cannot be fetched.
 */
export async function getLatestSocketBtmNodeRelease(): Promise<string> {
  try {
    const response = await httpRequest(
      'https://api.github.com/repos/SocketDev/socket-btm/releases',
    )
    if (!response.ok) {
      throw new Error(
        `Failed to fetch socket-btm releases: ${response.statusText}`,
      )
    }

    const releases = JSON.parse(response.body.toString('utf8')) as Array<{
      tag_name: string
    }>

    // Find the latest node-smol release.
    const nodeSmolRelease = releases.find(release =>
      release.tag_name.startsWith('node-smol-'),
    )

    if (!nodeSmolRelease) {
      throw new Error('No node-smol release found in socket-btm')
    }

    // Extract the tag suffix (e.g., "node-smol-20251213-7cf90d2" -> "20251213-7cf90d2").
    return nodeSmolRelease.tag_name.replace('node-smol-', '')
  } catch (e: any) {
    throw new Error('Failed to fetch latest socket-btm node-smol release', {
      cause: e,
    })
  }
}

/**
 * Get path to binject binary from build directory.
 */
function getBinjectPath(): string {
  const platform = process.platform
  const arch = process.arch

  let binaryName: string
  if (platform === 'darwin') {
    binaryName = `binject-darwin-${arch}`
  } else if (platform === 'linux') {
    binaryName = `binject-linux-musl-${arch}`
  } else if (platform === 'win32') {
    binaryName = `binject-win-${arch}.exe`
  } else {
    throw new Error(`Unsupported platform: ${platform}`)
  }

  // Compute package root path (src/utils/sea -> packages/cli).
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const rootPath = path.join(__dirname, '../../..')
  return path.join(rootPath, 'build/binject', binaryName)
}

/**
 * Inject SEA blob into Node binary.
 */
export async function injectSeaBlob(
  nodeBinary: string,
  blobPath: string,
  outputPath: string,
): Promise<void> {
  // Get binject binary path.
  const binjectPath = getBinjectPath()

  // Check if binject is available.
  if (!existsSync(binjectPath)) {
    throw new Error(
      `binject binary not found at ${binjectPath}\n` +
        'Please run the build script first to download binject from socket-btm releases.',
    )
  }

  // Inject SEA blob into Node binary.
  // binject handles signature removal, injection, and re-signing automatically.
  await spawn(
    binjectPath,
    [
      'inject',
      '--executable',
      nodeBinary,
      '--output',
      outputPath,
      '--sea',
      blobPath,
      '--vfs-compat',
    ],
    { stdio: 'inherit' },
  )
}
// c8 ignore stop
