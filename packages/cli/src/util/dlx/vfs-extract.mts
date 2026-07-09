/**
 * VFS extraction utilities for external tools bundled in SEA binaries.
 *
 * Extracts external tools from the VFS (Virtual File System) embedded in SEA
 * binaries and caches them for execution.
 *
 * Tool types:
 *
 * - Standalone binaries (GitHub releases): sfw, socket-patch
 * - Npm packages (with dependencies): cdxgen, coana, synp
 *
 * Build-time package preparation: npm packages use @npmcli/arborist to download
 * complete packages with node_modules/ and all production dependencies. See
 * scripts/sea-build-utils/npm-packages.mts:
 *
 * ```javascript
 * import { Arborist } from '@npmcli/arborist'
 *
 * const arb = new Arborist({
 *   audit: false,
 *   binLinks: true,
 *   cache: getSocketCacacheDir(), // ~/.socket/_cacache
 *   fund: false,
 *   ignoreScripts: true, // Security: no install scripts
 *   omit: ['dev'], // Production deps only
 *   path: packageDir,
 *   silent: true,
 * })
 * await arb.reify({ add: [packageSpec], save: false })
 * ```
 *
 * VFS structure in SEA binaries: socket-patch # Standalone Rust binary from
 * GitHub release node_modules/ ├── @cyclonedx/cdxgen/ # Full package with
 * dependencies │ ├── bin/cdxgen │ ├── package.json │ └── node_modules/ #
 * Dependencies ├── @coana-tech/cli/ │ ├── bin/coana │ ├── package.json │ └──
 * node_modules/ ├── @socketsecurity/sfw-bin/ # Standalone binary from GitHub
 * release │ └── sfw └── synp/ ├── bin/synp ├── package.json └── node_modules/
 *
 * VFS Extraction with Full Directory Support: Uses process.smol.mount() API
 * from node-smol to extract both single files and complete directory trees with
 * dependencies from the embedded VFS.
 *
 * For npm packages:
 *
 * - Extracts entire package directory (node_modules/@package/name/)
 * - Includes all production dependencies and subdirectories
 * - Preserves file permissions and directory structure
 *
 * For standalone binaries:
 *
 * - Extracts individual binary file from VFS root
 *
 * See socket-btm/docs/vfs-runtime-api.md for full documentation.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'
import { debugNs } from '@socketsecurity/lib-stable/debug/output'
import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { getErrorCause } from '../error/errors.mts'
import { isSeaBinary } from '../sea/detect.mts'
import {
  EXTERNAL_TOOLS,
  getNodeSmolBasePath,
  getToolFilePath,
  isNpmPackageExtracted,
  TOOL_NPM_PATHS,
  TOOL_STANDALONE_PATHS,
} from './vfs-extract-config.mts'
import {
  buildAndValidateToolPaths,
  verifyToolPathsStillValid,
  waitForConcurrentExtraction,
} from './vfs-extract-lock.mts'

import type { ExternalTool } from './vfs-extract-config.mts'

const logger = getDefaultLogger()

// Tool-registry + path helpers extracted to keep this file under the
// 1000-line File-size cap. See vfs-extract-config.mts.
export {
  EXTERNAL_TOOLS,
  getNodeSmolBasePath,
  getToolFilePath,
  getToolPaths,
  isNpmPackageExtracted,
  type ExternalTool,
} from './vfs-extract-config.mts'

/**
 * Extract external tools from VFS to node-smol's dlx directory.
 *
 * Extracts external tools from the SEA's VFS and writes them to node-smol's
 * shared dlx directory (~/.socket/_dlx/<node-smol-hash>/).
 *
 * Tool extraction paths:
 *
 * - Standalone binaries: ~/.socket/_dlx/<hash>/{tool}
 * - Npm packages:
 *   ~/.socket/_dlx/<hash>/node_modules/{packageName}/bin/{binaryName}
 *
 * @example
 *   const toolPaths = await extractExternalTools()
 *   if (toolPaths) {
 *     const sfwPath = toolPaths.sfw // ~/.socket/_dlx/<hash>/sfw
 *     const cdxgenPath = toolPaths.cdxgen // ~/.socket/_dlx/<hash>/node_modules/@cyclonedx/cdxgen/bin/cdxgen
 *   }
 *
 * @returns Record of tool names to their extracted paths, or null if extraction
 *   failed.
 */
// Maximum recursion depth for extraction retries.
const MAX_EXTRACTION_DEPTH = 5

/**
 * Check if external tools are available in VFS.
 *
 * Returns true if: 1. Running in SEA mode with process.smol.mount available.
 *
 * @returns True if external tools are available in VFS.
 */
export function areExternalToolsAvailable(): boolean {
  const processWithSmol = process as unknown as {
    smol?:
      | { mount?: ((vfsPath: string) => Promise<string>) | undefined }
      | undefined
  }

  // Check if running in SEA mode with process.smol.mount available.
  if (isSeaBinary() && processWithSmol.smol?.mount) {
    return true
  }

  // Not in SEA mode - tools will be downloaded via dlx.
  return false
}

