/**
 * VFS extraction utilities for external tools bundled in SEA binaries.
 *
 * Extracts external tools from the VFS (Virtual File System) embedded in SEA binaries
 * and caches them for execution.
 *
 * Tool types:
 * - Standalone binaries (GitHub releases): sfw
 * - npm packages (with dependencies): cdxgen, coana, socket-patch, synp
 *
 * Build-time package preparation:
 * npm packages use @npmcli/arborist to download complete packages with node_modules/
 * and all production dependencies. See scripts/sea-build-utils/npm-packages.mjs:
 *
 * ```javascript
 * import { Arborist } from '@npmcli/arborist'
 *
 * const arb = new Arborist({
 *   audit: false,
 *   binLinks: true,
 *   cache: getSocketCacacheDir(),      // ~/.socket/_cacache
 *   fund: false,
 *   ignoreScripts: true,               // Security: no install scripts
 *   omit: ['dev'],                     // Production deps only
 *   path: packageDir,
 *   silent: true,
 * })
 * await arb.reify({ add: [packageSpec], save: false })
 * ```
 *
 * VFS structure in SEA binaries:
 *   sfw                               # Standalone binary from GitHub release
 *   node_modules/
 *     ├── @cyclonedx/cdxgen/        # Full package with dependencies
 *     │   ├── bin/cdxgen
 *     │   ├── package.json
 *     │   └── node_modules/         # Dependencies
 *     ├── @coana-tech/cli/
 *     │   ├── bin/coana
 *     │   ├── package.json
 *     │   └── node_modules/
 *     ├── @socketsecurity/socket-patch/
 *     │   ├── bin/socket-patch
 *     │   ├── package.json
 *     │   └── node_modules/
 *     └── synp/
 *         ├── bin/synp
 *         ├── package.json
 *         └── node_modules/
 *
 * TODO: Runtime directory tree extraction
 * Currently extracts only single binary files. Need to:
 * - Extract entire directory trees from VFS (not just binaries)
 * - Use process.smol VFS APIs that support directory extraction
 * - Preserve file permissions and directory structure
 * - Handle node_modules/ dependencies at runtime
 */

import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'

import { debug } from '@socketsecurity/lib/debug'
import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'

import { UPDATE_STORE_DIR } from '../../constants/paths.mts'
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

// VFS asset path prefix for external tools.
const VFS_ASSET_PREFIX = 'external-tools'

// External tool names bundled in VFS.
// Includes both npm packages and standalone binaries.
export const EXTERNAL_TOOLS = [
  'sfw',
  'cdxgen',
  'coana',
  'socket-patch',
  'synp',
] as const

export type ExternalTool = (typeof EXTERNAL_TOOLS)[number]

// Map of npm package tools to their node_modules/ paths.
// Standalone binaries (like sfw) are NOT in this map and extract to direct paths.
const TOOL_NPM_PATHS: Partial<Record<ExternalTool, { packageName: string; binPath: string }>> = {
  cdxgen: {
    packageName: '@cyclonedx/cdxgen',
    binPath: 'node_modules/@cyclonedx/cdxgen/bin/cdxgen',
  },
  coana: {
    packageName: '@coana-tech/cli',
    binPath: 'node_modules/@coana-tech/cli/bin/coana',
  },
  'socket-patch': {
    packageName: '@socketsecurity/socket-patch',
    binPath: 'node_modules/@socketsecurity/socket-patch/bin/socket-patch',
  },
  synp: {
    packageName: 'synp',
    binPath: 'node_modules/synp/bin/synp',
  },
}

/**
 * Get the base dlx directory path for node-smol.
 * This is where both VFS-extracted tools and npm-installed packages live.
 *
 * Structure:
 * ~/.socket/_dlx/<node-smol-hash>/
 *   ├── node/node                    # Node binary
 *   ├── sfw                          # Standalone binary (GitHub release)
 *   └── node_modules/                # npm packages with dependencies
 *       ├── @cyclonedx/cdxgen/
 *       │   ├── bin/cdxgen
 *       │   └── node_modules/
 *       ├── @coana-tech/cli/
 *       │   ├── bin/coana
 *       │   └── node_modules/
 *       ├── @socketsecurity/socket-patch/
 *       │   ├── bin/socket-patch
 *       │   └── node_modules/
 *       └── synp/
 *           ├── bin/synp
 *           └── node_modules/
 *
 * @returns Path to node-smol's dlx directory.
 */
