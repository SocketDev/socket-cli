/**
 * Binary path resolution utilities for external tools.
 * Determines whether to use local path overrides or download from npm.
 */

import ENV from '../../constants/env.mts'
import { getSwfVersion } from '../../env/sfw-version.mts'

import type { DlxPackageSpec } from './spawn.mjs'

/**
 * Result of binary resolution.
 * Either points to a local path or specifies a package to download via dlx.
 */
export type BinaryResolution =
  | { type: 'local'; path: string }
  | { type: 'dlx'; details: DlxPackageSpec }

/**
 * Resolve path for Coana CLI binary.
 * Checks SOCKET_CLI_COANA_LOCAL_PATH environment variable first.
 */
export function resolveCoana(): BinaryResolution {
  const localPath = ENV.SOCKET_CLI_COANA_LOCAL_PATH
  if (localPath) {
    return { type: 'local', path: localPath }
  }

  return {
    type: 'dlx',
    details: {
      name: '@coana-tech/cli',
      version: `~${ENV.INLINED_SOCKET_CLI_COANA_VERSION}`,
      binaryName: 'coana',
    },
  }
}

/**
 * Resolve path for cdxgen binary.
 * Checks SOCKET_CLI_CDXGEN_LOCAL_PATH environment variable first.
 */
export function resolveCdxgen(): BinaryResolution {
  const localPath = ENV.SOCKET_CLI_CDXGEN_LOCAL_PATH
  if (localPath) {
    return { type: 'local', path: localPath }
  }

  return {
    type: 'dlx',
    details: {
      name: '@cyclonedx/cdxgen',
      version: ENV.INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION,
      binaryName: 'cdxgen',
    },
  }
}

/**
 * Resolve path for Python CLI binary.
 * Checks SOCKET_CLI_PYCLI_LOCAL_PATH environment variable first.
 */
export function resolvePyCli(): BinaryResolution | { type: 'python' } {
  const localPath = ENV.SOCKET_CLI_PYCLI_LOCAL_PATH
  if (localPath) {
    return { type: 'local', path: localPath }
  }

  // Python CLI uses managed Python + pip install, not dlx.
  return { type: 'python' }
}

/**
 * Resolve path for Socket Firewall (sfw) binary.
 * Checks SOCKET_CLI_SFW_LOCAL_PATH environment variable first.
 */
export function resolveSfw(): BinaryResolution {
  const localPath = ENV.SOCKET_CLI_SFW_LOCAL_PATH
  if (localPath) {
    return { type: 'local', path: localPath }
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
 * Resolve path for synp binary.
 * No local path override currently supported.
 */
export function resolveSynp(): BinaryResolution {
  return {
    type: 'dlx',
    details: {
      name: 'synp',
      version: ENV.INLINED_SOCKET_CLI_SYNP_VERSION,
      binaryName: 'synp',
    },
  }
}
