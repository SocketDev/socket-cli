/**
 * VFS extraction utilities for external tools bundled in SEA binaries.
 *
 * Extracts external tools from the VFS (Virtual File System) embedded in SEA binaries
 * and caches them for execution.
 *
 * Tool types:
 * - Standalone binaries (GitHub releases): sfw, socket-patch
 * - npm packages (with dependencies): cdxgen, coana, synp
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
 *   socket-patch                      # Standalone Rust binary from GitHub release
 *   node_modules/
 *     ├── @cyclonedx/cdxgen/        # Full package with dependencies
 *     │   ├── bin/cdxgen
 *     │   ├── package.json
 *     │   └── node_modules/         # Dependencies
 *     ├── @coana-tech/cli/
 *     │   ├── bin/coana
 *     │   ├── package.json
 *     │   └── node_modules/
 *     ├── @socketsecurity/sfw-bin/  # Standalone binary from GitHub release
 *     │   └── sfw
 *     └── synp/
 *         ├── bin/synp
 *         ├── package.json
 *         └── node_modules/
 *
 * VFS Extraction with Full Directory Support:
 * Uses process.smol.mount() API from node-smol to extract both single files and
 * complete directory trees with dependencies from the embedded VFS.
 *
 * For npm packages:
 * - Extracts entire package directory (node_modules/@package/name/)
 * - Includes all production dependencies and subdirectories
 * - Preserves file permissions and directory structure
 *
 * For standalone binaries:
 * - Extracts individual binary file from VFS root
 *
 * See socket-btm/docs/vfs-runtime-api.md for full documentation.
 */

import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { debug } from '@socketsecurity/lib/debug'
import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'

import { UPDATE_STORE_DIR } from '../../constants/paths.mts'
import { isSeaBinary } from '../sea/detect.mts'

const logger = getDefaultLogger()

// External tool names bundled in VFS.
// Includes standalone binaries and npm packages that are packaged in the VFS tarball.
export const EXTERNAL_TOOLS = [
  'cdxgen',
  'coana',
  'sfw',
  'socket-patch',
  'synp',
] as const

export type ExternalTool = (typeof EXTERNAL_TOOLS)[number]

// Map of npm package tools to their node_modules/ paths.
// These are full npm packages with dependencies and node_modules/ subdirectories.
// Note: sfw uses GitHub binary for SEA (standalone), npm package for CLI (dlx).
const TOOL_NPM_PATHS: Partial<
  Record<ExternalTool, { packageName: string; binPath: string }>
> = {
  cdxgen: {
    packageName: '@cyclonedx/cdxgen',
    binPath: 'node_modules/@cyclonedx/cdxgen/bin/cdxgen',
  },
  coana: {
    packageName: '@coana-tech/cli',
    binPath: 'node_modules/@coana-tech/cli/bin/coana',
  },
  synp: {
    packageName: 'synp',
    binPath: 'node_modules/synp/bin/synp',
  },
}

// Map of standalone binary tools to their VFS paths.
// These tools are single binaries from GitHub releases without npm dependencies.
// sfw is stored under node_modules/@socketsecurity/sfw-bin/ for VFS structure.
const TOOL_STANDALONE_PATHS: Partial<Record<ExternalTool, string>> = {
  // sfw is a standalone binary from GitHub releases (SocketDev/sfw-free).
  // Note: npm CLI uses the sfw npm package via dlx instead.
  sfw: 'node_modules/@socketsecurity/sfw-bin/sfw',
  // socket-patch is a Rust binary downloaded from GitHub releases.
  // As of v2.0.0, it's bundled directly (not as an npm package).
  'socket-patch': 'socket-patch',
}

/**
 * Get the file system path for a tool based on its type (npm package or standalone binary).
 *
 * @param tool - Tool name.
 * @param nodeSmolBase - Base dlx directory path.
 * @returns Path to the tool binary (without .exe extension).
 */
function getToolFilePath(tool: ExternalTool, nodeSmolBase: string): string {
  const npmPath = TOOL_NPM_PATHS[tool]
  const standalonePath = TOOL_STANDALONE_PATHS[tool]

  // For npm packages, use node_modules/ path with binPath.
  // For standalone binaries under node_modules/, use standalonePath.
  // For other standalone binaries, use direct tool name.
  return npmPath
    ? normalizePath(path.join(nodeSmolBase, npmPath.binPath))
    : standalonePath
      ? normalizePath(path.join(nodeSmolBase, standalonePath))
      : normalizePath(path.join(nodeSmolBase, tool))
}