function getNodeSmolBasePath(): string {
  // Get actual hash from process.smol if available, otherwise use process version.
  let nodeSmolHash = 'node-smol-placeholder'

  try {
    // Try to get hash from process.smol API (if available in future node-smol).
    const processWithSmol = process as unknown as { smol?: { getHash?: () => string } }
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
 * Check if external tools are available in VFS.
 *
 * Returns true if:
 * 1. Running in SEA mode with VFS assets
 *
 * @returns True if external tools are available in VFS.
 */
export function areExternalToolsAvailable(): boolean {
  // Check if running in SEA mode with VFS assets.
  if (isSeaBinary() && getAsset) {
    try {
      // Check if at least sfw is available in VFS.
      getAsset(`${VFS_ASSET_PREFIX}/sfw`)
      return true
    } catch {
      debug('notice', 'SEA mode but VFS assets not available for external tools')
      return false
    }
  }

  // Not in SEA mode - tools will be downloaded via dlx.
  return false
}

/**
 * Check if npm package directory with dependencies exists and is valid.
 *
 * @param packagePath - Path to npm package directory.
 * @returns True if package directory exists with node_modules/ and binary.
 */
async function isNpmPackageExtracted(packagePath: string): Promise<boolean> {
  if (!existsSync(packagePath)) {
    return false
  }

  const packageJsonPath = path.join(packagePath, 'package.json')
  if (!existsSync(packageJsonPath)) {
    return false
  }

  // node_modules/ directory should exist for packages with dependencies.
  const nodeModulesPath = path.join(packagePath, 'node_modules')
  if (!existsSync(nodeModulesPath)) {
    debug('notice', `Package ${packagePath} exists but missing node_modules/`)
    return false
  }

  return true
}

/**
 * Extract a single external tool from VFS to node-smol's dlx directory.
 * Extracts to ~/.socket/_dlx/<node-smol-hash>/node_modules/{packageName}/bin/{binaryName}
 *
 * Current implementation: Extracts only the binary file as a temporary solution.
 *
 * TODO: Full directory tree extraction once binject/node-smol VFS APIs are available:
 * 1. Check if binject auto-extracted the VFS to node-smol base directory
 * 2. If not, use VFS directory extraction APIs to extract full package trees
 * 3. Preserve file permissions and directory structure
 * 4. Handle symlinks properly (binLinks from Arborist)
 *
 * Workaround: For now, we extract only the binary. Full packages with dependencies
 * will need to be extracted when proper directory VFS APIs are implemented.
 *
 * @param tool - Name of the tool to extract.
 * @returns Path to the extracted tool binary.
 */
async function extractTool(tool: ExternalTool): Promise<string> {
  if (!getAsset) {
    throw new Error('getAsset not available - not in SEA mode')
  }

  const isPlatWin = process.platform === 'win32'
  const nodeSmolBase = getNodeSmolBasePath()
  const npmPath = TOOL_NPM_PATHS[tool]

  // For npm packages, check if already extracted with dependencies.
  if (npmPath) {
    const packageDir = normalizePath(
      path.join(nodeSmolBase, 'node_modules', npmPath.packageName),
    )

    if (await isNpmPackageExtracted(packageDir)) {
      const toolPath = normalizePath(path.join(nodeSmolBase, npmPath.binPath))
      const toolPathWithExt = isPlatWin ? `${toolPath}.exe` : toolPath

      if (existsSync(toolPathWithExt)) {
        debug(
          'notice',
          `Tool ${tool} already extracted with dependencies at ${packageDir}`,
        )
        return toolPathWithExt
      }
    }
  }

  // Extract binary from VFS (works for both npm packages and standalone binaries).
  const assetKey = `${VFS_ASSET_PREFIX}/${tool}`

  try {
    const assetBuffer = getAsset(assetKey)

    // For npm packages, extract to node_modules/ path.
    // For standalone binaries, extract to direct path.
    const toolPath = npmPath
      ? normalizePath(path.join(nodeSmolBase, npmPath.binPath))
      : normalizePath(path.join(nodeSmolBase, tool))

    const toolPathWithExt = isPlatWin ? `${toolPath}.exe` : toolPath

    // Create directory for the binary.
    const toolDir = path.dirname(toolPathWithExt)
    await safeMkdir(toolDir)

    // Write tool binary.
    await fs.writeFile(toolPathWithExt, Buffer.from(assetBuffer))

    // Make executable on Unix.
    if (!isPlatWin) {
      await fs.chmod(toolPathWithExt, 0o755)
    }

    logger.info(`  ✓ Extracted ${tool} binary to ${toolPathWithExt}`)

    // Warn for npm packages extracted without dependencies.
    if (npmPath) {
      logger.warn(
        `  ⚠  ${tool} extracted without dependencies - may not function correctly`,
      )
    }

    return toolPathWithExt
  } catch (e) {
    throw new Error(`Failed to extract ${tool} from VFS: ${e}`)
  }
}

/**
 * Extract external tools from VFS to node-smol's dlx directory.
 *
 * Extracts external tools from the SEA's VFS and writes them to node-smol's shared
 * dlx directory (~/.socket/_dlx/<node-smol-hash>/).
 *
 * Tool extraction paths:
 * - Standalone binaries: ~/.socket/_dlx/<hash>/{tool}
 * - npm packages: ~/.socket/_dlx/<hash>/node_modules/{packageName}/bin/{binaryName}
 *
 * @returns Record of tool names to their extracted paths, or null if extraction failed.
 *
 * @example
 * const toolPaths = await extractExternalTools()
 * if (toolPaths) {
 *   const sfwPath = toolPaths.sfw  // ~/.socket/_dlx/<hash>/sfw
 *   const cdxgenPath = toolPaths.cdxgen  // ~/.socket/_dlx/<hash>/node_modules/@cyclonedx/cdxgen/bin/cdxgen
 * }
 */
export async function extractExternalTools(): Promise<Record<ExternalTool, string> | null> {
  if (!isSeaBinary() || !getAsset) {
    debug('notice', 'Not running in SEA mode - cannot extract VFS tools')
    return null
  }

  logger.info('Extracting external tools from VFS...')

  const nodeSmolBase = getNodeSmolBasePath()
  const isPlatWin = process.platform === 'win32'

  // Create lock file to prevent concurrent extraction (TOCTOU mitigation).
  const lockFile = normalizePath(path.join(nodeSmolBase, '.extracting'))
  const cacheMarker = normalizePath(path.join(nodeSmolBase, '.extracted'))

  await safeMkdir(nodeSmolBase)

  try {
    // Try to create lock file atomically (wx = write + exclusive).
    await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' })
  } catch (e: unknown) {
    const error = e as NodeJS.ErrnoException
    if (error.code === 'EEXIST') {
      // Another process is extracting, wait and check for completion.
      logger.info('Another process is extracting external tools, waiting...')
      for (let i = 0; i < 60; i++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => {
          setTimeout(resolve, 1_000)
        })
        if (existsSync(cacheMarker)) {
          debug('notice', 'External tools extracted by another process')
          // Build toolPaths from cache and return.
          const toolPaths: Partial<Record<ExternalTool, string>> = {}
          for (const tool of EXTERNAL_TOOLS) {
            const npmPath = TOOL_NPM_PATHS[tool]
            const toolPath = npmPath
              ? normalizePath(path.join(nodeSmolBase, npmPath.binPath))
              : normalizePath(path.join(nodeSmolBase, tool))
            const toolPathWithExt = isPlatWin ? `${toolPath}.exe` : toolPath
            toolPaths[tool] = toolPathWithExt
          }
          return toolPaths as Record<ExternalTool, string>
        }
      }
      throw new Error('Timeout waiting for another process to extract external tools')
    }
    throw e
  }

  try {
    // Check if already extracted (cache marker exists).
    if (existsSync(cacheMarker)) {
      debug('notice', 'External tools already extracted (cache marker found)')
      const toolPaths: Partial<Record<ExternalTool, string>> = {}
      for (const tool of EXTERNAL_TOOLS) {
        const npmPath = TOOL_NPM_PATHS[tool]
        const toolPath = npmPath
          ? normalizePath(path.join(nodeSmolBase, npmPath.binPath))
          : normalizePath(path.join(nodeSmolBase, tool))
        const toolPathWithExt = isPlatWin ? `${toolPath}.exe` : toolPath
        toolPaths[tool] = toolPathWithExt
      }
      return toolPaths as Record<ExternalTool, string>
    }

    const toolPaths: Partial<Record<ExternalTool, string>> = {}

    for (const tool of EXTERNAL_TOOLS) {
      const npmPath = TOOL_NPM_PATHS[tool]
      const toolPath = npmPath
        ? normalizePath(path.join(nodeSmolBase, npmPath.binPath))
        : normalizePath(path.join(nodeSmolBase, tool))
      const toolPathWithExt = isPlatWin ? `${toolPath}.exe` : toolPath

      // Check if tool already exists and is executable.
      if (existsSync(toolPathWithExt)) {
        try {
          // Quick validation - check if executable.
          // eslint-disable-next-line no-await-in-loop
          await fs.access(toolPathWithExt, fs.constants.X_OK)
          debug('notice', `Tool ${tool} already extracted at ${toolPathWithExt}`)
          toolPaths[tool] = toolPathWithExt
          continue
        } catch {
          // File exists but not executable or accessible, re-extract.
          debug('notice', `Tool ${tool} exists but not executable, re-extracting...`)
        }
      }

      // Extract tool from VFS.
      // eslint-disable-next-line no-await-in-loop
      const extractedPath = await extractTool(tool)
      toolPaths[tool] = extractedPath
    }

    // Verify all tools were extracted.
    if (Object.keys(toolPaths).length !== EXTERNAL_TOOLS.length) {
      const missingTools = EXTERNAL_TOOLS.filter(t => !toolPaths[t])
      throw new Error(
        `Failed to extract all external tools. Missing: ${missingTools.join(', ')}`,
      )
    }

    // Create cache marker to signal successful extraction.
    await fs.writeFile(cacheMarker, '', 'utf8')

    logger.success('External tools extracted successfully')
    return toolPaths as Record<ExternalTool, string>
  } catch (e) {
    logger.error('VFS extraction failed:', e)
    throw e
  } finally {
    // Clean up lock file.
    try {
      if (existsSync(lockFile)) {
        await fs.unlink(lockFile)
      }
    } catch {
      // Ignore cleanup errors.
    }
  }
}

/**
 * Get paths to extracted external tools in node-smol's dlx directory.
 * npm packages are in node_modules/{packageName}/bin/{binaryName}.
 * Standalone binaries are in the base directory.
 *
 * @returns Object with paths to each tool binary.
 *
 * @example
 * const paths = getToolPaths()
 * logger.log('sfw:', paths.sfw)  // ~/.socket/_dlx/<hash>/sfw
 * logger.log('cdxgen:', paths.cdxgen)  // ~/.socket/_dlx/<hash>/node_modules/@cyclonedx/cdxgen/bin/cdxgen
 */
export function getToolPaths(): Record<ExternalTool, string> {
  const isPlatWin = process.platform === 'win32'
  const nodeSmolBase = getNodeSmolBasePath()

  const paths: Partial<Record<ExternalTool, string>> = {}

  for (const tool of EXTERNAL_TOOLS) {
    const npmPath = TOOL_NPM_PATHS[tool]

    // For npm packages, use node_modules/ path.
    // For standalone binaries, use direct path.
    const toolPath = npmPath
      ? normalizePath(path.join(nodeSmolBase, npmPath.binPath))
      : normalizePath(path.join(nodeSmolBase, tool))

    paths[tool] = isPlatWin ? `${toolPath}.exe` : toolPath
  }

  return paths as Record<ExternalTool, string>
}
