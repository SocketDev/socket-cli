/**
 * VFS extraction utilities for socket-basics tools bundled in SEA binaries.
 *
 * Extracts Python, Trivy, TruffleHog, and OpenGrep from the VFS (Virtual File System)
 * embedded in SEA binaries and caches them for socket-basics execution.
 *
 * Extraction paths (all under ~/.socket/_dlx/<hash>/):
 * - python/                           # Python runtime
 * - python/lib/python3.11/site-packages/  # Python packages (socketsecurity)
 * - trivy                             # Standalone binary
 * - trufflehog                        # Standalone binary
 * - opengrep                          # Standalone binary
 */

import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'

import { debug } from '@socketsecurity/lib/debug'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'
import { spawn } from '@socketsecurity/lib/spawn'

import { UPDATE_STORE_DIR } from '../../constants/paths.mts'
import { getOpengrepVersion } from '../../env/opengrep-version.mts'
import { getPyCliVersion } from '../../env/pycli-version.mts'
import { getPythonMajorMinor } from '../../env/python-version.mts'
import { getTrivyVersion } from '../../env/trivy-version.mts'
import { getTrufflehogVersion } from '../../env/trufflehog-version.mts'
import { isSeaBinary } from '../sea/detect.mts'

const require = createRequire(import.meta.url)

// Conditionally load node:sea module (Node.js 24+ only).
let getAsset: ((key: string) => ArrayBuffer) | undefined
try {
  const sea = require('node:sea')
  getAsset = sea.getAsset
} catch {
  // node:sea not available (Node.js < 24 or not in SEA context).
}

const logger = getDefaultLogger()

// VFS asset path prefix for basics tools (Python, Trivy, TruffleHog, OpenGrep).
const VFS_ASSET_PREFIX = 'basics-tools'

// Basics tool names bundled in VFS.
const BASICS_TOOLS = ['python', 'trivy', 'trufflehog', 'opengrep'] as const

/**
 * Get the base dlx directory path for node-smol.
 * This is the shared extraction directory: ~/.socket/_dlx/<node-smol-hash>/
 *
 * @returns Path to node-smol's dlx directory.
 */
function getNodeSmolBasePath(): string {
  let nodeSmolHash = 'node-smol-placeholder'

  try {
    // Try to get hash from process.smol API (if available in future node-smol).
    const processWithSmol = process as unknown as {
      smol?: { getHash?: () => string }
    }
    if (typeof processWithSmol.smol?.getHash === 'function') {
      nodeSmolHash = processWithSmol.smol.getHash()
    } else {
      // Fallback: hash based on Node.js version and platform.
      const hashInput = `${process.version}-${process.platform}-${process.arch}`
      const hash = createHash('sha256').update(hashInput).digest('hex')
      nodeSmolHash = hash.slice(0, 16)
    }
  } catch {
    // Fallback to versioned hash.
    const hashInput = `${process.version}-${process.platform}-${process.arch}`
    const hash = createHash('sha256').update(hashInput).digest('hex')
    nodeSmolHash = hash.slice(0, 16)
  }

  return normalizePath(path.join(homedir(), UPDATE_STORE_DIR, nodeSmolHash))
}

/**
 * Get the Python site-packages path for extracting Python packages.
 * Path: ~/.socket/_dlx/<hash>/python/lib/python{major.minor}/site-packages/
 *
 * @returns Path to site-packages directory.
 */
export function getPythonSitePackagesPath(): string {
  const basePath = getNodeSmolBasePath()
  const pythonMajorMinor = getPythonMajorMinor()
  return normalizePath(
    path.join(basePath, 'python', 'lib', `python${pythonMajorMinor}`, 'site-packages'),
  )
}

/**
 * Check if basics tools are available for socket-basics.
 *
 * Returns true if:
 * 1. Running in SEA mode with VFS assets, OR
 * 2. Tools are available in system PATH
 *
 * @returns True if basics tools are available for socket-basics.
 */