/**
 * Get the base dlx directory path for node-smol.
 * This is where both VFS-extracted tools and npm-installed packages live.
 *
 * Structure:
 * ~/.socket/_dlx/<node-smol-hash>/
 *   ├── node/node                    # Node binary
 *   ├── socket-patch                 # Standalone Rust binary (GitHub release)
 *   └── node_modules/                # npm packages with dependencies
 *       ├── @cyclonedx/cdxgen/
 *       │   ├── bin/cdxgen
 *       │   └── node_modules/
 *       ├── @coana-tech/cli/
 *       │   ├── bin/coana
 *       │   └── node_modules/
 *       ├── @socketsecurity/sfw-bin/ # Standalone sfw binary (GitHub release)
 *       │   └── sfw
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
 * Check if external tools are available in VFS.
 *
 * Returns true if:
 * 1. Running in SEA mode with process.smol.mount available
 *
 * @returns True if external tools are available in VFS.
 */
export function areExternalToolsAvailable(): boolean {
  const processWithSmol = process as unknown as {
    smol?: { mount?: (vfsPath: string) => Promise<string> }
  }

  // Check if running in SEA mode with process.smol.mount available.
  if (isSeaBinary() && processWithSmol.smol?.mount) {
    return true
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
 * Extract a single external tool from VFS to node-smol's dlx directory using process.smol.mount().
 * Extracts to ~/.socket/_dlx/<node-smol-hash>/node_modules/{packageName}/bin/{binaryName}
 *
 * Implementation:
 * - npm packages: Uses process.smol.mount() to extract entire directory with dependencies
 * - Standalone binaries: Uses process.smol.mount() to extract single file
 * - Automatically handles file permissions and directory structure
 * - Supports caching to avoid re-extraction
 *
 * @param tool - Name of the tool to extract.
 * @returns Path to the extracted tool binary.
 */
async function extractTool(tool: ExternalTool): Promise<string> {
  // Check if process.smol.mount is available.
  const processWithSmol = process as unknown as {
    smol?: { mount?: (vfsPath: string) => Promise<string> }
  }

  if (!processWithSmol.smol?.mount) {
    throw new Error(
      'process.smol.mount not available - not in node-smol SEA mode',
    )
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

  // Extract from VFS using process.smol.mount().
  try {
    let extractedPath: string

    if (npmPath) {
      // Extract entire npm package directory with dependencies.
      const vfsPackagePath = `/snapshot/node_modules/${npmPath.packageName}`
      const packageDir = await processWithSmol.smol.mount(vfsPackagePath)

      logger.info(
        `  ✓ Extracted ${tool} package with dependencies to ${packageDir}`,
      )

      // Return path to binary within extracted package.
      const toolPath = normalizePath(path.join(nodeSmolBase, npmPath.binPath))
      extractedPath = isPlatWin ? `${toolPath}.exe` : toolPath
    } else {
      // Extract standalone binary - check if it's under node_modules/ or VFS root.
      const standalonePath = TOOL_STANDALONE_PATHS[tool]
      const vfsBinaryPath = standalonePath
        ? `/snapshot/${standalonePath}`
        : `/snapshot/${tool}`
      const binaryPath = await processWithSmol.smol.mount(vfsBinaryPath)

      logger.info(`  ✓ Extracted ${tool} binary to ${binaryPath}`)

      extractedPath = isPlatWin ? `${binaryPath}.exe` : binaryPath

      // Make executable on Unix.
      if (!isPlatWin && existsSync(extractedPath)) {
        try {
          await fs.chmod(extractedPath, 0o755)
        } catch {
          // Ignore chmod errors - file might already be executable.
        }
      }
    }

    if (!existsSync(extractedPath)) {
      throw new Error(`Extracted tool not found at ${extractedPath}`)
    }

    return extractedPath
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
// Maximum recursion depth for extraction retries.
const MAX_EXTRACTION_DEPTH = 5

export async function extractExternalTools(
  depth = 0,
): Promise<Record<ExternalTool, string> | null> {
  // Prevent unbounded recursion from pathological scenarios.
  if (depth >= MAX_EXTRACTION_DEPTH) {
    logger.error(
      `Max extraction retry limit (${MAX_EXTRACTION_DEPTH}) exceeded`,
    )
    return null
  }

  const processWithSmol = process as unknown as {
    smol?: { mount?: (vfsPath: string) => Promise<string> }
  }

  if (!isSeaBinary() || !processWithSmol.smol?.mount) {
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
      // Check if lock is stale by reading PID and checking if process exists.
      let isStale = false
      try {
        const lockPid = await fs.readFile(lockFile, 'utf8')
        const pid = Number.parseInt(lockPid.trim(), 10)
        if (!Number.isNaN(pid) && pid > 0) {
          try {
            // Signal 0 checks if process exists without killing it.
            process.kill(pid, 0)
            // Process exists, lock is valid.
          } catch {
            // Process doesn't exist, lock is stale.
            isStale = true
            debug('notice', `Stale lock file detected (PID ${pid} not running)`)
          }
        } else {
          // Invalid PID in lock file, treat as stale.
          isStale = true
        }
      } catch {
        // Can't read lock file, treat as stale.
        isStale = true
      }

      if (isStale) {
        // Clean up stale lock and partial extraction.
        logger.warn('Cleaning up stale extraction lock...')
        try {
          await fs.unlink(lockFile)
        } catch {
          // Ignore cleanup errors.
        }
        // Retry extraction by calling ourselves recursively.
        return await extractExternalTools(depth + 1)
      }

      // Another process is extracting, wait and check for completion.
      logger.info('Another process is extracting external tools, waiting...')
      for (let i = 0; i < 60; i++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => {
          setTimeout(resolve, 1_000)
        })
        if (existsSync(cacheMarker)) {
          debug('notice', 'External tools extracted by another process')
          // Build and validate toolPaths from cache.
          const toolPaths: Partial<Record<ExternalTool, string>> = {}
          let allValid = true
          for (const tool of EXTERNAL_TOOLS) {
            const toolPath = getToolFilePath(tool, nodeSmolBase)
            const toolPathWithExt = isPlatWin ? `${toolPath}.exe` : toolPath
            // Validate tool exists and is executable.
            if (!existsSync(toolPathWithExt)) {
              allValid = false
              debug(
                'notice',
                `Tool ${tool} missing after extraction by other process`,
              )
              break
            }
            toolPaths[tool] = toolPathWithExt
          }
          if (allValid) {
            // TOCTOU mitigation: Final atomic verification pass.
            const stillValid = EXTERNAL_TOOLS.every(tool => {
              const p = toolPaths[tool]
              return p && existsSync(p)
            })
            if (stillValid) {
              return toolPaths as Record<ExternalTool, string>
            }
            debug('notice', 'Tool(s) disappeared during validation')
            allValid = false
          }
          // Extraction incomplete, clean up and retry.
          debug('notice', 'Incomplete extraction detected, cleaning up...')
          try {
            await fs.unlink(cacheMarker)
            await fs.unlink(lockFile)
          } catch {
            // Ignore cleanup errors.
          }
          return await extractExternalTools(depth + 1)
        }

        // Check if lock process is still alive every 5 iterations.
        if (i % 5 === 4) {
          // Check if extraction completed first before PID validation.
          if (existsSync(cacheMarker)) {
            debug('notice', 'Extraction completed during wait')
            return await extractExternalTools(depth + 1)
          }
          // Then check if lock holder is still alive.
          try {
            const lockPid = await fs.readFile(lockFile, 'utf8')
            const pid = Number.parseInt(lockPid.trim(), 10)
            if (!Number.isNaN(pid) && pid > 0) {
              try {
                process.kill(pid, 0)
              } catch {
                // Process died, lock is stale.
                debug('notice', `Lock holder (PID ${pid}) died during wait`)
                try {
                  await fs.unlink(lockFile)
                } catch {
                  // Ignore.
                }
                return await extractExternalTools(depth + 1)
              }
            }
          } catch {
            // Lock file gone, retry.
            return await extractExternalTools(depth + 1)
          }
        }
      }
      // Final check before throwing timeout - extraction may have completed just now.
      if (existsSync(cacheMarker)) {
        debug('notice', 'External tools extracted just before timeout')
        const toolPaths: Partial<Record<ExternalTool, string>> = {}
        let allValid = true
        for (const tool of EXTERNAL_TOOLS) {
          const toolPath = getToolFilePath(tool, nodeSmolBase)
          const toolPathWithExt = isPlatWin ? `${toolPath}.exe` : toolPath
          if (!existsSync(toolPathWithExt)) {
            allValid = false
            break
          }
          toolPaths[tool] = toolPathWithExt
        }
        if (allValid) {
          // TOCTOU mitigation: Final atomic verification pass.
          const stillValid = EXTERNAL_TOOLS.every(tool => {
            const p = toolPaths[tool]
            return p && existsSync(p)
          })
          if (stillValid) {
            return toolPaths as Record<ExternalTool, string>
          }
        }
      }
      throw new Error(
        'Timeout waiting for another process to extract external tools',
      )
    }
    throw e
  }

  try {
    // Check if already extracted (cache marker exists).
    if (existsSync(cacheMarker)) {
      debug('notice', 'External tools already extracted (cache marker found)')
      const toolPaths: Partial<Record<ExternalTool, string>> = {}
      let allValid = true
      for (const tool of EXTERNAL_TOOLS) {
        const toolPath = getToolFilePath(tool, nodeSmolBase)
        const toolPathWithExt = isPlatWin ? `${toolPath}.exe` : toolPath
        // Validate tool exists before adding to paths.
        if (!existsSync(toolPathWithExt)) {
          debug('notice', `Cached tool ${tool} missing at ${toolPathWithExt}`)
          allValid = false
          break
        }
        toolPaths[tool] = toolPathWithExt
      }
      if (allValid) {
        // TOCTOU mitigation: Final atomic verification pass.
        // Re-check all tools still exist right before returning to minimize race window.
        const stillValid = EXTERNAL_TOOLS.every(tool => {
          const p = toolPaths[tool]
          return p && existsSync(p)
        })
        if (stillValid) {
          return toolPaths as Record<ExternalTool, string>
        }
        // Tools disappeared during validation - cleanup and retry extraction.
        debug(
          'notice',
          'Tool(s) disappeared during validation, re-extracting...',
        )
        try {
          await fs.unlink(cacheMarker)
        } catch {
          // Ignore cleanup errors.
        }
        return await extractExternalTools(depth + 1)
      }
      // Cache marker exists but tools missing, remove marker and re-extract.
      debug('notice', 'Cache validation failed, re-extracting...')
      try {
        await fs.unlink(cacheMarker)
      } catch {
        // Ignore cleanup errors.
      }
    }

    const toolPaths: Partial<Record<ExternalTool, string>> = {}

    for (const tool of EXTERNAL_TOOLS) {
      const toolPath = getToolFilePath(tool, nodeSmolBase)
      const toolPathWithExt = isPlatWin ? `${toolPath}.exe` : toolPath

      // Check if tool already exists and is executable.
      if (existsSync(toolPathWithExt)) {
        try {
          // Quick validation - check if executable.
          // eslint-disable-next-line no-await-in-loop
          await fs.access(toolPathWithExt, fs.constants.X_OK)
          debug(
            'notice',
            `Tool ${tool} already extracted at ${toolPathWithExt}`,
          )
          toolPaths[tool] = toolPathWithExt
          continue
        } catch {
          // File exists but not executable or accessible, re-extract.
          debug(
            'notice',
            `Tool ${tool} exists but not executable, re-extracting...`,
          )
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
      await fs.unlink(lockFile)
    } catch (e) {
      // Only ignore ENOENT (file doesn't exist), log other errors.
      const error = e as NodeJS.ErrnoException
      if (error.code !== 'ENOENT') {
        logger.warn(`Failed to cleanup lock file ${lockFile}: ${error.message}`)
      }
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
 * logger.log('sfw:', paths.sfw)  // ~/.socket/_dlx/<hash>/node_modules/@socketsecurity/sfw-bin/sfw
 * logger.log('cdxgen:', paths.cdxgen)  // ~/.socket/_dlx/<hash>/node_modules/@cyclonedx/cdxgen/bin/cdxgen
 */
export function getToolPaths(): Record<ExternalTool, string> {
  const isPlatWin = process.platform === 'win32'
  const nodeSmolBase = getNodeSmolBasePath()

  const paths: Partial<Record<ExternalTool, string>> = {}

  for (const tool of EXTERNAL_TOOLS) {
    const toolPath = getToolFilePath(tool, nodeSmolBase)
    paths[tool] = isPlatWin ? `${toolPath}.exe` : toolPath
  }

  return paths as Record<ExternalTool, string>
}
