/**
 * @fileoverview SEA (Single Executable Application) build utilities for Socket ecosystem.
 * Provides comprehensive tools for building cross-platform SEA binaries.
 */

import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/registry/lib/fs'
import { httpRequest } from '@socketsecurity/registry/lib/http-request'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { getSocketHomePath } from '@socketsecurity/registry/lib/paths'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../constants.mts'

const { WIN32 } = constants

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
 */
// c8 ignore start - Requires spawning node binary with experimental SEA config.
export async function buildSeaBlob(
  nodeBinary: string,
  configPath: string,
): Promise<string> {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'))
  const blobPath = config.output

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
  await fs.mkdir(outputDir, { recursive: true })

  // Download Node.js binary for target platform.
  const nodeBinary = await downloadNodeBinary(
    target.nodeVersion,
    target.platform,
    target.arch,
  )

  // Generate output path.
  const outputPath = normalizePath(path.join(outputDir, target.outputName))
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

    // Clean up temporary files.
    await safeDelete(blobPath).catch(() => {})
  } finally {
    // Clean up config.
    await safeDelete(configPath).catch(() => {})
  }

  return outputPath
}

/**
 * Download Node.js binary for a specific platform.
 * Caches downloads in ~/.socket/node-binaries/.
 */
export async function downloadNodeBinary(
  version: string,
  platform: NodeJS.Platform | string,
  arch: string,
): Promise<string> {
  const isPlatWin = platform === 'win32'
  const nodeDir = normalizePath(path.join(getSocketHomePath(), 'node-binaries'))
  const platformArch = `${platform}-${arch}`
  const nodeFilename = platform === 'win32' ? 'node.exe' : 'node'
  const nodePath = normalizePath(
    path.join(nodeDir, `v${version}`, platformArch, nodeFilename),
  )

  // Check if already downloaded.
  if (existsSync(nodePath)) {
    return nodePath
  }

  // Construct download URL.
  const baseUrl =
    process.env['SOCKET_NODE_DOWNLOAD_URL'] ||
    'https://nodejs.org/download/release'
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
    win32: 'win',
  } as unknown as Record<string, string | undefined>

  const nodePlatform = platformMap[platform]
  const nodeArch = archMap[arch]
  const tarName = `node-v${version}-${nodePlatform}-${nodeArch}`
  const extension = isPlatWin ? '.zip' : '.tar.gz'
  const downloadUrl = `${baseUrl}/v${version}/${tarName}${extension}`

  // Download the archive.
  const response = await httpRequest(downloadUrl)
  if (!response.ok) {
    throw new Error(`Failed to download Node.js: ${response.statusText}`)
  }

  // Create temp directory.
  const tempDir = normalizePath(
    path.join(
      nodeDir,
      'tmp',
      createHash('sha256').update(downloadUrl).digest('hex'),
    ),
  )
  await fs.mkdir(tempDir, { recursive: true })

  try {
    // Save archive.
    const archivePath = normalizePath(path.join(tempDir, `node${extension}`))
    await fs.writeFile(archivePath, response.body)

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

    return nodePath
  } finally {
    // Clean up the temp directory.
    await safeDelete(tempDir).catch(() => {})
  }
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
      outputName: 'socket-macos-arm64',
      platform: 'darwin',
    },
    {
      arch: 'x64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-macos-x64',
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
  ]
}

/**
 * Get the default Node.js version for SEA builds.
 * Prefers SOCKET_SEA_NODE_VERSION env var, falls back to latest Current release.
 */
export async function getDefaultNodeVersion(): Promise<string> {
  return (
    process.env['SOCKET_SEA_NODE_VERSION'] || (await getLatestCurrentRelease())
  )
}

/**
 * Fetch the latest stable Node.js "Current" release version.
 * Based on Node.js release schedule: https://nodejs.org/en/about/previous-releases
 * Returns the latest even-numbered major version (e.g., v24, v26, v28).
 * @throws {Error} When Node.js releases cannot be fetched.
 */
