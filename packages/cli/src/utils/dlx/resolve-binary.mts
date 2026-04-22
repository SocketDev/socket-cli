/**
 * Binary path resolution utilities for external tools.
 * Determines whether to use local path overrides, download from npm, or GitHub releases.
 */

import os from 'node:os'

import { getCdxgenVersion } from '../../env/cdxgen-version.mts'
import { getCoanaVersion } from '../../env/coana-version.mts'
import { requireOpengrepChecksum } from '../../env/opengrep-checksums.mts'
import { getOpengrepVersion } from '../../env/opengrep-version.mts'
import { SOCKET_CLI_CDXGEN_LOCAL_PATH } from '../../env/socket-cli-cdxgen-local-path.mts'
import { SOCKET_CLI_COANA_LOCAL_PATH } from '../../env/socket-cli-coana-local-path.mts'
import { SOCKET_CLI_PYCLI_LOCAL_PATH } from '../../env/socket-cli-pycli-local-path.mts'
import { SOCKET_CLI_SFW_LOCAL_PATH } from '../../env/socket-cli-sfw-local-path.mts'
import { SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH } from '../../env/socket-cli-socket-patch-local-path.mts'
import { getSfwNpmVersion } from '../../env/sfw-version.mts'
import { requireSocketPatchChecksum } from '../../env/socket-patch-checksums.mts'
import { getSocketPatchVersion } from '../../env/socket-patch-version.mts'
import { getSynpVersion } from '../../env/synp-version.mts'
import { requireTrivyChecksum } from '../../env/trivy-checksums.mts'
import { getTrivyVersion } from '../../env/trivy-version.mts'
import { requireTrufflehogChecksum } from '../../env/trufflehog-checksums.mts'
import { getTrufflehogVersion } from '../../env/trufflehog-version.mts'

import type { DlxPackageSpec } from './spawn.mjs'

/**
 * GitHub release binary specification.
 */