export function areBasicsToolsAvailable(): boolean {
  // Check if running in SEA mode with VFS assets.
  if (isSeaBinary() && getAsset) {
    try {
      // Check if at least Python is available in VFS.
      getAsset(`${VFS_ASSET_PREFIX}/python`)
      return true
    } catch {
      debug('notice', 'SEA mode but VFS assets not available')
      return false
    }
  }

  // Not in SEA mode - would need to check system PATH.
  // For now, return false (tools must be bundled in SEA).
  debug('notice', 'Not in SEA mode - security tools not available')
  return false
}

/**
 * Extract basics tools from VFS to the node-smol dlx directory.
 *
 * Extracts Python, Trivy, TruffleHog, and OpenGrep binaries from the SEA's VFS
 * to ~/.socket/_dlx/<hash>/. The cache is persistent across runs.
 *
 * Extraction paths:
 * - python/bin/python - Python runtime
 * - python/lib/python3.11/site-packages/ - Python packages (socketsecurity)
 * - trivy - Standalone binary at root
 * - trufflehog - Standalone binary at root
 * - opengrep - Standalone binary at root
 *
 * @param cacheDir - Directory to extract tools to (default: ~/.socket/_dlx/<hash>/).
 * @returns Path to the extracted tools directory, or null if extraction failed.
 *
 * @example
 * const toolsDir = await extractBasicsTools()
 * if (toolsDir) {
 *   const pythonPath = path.join(toolsDir, 'python', 'bin', 'python')
 *   const trivyPath = path.join(toolsDir, 'trivy')
 *   const sitePackages = getPythonSitePackagesPath() // For Python packages
 * }
 */
