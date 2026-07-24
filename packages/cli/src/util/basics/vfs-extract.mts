/**
 * VFS extraction utilities for socket-basics tools bundled in SEA binaries.
 *
 * Extracts Python, Trivy, TruffleHog, and OpenGrep from the VFS (Virtual File
 * System) embedded in SEA binaries and caches them for socket-basics
 * execution.
 *
 * Extraction paths (all under ~/.socket/_dlx/<hash>/):
 *
 * - Python/ # Python runtime
 * - Python/lib/python3.11/site-packages/ # Python packages (socketsecurity)
 * - Trivy # Standalone binary
 * - Trufflehog # Standalone binary
 * - Opengrep # Standalone binary
 */

import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { UPDATE_STORE_DIR } from '../../constants/paths.mts'
import { isSeaBinary } from '../sea/detect.mts'

const logger = getDefaultLogger()

// Basics tool names bundled in VFS.
const BASICS_TOOLS = ['opengrep', 'python', 'trivy', 'trufflehog'] as const

// VFS paths for basics tools (relative to /snapshot/).
// These are mounted from the VFS filesystem embedded in the SEA binary.
const BASICS_TOOL_VFS_PATHS: Record<(typeof BASICS_TOOLS)[number], string> = {
  opengrep: 'opengrep',
  python: 'python',
  trivy: 'trivy',
  trufflehog: 'trufflehog',
}

/**
 * Check if basics tools are available for socket-basics.
 *
 * Returns true if: 1. Running in SEA mode with process.smol.mount available.
 *
 * @returns True if basics tools are available for socket-basics.
 */
export function areBasicsToolsAvailable(): boolean {
  const processWithSmol = process as unknown as {
    smol?:
      | { mount?: ((vfsPath: string) => Promise<string>) | undefined }
      | undefined
  }

  // Check if running in SEA mode with process.smol.mount available.
  if (isSeaBinary() && processWithSmol.smol?.mount) {
    return true
  }

  // Not in SEA mode - tools not available.
  return false
}

/**
 * Extract basics tools from VFS using process.smol.mount().
 *
 * Extracts Python, Trivy, TruffleHog, and OpenGrep binaries from the SEA's VFS.
 * process.smol.mount() handles caching, locking, and extraction automatically.
 *
 * Extraction is managed by node-smol and tools are cached persistently.
 *
 * @example
 *   const toolsDir = await extractBasicsTools()
 *   if (toolsDir) {
 *     const paths = getBasicsToolPaths(toolsDir)
 *     // Use paths.python, paths.trivy, etc.
 *   }
 *
 * @param _cacheDir - Unused, kept for API compatibility. process.smol.mount()
 *   manages paths.
 *
 * @returns Path to the extracted Python directory, or null if extraction
 *   failed.
 */
export async function extractBasicsTools(
  _cacheDir?: string | undefined,
): Promise<string | undefined> {
  if (!isSeaBinary()) {
    logger.warn('Not running in SEA mode - cannot extract basics tools')
    return undefined
  }

  // Check if process.smol.mount is available.
  const processWithSmol = process as unknown as {
    smol?:
      | { mount?: ((vfsPath: string) => Promise<string>) | undefined }
      | undefined
  }

  if (typeof processWithSmol.smol?.mount !== 'function') {
    logger.warn(
      'process.smol.mount not available - cannot extract basics tools',
    )
    return undefined
  }

  logger.group('Extracting basics tools from VFS…')

  const isPlatWin = process.platform === 'win32'
  const tools = BASICS_TOOLS
  const extractedPaths: Record<string, string> = {}

  try {
    // Extract all tools using async process.smol.mount().
    // mount() manages caching, locking, and extraction automatically.
    // Async mount() is non-blocking for large extractions (Python with 3000+ files).
    for (let i = 0, { length } = tools; i < length; i += 1) {
      const tool = tools[i]!
      const vfsRelativePath = BASICS_TOOL_VFS_PATHS[tool]
      const vfsPath = `/snapshot/${vfsRelativePath}`

      const mountedPath = await processWithSmol.smol.mount(vfsPath)

      logger.success(tool)
      extractedPaths[tool] = mountedPath
    }
    logger.groupEnd()

    // Verify all tools were extracted.
    const missingTools = tools.filter(t => !extractedPaths[t])
    if (missingTools.length) {
      throw new Error(
        `socket-basics VFS extraction returned ${Object.keys(extractedPaths).length}/${tools.length} tools (missing: ${joinAnd(missingTools)}); the SEA bundle is incomplete — rebuild with all basics tools included`,
      )
    }

    // Validate all extracted binaries work after extraction.
    logger.group('Validating extracted basics tools…')

    const pythonExe = isPlatWin ? 'python3.exe' : 'python3'
    // The missing-tools check above already throws when python is absent.
    const pythonDir = extractedPaths['python']!
    const pythonPath = normalizePath(path.join(pythonDir, 'bin', pythonExe))

    const validateResult = await spawn(pythonPath, ['--version'], {
      stdio: 'pipe',
      timeout: 5000,
    })

    if (!validateResult || validateResult.code !== 0) {
      throw new Error(
        `extracted Python at ${pythonPath} failed to run with exit code ${validateResult?.code ?? 'null'} (stderr: ${validateResult?.stderr || '<none>'}); the extracted binary may be corrupt or missing a shared lib — rebuild the SEA binary`,
      )
    }

    const pythonVersion = (validateResult.stdout || '').trim()
    logger.success(`Python: ${pythonVersion}`)

    // Validate other security tools.
    const toolsToValidate = ['trivy', 'trufflehog', 'opengrep'] as const
    for (let i = 0, { length } = toolsToValidate; i < length; i += 1) {
      const tool = toolsToValidate[i]!
      const toolPath = extractedPaths[tool]
      /* c8 ignore start - defensive: extraction populates all toolsToValidate keys before this loop */
      if (!toolPath) {
        continue
      }
      /* c8 ignore stop */

      const toolValidateResult = await spawn(toolPath, ['--version'], {
        stdio: 'pipe',
        timeout: 5000,
      })

      if (!toolValidateResult || toolValidateResult.code !== 0) {
        throw new Error(
          `extracted ${tool} at ${toolPath} failed to run with exit code ${toolValidateResult?.code ?? 'null'} (stderr: ${toolValidateResult?.stderr || '<none>'}); the extracted binary may be corrupt or missing a shared lib — rebuild the SEA binary`,
        )
      }

      const toolVersion = (toolValidateResult.stdout || '').trim()
      logger.success(`${tool}: ${toolVersion}`)
    }
    logger.groupEnd()

    logger.success('Basics tools extracted and validated')
    // Return the Python directory path for backward compatibility.
    return extractedPaths['python'] ?? undefined
  } catch (e) {
    logger.error('VFS extraction failed')
    throw e
  }
}