export type GitHubReleaseSpec = {
  assetName: string
  binaryName: string
  owner: string
  repo: string
  /**
   * Optional SHA-256 hex checksum for integrity verification.
   * If provided, downloads will be verified against this checksum.
   */
  sha256?: string | undefined
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
 *
 * Note: This returns the npm package version for dlx usage.
 * SEA builds use the GitHub binary directly via VFS extraction.
 */
export function resolveSfw(): BinaryResolution {
  if (SOCKET_CLI_SFW_LOCAL_PATH) {
    return { type: 'local', path: SOCKET_CLI_SFW_LOCAL_PATH }
  }

  return {
    type: 'dlx',
    details: {
      name: 'sfw',
      version: getSfwNpmVersion(),
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
      `socket-patch has no prebuilt binary for "${platformKey}" (supported: ${Object.keys(SOCKET_PATCH_ASSETS).join(', ')}); upgrade socket-cli, build socket-patch from source, or set SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH to point at a local build`,
    )
  }

  // Get SHA-256 checksum for integrity verification.
  // In dev mode (checksums not inlined), returns undefined to allow development.
  // In production builds, missing checksums throw a HARD ERROR.
  const sha256 = requireSocketPatchChecksum(assetName)

  return {
    type: 'github-release',
    details: {
      assetName,
      binaryName: 'socket-patch',
      owner: 'SocketDev',
      repo: 'socket-patch',
      sha256,
      version: getSocketPatchVersion(),
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

/**
 * Platform-specific asset name patterns for Trivy GitHub releases.
 * Maps Node.js platform/arch to GitHub release asset name generator functions.
 *
 * Trivy Platform Coverage:
 * - darwin-arm64: trivy_{version}_macOS-ARM64.tar.gz
 * - darwin-x64: trivy_{version}_macOS-64bit.tar.gz
 * - linux-arm64: trivy_{version}_Linux-ARM64.tar.gz
 * - linux-x64: trivy_{version}_Linux-64bit.tar.gz
 * - win32-x64: trivy_{version}_windows-64bit.zip
 */
const TRIVY_ASSET_PATTERNS: Record<string, (v: string) => string> = {
  __proto__: null as unknown as (v: string) => string,
  'darwin-arm64': (v: string) => `trivy_${v}_macOS-ARM64.tar.gz`,
  'darwin-x64': (v: string) => `trivy_${v}_macOS-64bit.tar.gz`,
  'linux-arm64': (v: string) => `trivy_${v}_Linux-ARM64.tar.gz`,
  'linux-x64': (v: string) => `trivy_${v}_Linux-64bit.tar.gz`,
  'win32-x64': (v: string) => `trivy_${v}_windows-64bit.zip`,
}

function getTrivyAssetName(version: string): string | undefined {
  const platform = os.platform()
  const arch = os.arch()
  const platformKey = `${platform}-${arch}`

  const pattern = TRIVY_ASSET_PATTERNS[platformKey]
  return pattern ? pattern(version) : undefined
}

/**
 * Resolve path for Trivy binary.
 * Downloads from GitHub releases (aquasecurity/trivy).
 */
export function resolveTrivy(): BinaryResolution {
  const version = getTrivyVersion()
  const assetName = getTrivyAssetName(version)

  if (!assetName) {
    const platform = os.platform()
    const arch = os.arch()
    throw new Error(
      `Trivy has no prebuilt binary for "${platform}-${arch}" (supported: darwin-arm64, darwin-x64, linux-arm64, linux-x64, win32-x64); run socket-cli on a supported platform or install Trivy manually and point \`trivy\` at it on PATH`,
    )
  }

  const sha256 = requireTrivyChecksum(assetName)

  return {
    type: 'github-release',
    details: {
      assetName,
      binaryName: 'trivy',
      owner: 'aquasecurity',
      repo: 'trivy',
      sha256,
      // Trivy uses 'v' prefix for release tags.
      version: `v${version}`,
    },
  }
}

/**
 * Platform-specific asset name patterns for TruffleHog GitHub releases.
 * Maps Node.js platform/arch to GitHub release asset name generator functions.
 *
 * TruffleHog Platform Coverage:
 * - darwin-arm64: trufflehog_{version}_darwin_arm64.tar.gz
 * - darwin-x64: trufflehog_{version}_darwin_amd64.tar.gz
 * - linux-arm64: trufflehog_{version}_linux_arm64.tar.gz
 * - linux-x64: trufflehog_{version}_linux_amd64.tar.gz
 * - win32-arm64: trufflehog_{version}_windows_arm64.tar.gz
 * - win32-x64: trufflehog_{version}_windows_amd64.tar.gz
 */
const TRUFFLEHOG_ASSET_PATTERNS: Record<string, (v: string) => string> = {
  __proto__: null as unknown as (v: string) => string,
  'darwin-arm64': (v: string) => `trufflehog_${v}_darwin_arm64.tar.gz`,
  'darwin-x64': (v: string) => `trufflehog_${v}_darwin_amd64.tar.gz`,
  'linux-arm64': (v: string) => `trufflehog_${v}_linux_arm64.tar.gz`,
  'linux-x64': (v: string) => `trufflehog_${v}_linux_amd64.tar.gz`,
  'win32-arm64': (v: string) => `trufflehog_${v}_windows_arm64.tar.gz`,
  'win32-x64': (v: string) => `trufflehog_${v}_windows_amd64.tar.gz`,
}

function getTrufflehogAssetName(version: string): string | undefined {
  const platform = os.platform()
  const arch = os.arch()
  const platformKey = `${platform}-${arch}`

  const pattern = TRUFFLEHOG_ASSET_PATTERNS[platformKey]
  return pattern ? pattern(version) : undefined
}

/**
 * Resolve path for TruffleHog binary.
 * Downloads from GitHub releases (trufflesecurity/trufflehog).
 */
export function resolveTrufflehog(): BinaryResolution {
  const version = getTrufflehogVersion()
  const assetName = getTrufflehogAssetName(version)

  if (!assetName) {
    const platform = os.platform()
    const arch = os.arch()
    throw new Error(
      `TruffleHog has no prebuilt binary for "${platform}-${arch}" (supported: darwin-arm64, darwin-x64, linux-arm64, linux-x64, win32-arm64, win32-x64); run socket-cli on a supported platform or install TruffleHog manually and point \`trufflehog\` at it on PATH`,
    )
  }

  const sha256 = requireTrufflehogChecksum(assetName)

  return {
    type: 'github-release',
    details: {
      assetName,
      binaryName: 'trufflehog',
      owner: 'trufflesecurity',
      repo: 'trufflehog',
      sha256,
      // TruffleHog uses 'v' prefix for release tags.
      version: `v${version}`,
    },
  }
}

/**
 * Platform-specific asset names for OpenGrep GitHub releases.
 * Maps Node.js platform/arch to GitHub release asset names.
 *
 * OpenGrep Platform Coverage:
 * - darwin-arm64: opengrep-core_osx_aarch64.tar.gz
 * - darwin-x64: opengrep-core_osx_x86.tar.gz
 * - linux-arm64: opengrep-core_linux_aarch64.tar.gz
 * - linux-x64: opengrep-core_linux_x86.tar.gz
 * - win32-x64: opengrep-core_windows_x86.zip
 */
const OPENGREP_ASSETS: Record<string, string> = {
  __proto__: null as unknown as string,
  'darwin-arm64': 'opengrep-core_osx_aarch64.tar.gz',
  'darwin-x64': 'opengrep-core_osx_x86.tar.gz',
  'linux-arm64': 'opengrep-core_linux_aarch64.tar.gz',
  'linux-x64': 'opengrep-core_linux_x86.tar.gz',
  'win32-x64': 'opengrep-core_windows_x86.zip',
}

/**
 * Resolve path for OpenGrep binary.
 * Downloads from GitHub releases (opengrep/opengrep).
 */
export function resolveOpengrep(): BinaryResolution {
  const platform = os.platform()
  const arch = os.arch()
  const platformKey = `${platform}-${arch}`
  const assetName = OPENGREP_ASSETS[platformKey]

  if (!assetName) {
    throw new Error(
      `OpenGrep has no prebuilt binary for "${platformKey}" (supported: ${Object.keys(OPENGREP_ASSETS).join(', ')}); run socket-cli on a supported platform or install OpenGrep manually and point \`opengrep\` at it on PATH`,
    )
  }

  const sha256 = requireOpengrepChecksum(assetName)

  return {
    type: 'github-release',
    details: {
      assetName,
      // OpenGrep extracts to 'osemgrep' binary.
      binaryName: 'osemgrep',
      owner: 'opengrep',
      repo: 'opengrep',
      sha256,
      version: getOpengrepVersion(),
    },
  }
}