export async function extractBasicsTools(
  cacheDir?: string,
): Promise<string | null> {
  if (!isSeaBinary() || !getAsset) {
    logger.warn('Not running in SEA mode - cannot extract basics tools')
    return null
  }

  // Default extraction directory: ~/.socket/_dlx/<node-smol-hash>/
  // This is shared with other VFS-extracted tools (external-tools).
  const extractDir = cacheDir || getNodeSmolBasePath()

  // Get current tool versions for cache validation.
  // Include platform/arch to prevent serving wrong binaries after architecture change.
  const toolVersions = {
    arch: process.arch,
    opengrep: getOpengrepVersion(),
    platform: process.platform,
    pycli: getPyCliVersion(),
    trivy: getTrivyVersion(),
    trufflehog: getTrufflehogVersion(),
  }

  // Check if already extracted (cache hit).
  const cacheMarker = normalizePath(path.join(extractDir, '.extracted'))
  const cacheMetadata = normalizePath(path.join(extractDir, '.version'))

  if (existsSync(cacheMarker) && existsSync(cacheMetadata)) {
    try {
      const cachedVersionsJson = await fs.readFile(cacheMetadata, 'utf8')
      const cachedVersions = JSON.parse(cachedVersionsJson)
      const versionsMatch =
        cachedVersions.arch === toolVersions.arch &&
        cachedVersions.opengrep === toolVersions.opengrep &&
        cachedVersions.platform === toolVersions.platform &&
        cachedVersions.pycli === toolVersions.pycli &&
        cachedVersions.trivy === toolVersions.trivy &&
        cachedVersions.trufflehog === toolVersions.trufflehog

      if (versionsMatch) {
        debug('notice', `Basics tools already extracted to: ${extractDir}`)
        return extractDir
      }

      debug('notice', 'Tool versions changed, re-extracting...')
      await safeDelete(extractDir)
    } catch (_e) {
      // Corrupted metadata, re-extract.
      debug('warn', 'Cache metadata corrupted, re-extracting...')
      await safeDelete(extractDir)
    }
  }

  // Create lock file to prevent concurrent extraction (TOCTOU mitigation).
  const lockFile = normalizePath(path.join(extractDir, '.extracting'))
  await safeMkdir(extractDir)

  try {
    // Try to create lock file atomically (wx = write + exclusive).
    await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' })
  } catch (e: unknown) {
    const error = e as NodeJS.ErrnoException
    if (error.code === 'EEXIST') {
      // Another process is extracting, wait and check for completion.
      logger.info('Another process is extracting basics tools, waiting...')
      for (let i = 0; i < 60; i++) {
        // Wait up to 60 seconds.
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 1_000))
        if (existsSync(cacheMarker)) {
          debug('notice', 'Basics tools extracted by another process')
          return extractDir
        }

        // Check if lock holder is still alive every 5 iterations.
        if (i % 5 === 4) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const lockPid = await fs.readFile(lockFile, 'utf8')
            const pid = Number.parseInt(lockPid.trim(), 10)
            if (!Number.isNaN(pid) && pid > 0) {
              try {
                // Signal 0 checks process existence.
                process.kill(pid, 0)
              } catch (pidError) {
                const pidErr = pidError as NodeJS.ErrnoException
                // EPERM means process exists but no permission (treat as alive).
                // ESRCH means process doesn't exist (dead).
                if (pidErr.code !== 'EPERM') {
                  // Lock holder died, clean up and retry.
                  debug('warn', 'Stale lock detected, removing and retrying...')
                  // eslint-disable-next-line no-await-in-loop
                  await fs.unlink(lockFile).catch(() => {})
                  return extractBasicsTools(cacheDir)
                }
              }
            }
          } catch {
            // Lock file gone, retry extraction.
            return extractBasicsTools(cacheDir)
          }
        }
      }
      throw new Error(
        'Timeout waiting for another process to extract basics tools',
      )
    }
    throw e
  }

  logger.info('Extracting basics tools from VFS...')

  const isPlatWin = process.platform === 'win32'
  const tools = BASICS_TOOLS
  const extractedTools: string[] = []

  try {
    for (const tool of tools) {
      const assetKey = `${VFS_ASSET_PREFIX}/${tool}`
      const assetBuffer = getAsset(assetKey)

      // Python is a directory, others are single binaries.
      if (tool === 'python') {
        // Python extraction requires special handling - it's a tar.gz archive.
        // For now, we'll extract the entire python directory from VFS.
        // The VFS should already have the python directory structure.
        const pythonDir = normalizePath(path.join(extractDir, 'python'))
        // eslint-disable-next-line no-await-in-loop
        await safeMkdir(pythonDir)

        const pythonBinDir = normalizePath(path.join(pythonDir, 'bin'))
        // eslint-disable-next-line no-await-in-loop
        await safeMkdir(pythonBinDir)

        const pythonExe = isPlatWin ? 'python.exe' : 'python'
        const pythonBinPath = normalizePath(path.join(pythonBinDir, pythonExe))

        // Write Python binary.
        // eslint-disable-next-line no-await-in-loop
        await fs.writeFile(pythonBinPath, Buffer.from(assetBuffer))

        // Make executable on Unix.
        if (!isPlatWin) {
          // eslint-disable-next-line no-await-in-loop
          await fs.chmod(pythonBinPath, 0o755)
        }

        logger.info(`  ✓ Extracted ${tool}`)
        extractedTools.push(tool)
      } else {
        // Regular tool (single binary).
        const toolExe = isPlatWin ? `${tool}.exe` : tool
        const toolPath = normalizePath(path.join(extractDir, toolExe))

        // Write tool binary.
        // eslint-disable-next-line no-await-in-loop
        await fs.writeFile(toolPath, Buffer.from(assetBuffer))

        // Make executable on Unix.
        if (!isPlatWin) {
          // eslint-disable-next-line no-await-in-loop
          await fs.chmod(toolPath, 0o755)
        }

        logger.info(`  ✓ Extracted ${tool}`)
        extractedTools.push(tool)
      }
    }

    // Only write cache marker if ALL tools extracted successfully.
    if (extractedTools.length !== tools.length) {
      const missingTools = tools.filter(t => !extractedTools.includes(t))
      throw new Error(
        `Failed to extract all basics tools. Missing: ${missingTools.join(', ')}`,
      )
    }

    // Validate all extracted binaries work after extraction.
    logger.info('Validating extracted basics tools...')

    const pythonExe = isPlatWin ? 'python.exe' : 'python'
    const pythonPath = normalizePath(
      path.join(extractDir, 'python', 'bin', pythonExe),
    )

    const validateResult = await spawn(pythonPath, ['--version'], {
      stdio: 'pipe',
      timeout: 5_000,
    })

    if (!validateResult || validateResult.code !== 0) {
      throw new Error(
        `Python validation failed: ${validateResult?.stderr || 'Unable to execute Python'}`,
      )
    }

    const pythonVersion = String(validateResult.stdout || '').trim()
    debug('notice', `Python validated: ${pythonVersion}`)

    // Validate other security tools.
    const toolsToValidate = ['trivy', 'trufflehog', 'opengrep'] as const
    for (const tool of toolsToValidate) {
      const toolExe = isPlatWin ? `${tool}.exe` : tool
      const toolPath = normalizePath(path.join(extractDir, toolExe))

      // eslint-disable-next-line no-await-in-loop
      const toolValidateResult = await spawn(toolPath, ['--version'], {
        stdio: 'pipe',
        timeout: 5_000,
      })

      if (!toolValidateResult || toolValidateResult.code !== 0) {
        throw new Error(
          `${tool} validation failed: ${toolValidateResult?.stderr || `Unable to execute ${tool}`}`,
        )
      }

      const toolVersion = String(toolValidateResult.stdout || '').trim()
      debug('notice', `${tool} validated: ${toolVersion}`)
    }

    // Write version metadata file before cache marker.
    await fs.writeFile(
      cacheMetadata,
      JSON.stringify(toolVersions, null, 2),
      'utf8',
    )

    // Write cache marker.
    await fs.writeFile(cacheMarker, new Date().toISOString(), 'utf8')

    // Remove lock file.
    await fs.unlink(lockFile).catch(() => {
      // Ignore errors (file might already be deleted).
    })

    logger.success(`Basics tools extracted to: ${extractDir}`)
    return extractDir
  } catch (e) {
    // Cleanup on failure.
    logger.error('VFS extraction failed, cleaning up...')

    // Remove lock file.
    await fs.unlink(lockFile).catch(() => {
      // Ignore errors.
    })

    // Remove extraction directory.
    await safeDelete(extractDir).catch(() => {
      // Ignore cleanup errors.
    })

    throw e
  }
}

/**
 * Get paths to extracted basics tools.
 *
 * @param toolsDir - Directory containing extracted tools.
 * @returns Object with paths to each tool binary.
 *
 * @example
 * const toolsDir = await extractBasicsTools()
 * if (toolsDir) {
 *   const paths = getToolPaths(toolsDir)
 *   logger.log('Python:', paths.python)
 *   logger.log('Trivy:', paths.trivy)
 * }
 */
export function getBasicsToolPaths(toolsDir: string): {
  opengrep: string
  python: string
  trivy: string
  trufflehog: string
} {
  const isPlatWin = process.platform === 'win32'
  const pythonExe = isPlatWin ? 'python.exe' : 'python'

  return {
    opengrep: normalizePath(
      path.join(toolsDir, isPlatWin ? 'opengrep.exe' : 'opengrep'),
    ),
    python: normalizePath(path.join(toolsDir, 'python', 'bin', pythonExe)),
    trivy: normalizePath(
      path.join(toolsDir, isPlatWin ? 'trivy.exe' : 'trivy'),
    ),
    trufflehog: normalizePath(
      path.join(toolsDir, isPlatWin ? 'trufflehog.exe' : 'trufflehog'),
    ),
  }
}
