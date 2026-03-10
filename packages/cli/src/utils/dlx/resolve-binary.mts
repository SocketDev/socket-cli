/**
 * Binary path resolution utilities for external tools.
 * Determines whether to use local path overrides, download from npm, or GitHub releases.
 */

import os from 'node:os'

import { getCdxgenVersion } from '../../env/cdxgen-version.mts'
import { getCoanaVersion } from '../../env/coana-version.mts'
import { SOCKET_CLI_CDXGEN_LOCAL_PATH } from '../../env/socket-cli-cdxgen-local-path.mts'
import { SOCKET_CLI_COANA_LOCAL_PATH } from '../../env/socket-cli-coana-local-path.mts'
import { SOCKET_CLI_PYCLI_LOCAL_PATH } from '../../env/socket-cli-pycli-local-path.mts'
import { SOCKET_CLI_SFW_LOCAL_PATH } from '../../env/socket-cli-sfw-local-path.mts'
import { SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH } from '../../env/socket-cli-socket-patch-local-path.mts'
import { getSwfVersion } from '../../env/sfw-version.mts'
import { getSocketPatchVersion } from '../../env/socket-patch-version.mts'
import { getSynpVersion } from '../../env/synp-version.mts'

import type { DlxPackageSpec } from './spawn.mjs'

/**
 * GitHub release binary specification.
 */
export type GitHubReleaseSpec = {
  assetName: string
  binaryName: string
  owner: string
  repo: string
  version: string
}

/**
 * Result of binary resolution.
 * - local: Use a local path override (environment variable).
 * - dlx: Download from npm registry via dlx.
 * - github-release: Download from GitHub releases.
 */
export type BinaryResolution =
  | { type: 'local'; path: string }
  | { type: 'dlx'; details: DlxPackageSpec }
  | { type: 'github-release'; details: GitHubReleaseSpec }

/**
 * Resolve path for Coana CLI binary.
 * Checks SOCKET_CLI_COANA_LOCAL_PATH environment variable first.
 */
export function resolveCoana(): BinaryResolution {
  if (SOCKET_CLI_COANA_LOCAL_PATH) {
    return { type: 'local', path: SOCKET_CLI_COANA_LOCAL_PATH }
  }

  return {
    type: 'dlx',
    details: {
      name: '@coana-tech/cli',
      version: getCoanaVersion(),
      binaryName: 'coana',
    },
  }
}

/**
 * Resolve path for cdxgen binary.
 * Checks SOCKET_CLI_CDXGEN_LOCAL_PATH environment variable first.
 */
export function resolveCdxgen(): BinaryResolution {
  if (SOCKET_CLI_CDXGEN_LOCAL_PATH) {
    return { type: 'local', path: SOCKET_CLI_CDXGEN_LOCAL_PATH }
  }

  return {
    type: 'dlx',
    details: {
      name: '@cyclonedx/cdxgen',
      version: getCdxgenVersion(),
      binaryName: 'cdxgen',
    },
  }
}

/**
 * Resolve path for Python CLI binary.
 * Checks SOCKET_CLI_PYCLI_LOCAL_PATH environment variable first.
 */
export function resolvePyCli(): BinaryResolution | { type: 'python' } {
  if (SOCKET_CLI_PYCLI_LOCAL_PATH) {
    return { type: 'local', path: SOCKET_CLI_PYCLI_LOCAL_PATH }
  }

  // Python CLI uses managed Python + pip install, not dlx.
  return { type: 'python' }
}

/**
 * Resolve path for Socket Firewall (sfw) binary.
 * Checks SOCKET_CLI_SFW_LOCAL_PATH environment variable first.
 */
export function resolveSfw(): BinaryResolution {
  if (SOCKET_CLI_SFW_LOCAL_PATH) {
    return { type: 'local', path: SOCKET_CLI_SFW_LOCAL_PATH }
  }

  return {
    type: 'dlx',
    details: {
      name: 'sfw',
      version: getSwfVersion(),
      binaryName: 'sfw',
    },
  }
}

/**
 * Platform-specific asset names for socket-patch GitHub releases.
 * Maps Node.js platform/arch to GitHub release asset names.
 *
 * Socket-Patch v2.0.0+ Platform Coverage:
 * - darwin-arm64: socket-patch-aarch64-apple-darwin.tar.gz
 * - darwin-x64: socket-patch-x86_64-apple-darwin.tar.gz
 * - linux-arm64: socket-patch-aarch64-unknown-linux-gnu.tar.gz
 * - linux-x64: socket-patch-x86_64-unknown-linux-musl.tar.gz (musl works on glibc)
 * - win32-arm64: socket-patch-aarch64-pc-windows-msvc.zip
 * - win32-x64: socket-patch-x86_64-pc-windows-msvc.zip
 */
const SOCKET_PATCH_ASSETS: Record<string, string> = {
  __proto__: null as unknown as string,
  'darwin-arm64': 'socket-patch-aarch64-apple-darwin.tar.gz',
  'darwin-x64': 'socket-patch-x86_64-apple-darwin.tar.gz',
  'linux-arm64': 'socket-patch-aarch64-unknown-linux-gnu.tar.gz',
  // FALLBACK: musl build works on glibc systems (statically linked).
  'linux-x64': 'socket-patch-x86_64-unknown-linux-musl.tar.gz',
  'win32-arm64': 'socket-patch-aarch64-pc-windows-msvc.zip',
  'win32-x64': 'socket-patch-x86_64-pc-windows-msvc.zip',
}

/**
 * Resolve path for Socket Patch binary.
 * Checks SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH environment variable first.
 *
 * Note: As of v2.0.0, socket-patch is a Rust binary downloaded from GitHub releases,
 * not an npm package. Uses platform-specific asset names from SOCKET_PATCH_ASSETS.
 */
export function resolveSocketPatch(): BinaryResolution {
  if (SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH) {
    return { type: 'local', path: SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH }
  }

  const platform = os.platform()
  const arch = os.arch()
  const platformKey = `${platform}-${arch}`
  const assetName = SOCKET_PATCH_ASSETS[platformKey]

  if (!assetName) {
    throw new Error(
      `socket-patch is not available for platform ${platformKey}. ` +
        `Supported platforms: ${Object.keys(SOCKET_PATCH_ASSETS).join(', ')}`,
    )
  }

  return {
    type: 'github-release',
    details: {
      owner: 'SocketDev',
      repo: 'socket-patch',
      version: getSocketPatchVersion(),
      assetName,
      binaryName: 'socket-patch',
    },
  }
}

/**
 * Resolve path for synp binary.
 * No local path override currently supported.
 */
export function resolveSynp(): BinaryResolution {
  return {
    type: 'dlx',
    details: {
      name: 'synp',
      version: getSynpVersion(),
      binaryName: 'synp',
    },
  }
}
