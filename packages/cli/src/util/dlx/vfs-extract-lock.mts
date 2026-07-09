/**
 * Cross-process extraction lock helpers for VFS-extracted external tools.
 *
 * Extracted from vfs-extract.mts to keep that file under the 1000-line
 * File size hard cap. `extractExternalTools()` uses a lock file to make sure
 * only one process extracts the VFS tarball at a time; this module holds the
 * "wait for the other process to finish" loop and the shared cache-validation
 * helpers it (and the caller) both need.
 */

import { existsSync, promises as fs } from 'node:fs'

import { debugNs } from '@socketsecurity/lib-stable/debug/output'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { EXTERNAL_TOOLS, getToolFilePath } from './vfs-extract-config.mts'

import type { ExternalTool } from './vfs-extract-config.mts'

export interface WaitForConcurrentExtractionOptions {
  cacheMarker: string
  isPlatWin: boolean
  lockFile: string
  nodeSmolBase: string
}

/**
 * Build the tool-path map from disk and report whether every tool in
 * `EXTERNAL_TOOLS` currently exists at its expected path.
 */
export function buildAndValidateToolPaths(
  nodeSmolBase: string,
  options: { isPlatWin: boolean },
): { toolPaths: Partial<Record<ExternalTool, string>>; allValid: boolean } {
  const { isPlatWin } = { __proto__: null, ...options } as typeof options
  const toolPaths: Partial<Record<ExternalTool, string>> = {}
  let allValid = true
  for (let i = 0, { length } = EXTERNAL_TOOLS; i < length; i += 1) {
    const tool = EXTERNAL_TOOLS[i]!
    const toolPath = getToolFilePath(tool, nodeSmolBase)
    const toolPathWithExt = isPlatWin ? `${toolPath}.exe` : toolPath
    if (!existsSync(toolPathWithExt)) {
      allValid = false
      break
    }
    toolPaths[tool] = toolPathWithExt
  }
  return { toolPaths, allValid }
}

/**
 * TOCTOU mitigation: re-check every tool path still exists right before
 * handing the map back to a caller.
 */
export function verifyToolPathsStillValid(
  toolPaths: Partial<Record<ExternalTool, string>>,
): boolean {
  return EXTERNAL_TOOLS.every(tool => {
    const p = toolPaths[tool]
    return p && existsSync(p)
  })
}

/**
 * Wait (up to ~60s) for another socket process to finish extracting the VFS
 * tools, polling the cache marker and the lock holder's PID.
 *
 * @returns The validated tool-path map once the other process's extraction is
 *   confirmed complete, or `'retry'` if the caller should re-run extraction
 *   itself (stale/incomplete extraction detected).
 *
 * @throws {Error} If no completion is observed within the wait window.
 */
export async function waitForConcurrentExtraction(
  options: WaitForConcurrentExtractionOptions,
): Promise<Record<ExternalTool, string> | 'retry'> {
  const { cacheMarker, isPlatWin, lockFile, nodeSmolBase } = {
    __proto__: null,
    ...options,
  } as typeof options

  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => {
      setTimeout(resolve, 1000)
    })
    if (existsSync(cacheMarker)) {
      debugNs('notice', 'External tools extracted by another process')
      const { allValid, toolPaths } = buildAndValidateToolPaths(nodeSmolBase, {
        isPlatWin,
      })
      if (allValid) {
        if (verifyToolPathsStillValid(toolPaths)) {
          return toolPaths as Record<ExternalTool, string>
        }
        debugNs('notice', 'Tool(s) disappeared during validation')
      }
      // Extraction incomplete, clean up and retry.
      debugNs('notice', 'Incomplete extraction detected, cleaning up…')
      await safeDelete([cacheMarker, lockFile], { force: true })
      return 'retry'
    }

    // Check if lock process is still alive every 5 iterations.
    if (i % 5 === 4) {
      // Check if extraction completed first before PID validation.
      if (existsSync(cacheMarker)) {
        debugNs('notice', 'Extraction completed during wait')
        return 'retry'
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
            debugNs('notice', `Lock holder (PID ${pid}) died during wait`)
            await safeDelete(lockFile, { force: true })
            return 'retry'
          }
        }
      } catch {
        // Lock file gone, retry.
        return 'retry'
      }
    }
  }

  // Final check before throwing timeout - extraction may have completed just now.
  if (existsSync(cacheMarker)) {
    debugNs('notice', 'External tools extracted just before timeout')
    const { allValid, toolPaths } = buildAndValidateToolPaths(nodeSmolBase, {
      isPlatWin,
    })
    if (allValid && verifyToolPathsStillValid(toolPaths)) {
      return toolPaths as Record<ExternalTool, string>
    }
  }

  throw new Error(
    `timed out waiting for another socket process to finish extracting external tools from the SEA VFS; if no other socket process is running, clear stale lock state under the node-smol base dir and retry`,
  )
}