export async function extractExternalTools(
  depth = 0,
): Promise<Record<ExternalTool, string> | undefined> {
  // Prevent unbounded recursion from pathological scenarios.
  if (depth >= MAX_EXTRACTION_DEPTH) {
    logger.error(
      `Max extraction retry limit (${MAX_EXTRACTION_DEPTH}) exceeded`,
    )
    return undefined
  }

  const processWithSmol = process as unknown as {
    smol?:
      | { mount?: ((vfsPath: string) => Promise<string>) | undefined }
      | undefined
  }

  if (!isSeaBinary() || !processWithSmol.smol?.mount) {
    debugNs('notice', 'Not running in SEA mode - cannot extract VFS tools')
    return undefined
  }

  logger.info('Extracting external tools from VFS…')

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
            debugNs(
              'notice',
              `Stale lock file detected (PID ${pid} not running)`,
            )
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
        logger.warn('Cleaning up stale extraction lock…')
        await safeDelete(lockFile, { force: true })
        // Retry extraction by calling ourselves recursively.
        return await extractExternalTools(depth + 1)
      }

      // Another process is extracting, wait and check for completion.
      logger.info('Another process is extracting external tools, waiting…')
      const waited = await waitForConcurrentExtraction({
        cacheMarker,
        isPlatWin,
        lockFile,
        nodeSmolBase,
      })
      if (waited !== 'retry') {
        return waited
      }
      return await extractExternalTools(depth + 1)
    }
    throw e
  }

  try {
    // Check if already extracted (cache marker exists).
    if (existsSync(cacheMarker)) {
      debugNs('notice', 'External tools already extracted (cache marker found)')
      const { allValid, toolPaths } = buildAndValidateToolPaths(nodeSmolBase, {
        isPlatWin,
      })
      if (allValid) {
        // TOCTOU mitigation: re-check all tools still exist right before
        // returning to minimize the race window.
        if (verifyToolPathsStillValid(toolPaths)) {
          return toolPaths as Record<ExternalTool, string>
        }
        // Tools disappeared during validation - cleanup and retry extraction.
        debugNs(
          'notice',
          'Tool(s) disappeared during validation, re-extracting…',
        )
        await safeDelete(cacheMarker, { force: true })
        return await extractExternalTools(depth + 1)
      }
      // Cache marker exists but tools missing, remove marker and re-extract.
      debugNs('notice', 'Cache validation failed, re-extracting…')
      await safeDelete(cacheMarker, { force: true })
    }

    const toolPaths: Partial<Record<ExternalTool, string>> = {}

    for (let i = 0, { length } = EXTERNAL_TOOLS; i < length; i += 1) {
      const tool = EXTERNAL_TOOLS[i]!
      const toolPath = getToolFilePath(tool, nodeSmolBase)
      const toolPathWithExt = isPlatWin ? `${toolPath}.exe` : toolPath

      // Check if tool already exists and is executable.
      if (existsSync(toolPathWithExt)) {
        try {
          // Quick validation - check if executable.
          // oxlint-disable-next-line socket/prefer-exists-sync -- fs.access(X_OK) checks executable permission, not existence.
          await fs.access(toolPathWithExt, fs.constants.X_OK)
          debugNs(
            'notice',
            `Tool ${tool} already extracted at ${toolPathWithExt}`,
          )
          toolPaths[tool] = toolPathWithExt
          continue
        } catch {
          // File exists but not executable or accessible, re-extract.
          debugNs(
            'notice',
            `Tool ${tool} exists but not executable, re-extracting…`,
          )
        }
      }

      // Extract tool from VFS.
      const extractedPath = await extractTool(tool)
      toolPaths[tool] = extractedPath
    }

    // Verify all tools were extracted.
    /* c8 ignore start -- defensive: the for-loop above unconditionally assigns toolPaths[tool] for every entry unless extractTool throws (which already aborts via the outer catch), so this length-mismatch branch is unreachable from tests. */
    if (Object.keys(toolPaths).length !== EXTERNAL_TOOLS.length) {
      const missingTools = EXTERNAL_TOOLS.filter(t => !toolPaths[t])
      throw new Error(
        `SEA VFS extraction returned ${Object.keys(toolPaths).length}/${EXTERNAL_TOOLS.length} tools (missing: ${joinAnd(missingTools)}); the SEA bundle is incomplete — rebuild with all external tools included`,
      )
    }
    /* c8 ignore stop */

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
      await safeDelete(lockFile, { force: true })
    } catch (e) {
      const error = e as NodeJS.ErrnoException
      logger.warn(`Failed to cleanup lock file ${lockFile}: ${error.message}`)
    }
  }
}

/**
 * Extract a single external tool from VFS to node-smol's dlx directory using
 * process.smol.mount(). Extracts to
 * ~/.socket/_dlx/<node-smol-hash>/node_modules/{packageName}/bin/{binaryName}
 *
 * Implementation:
 *
 * - Npm packages: Uses process.smol.mount() to extract entire directory with
 *   dependencies
 * - Standalone binaries: Uses process.smol.mount() to extract single file
 * - Automatically handles file permissions and directory structure
 * - Supports caching to avoid re-extraction
 *
 * @param tool - Name of the tool to extract.
 *
 * @returns Path to the extracted tool binary.
 */
export async function extractTool(tool: ExternalTool): Promise<string> {
  // Check if process.smol.mount is available.
  const processWithSmol = process as unknown as {
    smol?:
      | { mount?: ((vfsPath: string) => Promise<string>) | undefined }
      | undefined
  }

  if (!processWithSmol.smol?.mount) {
    throw new Error(
      `process.smol.mount is undefined — extractTool("${tool}") requires a node-smol SEA build; this code path should only run inside the SEA. Check isSeaBinary() / areExternalToolsAvailable() upstream`,
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
        debugNs(
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

      logger.success(
        `Extracted ${tool} package with dependencies to ${packageDir}`,
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

      // oxlint-disable-next-line socket/no-status-emoji -- TUI / custom output formatter; emoji is part of the visual contract.
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
      throw new Error(
        `process.smol.mount returned but ${extractedPath} does not exist; the VFS layout for ${tool} may have changed — check the SEA build config and the tool's expected path`,
      )
    }

    return extractedPath
  } catch (e) {
    throw new Error(
      `failed to extract ${tool} from the SEA VFS (${getErrorCause(e)}); the embedded tool archive may be corrupt — rebuild the SEA binary`,
    )
  }
}
