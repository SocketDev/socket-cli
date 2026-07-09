/**
 * Tool registry and path helpers for VFS-extracted external tools.
 *
 * Extracted from vfs-extract.mts to keep that file under the 1000-line
 * File size hard cap. Holds the static tool lists (which tools are npm
 * packages vs standalone binaries) and the pure path-computation helpers
 * that both the extraction logic and its callers need.
 */

import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { debugNs } from '@socketsecurity/lib-stable/debug/output'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { UPDATE_STORE_DIR } from '../../constants/paths.mts'

// External tool names bundled in VFS.
// Includes standalone binaries and npm packages that are packaged in the VFS tarball.
export const EXTERNAL_TOOLS = [
  'cdxgen',
  'coana',
  'opengrep',
  'python',
  'sfw',
  'socket-patch',
  'synp',
  'trivy',
  'trufflehog',
] as const

export type ExternalTool = (typeof EXTERNAL_TOOLS)[number]

// Map of npm package tools to their node_modules/ paths.
// These are full npm packages with dependencies and node_modules/ subdirectories.
// Note: sfw uses GitHub binary for SEA (standalone), npm package for CLI (dlx).
export const TOOL_NPM_PATHS: Partial<
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
export const TOOL_STANDALONE_PATHS: Partial<Record<ExternalTool, string>> = {
  // opengrep is a SAST/code analysis engine from GitHub releases (opengrep/opengrep).
  opengrep: 'opengrep',
  // python is a standalone runtime from GitHub releases (astral-sh/python-build-standalone).
  // Entire python/ directory is extracted, binary is at python/bin/python (Unix) or python/python.exe (Windows).
  python: 'python',
  // sfw is a standalone binary from GitHub releases (SocketDev/sfw-free).
  // Note: npm CLI uses the sfw npm package via dlx instead.
  sfw: 'node_modules/@socketsecurity/sfw-bin/sfw',
  // socket-patch is a Rust binary downloaded from GitHub releases.
  // As of v2.0.0, it's bundled directly (not as an npm package).
  'socket-patch': 'socket-patch',
  // trivy is a container/filesystem vulnerability scanner from GitHub releases (aquasecurity/trivy).
  trivy: 'trivy',
  // trufflehog is a secret/credential detector from GitHub releases (trufflesecurity/trufflehog).
  trufflehog: 'trufflehog',
}

/**
 * Get the base dlx directory path for node-smol. This is where both
 * VFS-extracted tools and npm-installed packages live.
 *
 * Structure: ~/.socket/_dlx/<node-smol-hash>/ ├── node/node # Node binary ├──
 * socket-patch # Standalone Rust binary (GitHub release) └── node_modules/ #
 * npm packages with dependencies ├── @cyclonedx/cdxgen/ │ ├── bin/cdxgen │ └──
 * node_modules/ ├── @coana-tech/cli/ │ ├── bin/coana │ └── node_modules/ ├──
 *
 * @returns Path to node-smol's dlx directory.
 *
 * @socketsecurity/sfw-bin/ # Standalone sfw binary (GitHub release) │ └── sfw
 * └── synp/ ├── bin/synp └── node_modules/
 */
export function getNodeSmolBasePath(): string {
  // Get actual hash from process.smol if available, otherwise use process version.
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

/**
 * Get the file system path for a tool based on its type (npm package or
 * standalone binary).
 *
 * @param tool - Tool name.
 * @param nodeSmolBase - Base dlx directory path.
 *
 * @returns Path to the tool binary (without .exe extension).
 */
export function getToolFilePath(
  tool: ExternalTool,
  nodeSmolBase: string,
): string {
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
 * Get paths to extracted external tools in node-smol's dlx directory. npm
 * packages are in node_modules/{packageName}/bin/{binaryName}. Standalone
 * binaries are in the base directory.
 *
 * @example
 *   const paths = getToolPaths()
 *   logger.log('sfw:', paths.sfw) // ~/.socket/_dlx/<hash>/node_modules/@socketsecurity/sfw-bin/sfw
 *   logger.log('cdxgen:', paths.cdxgen) // ~/.socket/_dlx/<hash>/node_modules/@cyclonedx/cdxgen/bin/cdxgen
 *
 * @returns Object with paths to each tool binary.
 */
export function getToolPaths(): Record<ExternalTool, string> {
  const isPlatWin = process.platform === 'win32'
  const nodeSmolBase = getNodeSmolBasePath()

  const paths: Partial<Record<ExternalTool, string>> = {}

  for (let i = 0, { length } = EXTERNAL_TOOLS; i < length; i += 1) {
    const tool = EXTERNAL_TOOLS[i]!
    const toolPath = getToolFilePath(tool, nodeSmolBase)
    paths[tool] = isPlatWin ? `${toolPath}.exe` : toolPath
  }

  return paths as Record<ExternalTool, string>
}

/**
 * Check if npm package directory with dependencies exists and is valid.
 *
 * @param packagePath - Path to npm package directory.
 *
 * @returns True if package directory exists with node_modules/ and binary.
 */
export async function isNpmPackageExtracted(
  packagePath: string,
): Promise<boolean> {
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
    debugNs('notice', `Package ${packagePath} exists but missing node_modules/`)
    return false
  }

  return true
}