export async function getLatestCurrentRelease(): Promise<string> {
  try {
    const response = await httpRequest('https://nodejs.org/dist/index.json')
    if (!response.ok) {
      throw new Error(
        `Failed to fetch Node.js releases: ${response.statusText}`,
      )
    }

    const releases = JSON.parse(response.body.toString('utf8')) as Array<{
      version: string
    }>

    // Find the latest Current release (even-numbered major version).
    // Current releases are even-numbered (e.g., v24.x, v26.x, v28.x).
    // Filter for v24+ to ensure good SEA support.
    const latestCurrent = releases
      .filter(release => {
        const match = release.version.match(/^v(\d+)\./)
        if (!match?.[1]) {
          return false
        }
        const major = Number.parseInt(match[1], 10)
        // Even-numbered and >= 24.
        return major >= 24 && major % 2 === 0
      })
      .sort((a, b) =>
        b.version.localeCompare(a.version, undefined, { numeric: true }),
      )[0]

    if (latestCurrent) {
      // Remove 'v' prefix.
      return latestCurrent.version.slice(1)
    }

    // Fallback to hardcoded version if no suitable version found.
    return '24.8.0'
  } catch (e: any) {
    throw new Error('Failed to fetch latest Node.js Current release', {
      cause: e,
    })
  }
}

/**
 * Inject SEA blob into Node binary.
 */
export async function injectSeaBlob(
  nodeBinary: string,
  blobPath: string,
  outputPath: string,
): Promise<void> {
  // Check if postject is available.
  try {
    const result = await spawn('pnpm', ['exec', 'which', 'postject'], {
      stdio: 'pipe',
    })
    if (result.code !== 0) {
      throw new Error('postject not found')
    }
  } catch {
    throw new Error(
      'postject is required to inject the SEA blob into the Node.js binary.\n' +
        'Please install it: pnpm add -D postject',
    )
  }

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
      console.warn(
        'Warning: codesign not found. The binary may not work correctly on macOS.\n' +
          'Install Xcode Command Line Tools: xcode-select --install',
      )
    } else {
      // On macOS, remove signature before injection.
      await spawn('codesign', ['--remove-signature', outputPath], {
        stdio: 'inherit',
      })
    }

    // Inject with macOS-specific flags.
    // Following Node.js SEA documentation: https://nodejs.org/api/single-executable-applications.html
    await spawn(
      'pnpm',
      [
        'exec',
        'postject',
        outputPath,
        'NODE_SEA_BLOB',
        blobPath,
        '--sentinel-fuse',
        /*@__INLINE__*/ require('./constants/NODE_SEA_FUSE'),
        '--macho-segment-name',
        'NODE_SEA',
      ],
      { stdio: 'inherit' },
    )

    // Re-sign the binary if codesign is available.
    if (codesignAvailable) {
      await spawn('codesign', ['--sign', '-', outputPath], {
        stdio: 'inherit',
      })
    }
  } else if (process.platform === 'win32') {
    // Windows injection.
    // Following Node.js SEA documentation: https://nodejs.org/api/single-executable-applications.html
    await spawn(
      'pnpm',
      [
        'exec',
        'postject',
        outputPath,
        'NODE_SEA_BLOB',
        blobPath,
        '--sentinel-fuse',
        /*@__INLINE__*/ require('./constants/NODE_SEA_FUSE'),
      ],
      { stdio: 'inherit' },
    )
  } else {
    // Linux injection.
    // Following Node.js SEA documentation: https://nodejs.org/api/single-executable-applications.html
    await spawn(
      'pnpm',
      [
        'exec',
        'postject',
        outputPath,
        'NODE_SEA_BLOB',
        blobPath,
        '--sentinel-fuse',
        /*@__INLINE__*/ require('./constants/NODE_SEA_FUSE'),
      ],
      { stdio: 'inherit' },
    )
  }
}
// c8 ignore stop
