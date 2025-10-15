/**
 * @fileoverview Patch validation and compatibility checking
 *
 * Validates patches before applying to prevent build failures.
 */

import { readFile } from 'node:fs/promises'

/**
 * Parse patch metadata from header comments.
 */
export function parsePatchMetadata(patchContent) {
  const lines = patchContent.split('\n')
  const metadata = {
    description: null,
    nodeVersions: [],
    requires: [],
    conflicts: [],
  }

  for (const line of lines) {
    if (!line.startsWith('#')) {
      break
    } // Stop at first non-comment

    // Parse metadata directives.
    if (line.includes('@node-versions:')) {
      const versions = line
        .split(':')[1]
        .trim()
        .split(/[,\s]+/)
      metadata.nodeVersions.push(...versions)
    }
    if (line.includes('@requires:')) {
      const required = line.split(':')[1].trim()
      metadata.requires.push(required)
    }
    if (line.includes('@conflicts:')) {
      const conflicted = line.split(':')[1].trim()
      metadata.conflicts.push(conflicted)
    }
    if (line.includes('@description:')) {
      metadata.description = line.split(':')[1].trim()
    }
  }

  return metadata
}

/**
 * Check if patch is compatible with Node version.
 */
export function isPatchCompatible(metadata, nodeVersion) {
  if (metadata.nodeVersions.length === 0) {
    // No version restriction = compatible with all.
    return { compatible: true, reason: null }
  }

  // Check version ranges.
  for (const versionSpec of metadata.nodeVersions) {
    if (versionSpec.includes('+')) {
      // v24.10.0+ means v24.10.0 and later.
      const baseVersion = versionSpec.replace('+', '')
      if (compareVersions(nodeVersion, baseVersion) >= 0) {
        return { compatible: true, reason: null }
      }
    } else if (versionSpec.includes('-')) {
      // v24.9.0-v24.9.5 means range.
      const [min, max] = versionSpec.split('-')
      if (
        compareVersions(nodeVersion, min) >= 0 &&
        compareVersions(nodeVersion, max) <= 0
      ) {
        return { compatible: true, reason: null }
      }
    } else {
      // Exact version.
      if (nodeVersion === versionSpec) {
        return { compatible: true, reason: null }
      }
    }
  }

  return {
    compatible: false,
    reason: `Patch supports ${metadata.nodeVersions.join(', ')} but you're using ${nodeVersion}`,
  }
}

/**
 * Compare Node.js versions.
 */
function compareVersions(v1, v2) {
  const parts1 = v1.replace('v', '').split('.').map(Number)
  const parts2 = v2.replace('v', '').split('.').map(Number)

  for (let i = 0; i < 3; i++) {
    if (parts1[i] > parts2[i]) {
      return 1
    }
    if (parts1[i] < parts2[i]) {
      return -1
    }
  }
  return 0
}

/**
 * Validate patch file before applying.
 */
export async function validatePatch(patchPath, nodeVersion) {
  try {
    const content = await readFile(patchPath, 'utf8')

    // Parse metadata.
    const metadata = parsePatchMetadata(content)

    // Check version compatibility.
    const compatibility = isPatchCompatible(metadata, nodeVersion)
    if (!compatibility.compatible) {
      return {
        valid: false,
        reason: compatibility.reason,
        metadata,
      }
    }

    // Check patch is not empty.
    if (!content.includes('diff ') && !content.includes('---')) {
      return {
        valid: false,
        reason: 'Patch file contains no diff content',
        metadata,
      }
    }

    // Check for suspicious patterns.
    const suspiciousPatterns = [
      {
        pattern: /<html>/i,
        reason: 'Patch contains HTML (probably download error)',
      },
      { pattern: /404 not found/i, reason: 'Patch contains 404 error' },
      {
        pattern: /access denied/i,
        reason: 'Patch contains access denied error',
      },
    ]

    for (const { pattern, reason } of suspiciousPatterns) {
      if (pattern.test(content)) {
        return { valid: false, reason, metadata }
      }
    }

    return {
      valid: true,
      metadata,
    }
  } catch (e) {
    return {
      valid: false,
      reason: `Cannot read patch: ${e.message}`,
      metadata: null,
    }
  }
}

/**
 * Analyze what a patch modifies.
 */
export function analyzePatchContent(patchContent) {
  const analysis = {
    modifiesV8Includes: false,
    modifiesSEA: false,
    modifiesFiles: [],
  }

  const lines = patchContent.split('\n')
  let currentFile = null

  for (const line of lines) {
    // Track which files are modified.
    if (line.startsWith('---') || line.startsWith('+++')) {
      const match = line.match(/[+-]{3}\s+(?:a\/|b\/)?(.+)/)
      if (match) {
        currentFile = match[1]
        if (
          currentFile !== '/dev/null' &&
          !analysis.modifiesFiles.includes(currentFile)
        ) {
          analysis.modifiesFiles.push(currentFile)
        }
      }
    }

    // Check for V8 include modifications.
    if (
      line.includes('#include') &&
      line.includes('base/') &&
      currentFile?.includes('deps/v8')
    ) {
      analysis.modifiesV8Includes = true
    }

    // Check for SEA modifications.
    if (line.includes('isSea') && currentFile?.includes('lib/sea.js')) {
      analysis.modifiesSEA = true
    }
  }

  return analysis
}

/**
 * Check for patch conflicts.
 */
export function checkPatchConflicts(patches, nodeVersion) {
  const conflicts = []

  // Check for multiple patches modifying same files.
  const fileModifications = new Map()

  for (const patch of patches) {
    for (const file of patch.analysis.modifiesFiles) {
      if (!fileModifications.has(file)) {
        fileModifications.set(file, [])
      }
      fileModifications.get(file).push(patch.name)
    }
  }

  for (const [file, patchNames] of fileModifications) {
    if (patchNames.length > 1) {
      conflicts.push({
        type: 'file',
        file,
        patches: patchNames,
        message: `Multiple patches modify ${file}: ${patchNames.join(', ')}`,
      })
    }
  }

  // Check for V8 include modifications on v24.10.0+.
  if (compareVersions(nodeVersion, 'v24.10.0') >= 0) {
    const v8Patches = patches.filter(p => p.analysis.modifiesV8Includes)
    if (v8Patches.length > 0) {
      conflicts.push({
        type: 'version',
        patches: v8Patches.map(p => p.name),
        message: `Patches modify V8 includes but ${nodeVersion} doesn't need this fix`,
        severity: 'error',
      })
    }
  }

  return conflicts
}

/**
 * Test if a patch will apply cleanly (dry-run).
 */
export async function testPatchApplication(
  patchPath,
  targetDir,
  stripLevel = 1,
) {
  const { spawn } = await import('@socketsecurity/registry/lib/spawn')

  try {
    const result = await spawn(
      'patch',
      [`-p${stripLevel}`, '--dry-run', '--batch', '--forward', '-i', patchPath],
      {
        cwd: targetDir,
        stdio: 'pipe',
      },
    )

    if (result.code === 0) {
      return {
        canApply: true,
        reason: null,
      }
    }

    return {
      canApply: false,
      reason: `Patch dry-run failed with exit code ${result.code}`,
      stderr: result.stderr,
    }
  } catch (e) {
    return {
      canApply: false,
      reason: `Patch dry-run error: ${e.message}`,
    }
  }
}