/**
 * Get paths to extracted basics tools.
 *
 * Note: toolsDir is expected to be the Python directory path returned by
 * extractBasicsTools(). For standalone binaries (trivy, trufflehog, opengrep),
 * this function constructs paths based on the Python directory's parent
 * structure.
 *
 * @example
 *   const toolsDir = await extractBasicsTools()
 *   if (toolsDir) {
 *     const paths = getBasicsToolPaths(toolsDir)
 *     logger.log('Python:', paths.python)
 *     logger.log('Trivy:', paths.trivy)
 *   }
 *
 * @param toolsDir - Python directory path from extractBasicsTools().
 *
 * @returns Object with paths to each tool binary.
 */
export function getBasicsToolPaths(toolsDir: string): {
  opengrep: string
  python: string
  trivy: string
  trufflehog: string
} {
  const isPlatWin = process.platform === 'win32'
  const pythonExe = isPlatWin ? 'python3.exe' : 'python3'

  // toolsDir is the Python directory from process.smol.mount().
  // Standalone binaries are extracted to sibling directories by process.smol.mount().
  const baseDlxDir = path.dirname(toolsDir)

  return {
    opengrep: normalizePath(
      path.join(
        baseDlxDir,
        'opengrep',
        isPlatWin ? 'opengrep.exe' : 'opengrep',
      ),
    ),
    python: normalizePath(path.join(toolsDir, 'bin', pythonExe)),
    trivy: normalizePath(
      path.join(baseDlxDir, 'trivy', isPlatWin ? 'trivy.exe' : 'trivy'),
    ),
    trufflehog: normalizePath(
      path.join(
        baseDlxDir,
        'trufflehog',
        isPlatWin ? 'trufflehog.exe' : 'trufflehog',
      ),
    ),
  }
}

/**
 * Get the base dlx directory path for node-smol. This is the shared extraction
 * directory: ~/.socket/_dlx/<node-smol-hash>/
 *
 * @returns Path to node-smol's dlx directory.
 */
export function getNodeSmolBasePath(): string {
  let nodeSmolHash = 'node-smol-placeholder'

  try {
    // Try to get hash from process.smol API (if available in future node-smol).
    const processWithSmol = process as unknown as {
      smol?: { getHash?: (() => string) | undefined } | undefined
    }
    if (typeof processWithSmol.smol?.getHash === 'function') {
      nodeSmolHash = processWithSmol.smol.getHash()
    } else {
      // Fallback: hash based on Node.js version and platform.
      const hashInput = `${process.version}-${process.platform}-${process.arch}`
      const hash = crypto.createHash('sha256').update(hashInput).digest('hex')
      nodeSmolHash = hash.slice(0, 16)
    }
  } catch {
    // Fallback to versioned hash.
    const hashInput = `${process.version}-${process.platform}-${process.arch}`
    const hash = crypto.createHash('sha256').update(hashInput).digest('hex')
    nodeSmolHash = hash.slice(0, 16)
  }

  return normalizePath(path.join(os.homedir(), UPDATE_STORE_DIR, nodeSmolHash))
}
