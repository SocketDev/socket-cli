#!/usr/bin/env node
// Setup script for Socket security tools.
//
// Configures three tools:
// 1. AgentShield — scans Claude AI config for prompt injection / secrets.
//    Downloaded as npm package via dlx (pinned version, cached).
// 2. Zizmor — static analysis for GitHub Actions workflows. Downloads the
//    correct binary, verifies SHA-256, cached via the dlx system.
// 3. SFW (Socket Firewall) — intercepts package manager commands to scan
//    for malware. Downloads binary, verifies SHA-256, creates PATH shims.
//    Enterprise vs free determined by SOCKET_API_KEY (primary; universally
//    supported) or SOCKET_API_TOKEN (forward-canonical; accepted as secondary)
//    in env / .env / .env.local.
//
// Each tool's install workflow lives in its own sibling file (github-
// release.mts, agentshield.mts, janus.mts, sfw.mts, zizmor.mts,
// skillspector.mts, run-all.mts) because this file is at the 500-line soft
// cap; every exported function below stays here as a thin wrapper so
// existing importers keep working unchanged.

import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { PackageURL } from '@socketregistry/packageurl-js-stable'

import { findApiToken as findApiTokenCanonical } from './api-token.mts'
import { downloadNpmPackage } from '@socketsecurity/lib-stable/dlx/package'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { runSetupAgentShield } from './agentshield.mts'
import {
  runInstallGitHubReleaseTool,
  runInstallGitHubReleaseToolWithTag,
} from './github-release.mts'
import type { InstallGitHubToolConfig } from './github-release.mts'
import { runEnsureJanusQueue, runSetupJanus } from './janus.mts'
import { runSetupAll } from './run-all.mts'
import { runSetupSfw } from './sfw.mts'
import {
  runCheckSkillSpectorVersion,
  runSetupSkillSpector,
} from './skillspector.mts'
import {
  ACTIONLINT,
  CDXGEN,
  OPENGREP,
  SYNP,
  TRIVY,
  TRUFFLEHOG,
  UV,
  ZIZMOR,
} from './tool-config.mts'
import type { PlatformEntry, ToolEntry } from './tool-config.mts'
import { runSetupZizmor } from './zizmor.mts'

const logger = getDefaultLogger()

// ── Shared helpers ──

// GitHub release tag for a tool-config version: prepend `v` unless the
// version already carries one. The manifest historically holds BOTH forms
// (the updater once stored raw tag_names), so every release-URL site goes
// through this instead of assuming one shape — a wrong assumption 404s the
// download (the zizmor `vv1.26.1` incident).
export function releaseTag(version: string): string {
  return version.startsWith('v') ? version : `v${version}`
}

// The inverse boundary: bare semver for version-output comparisons and
// display (`zizmor --version` prints `zizmor 1.26.1`, never `v1.26.1`).
export function bareVersion(version: string): string {
  return version.replace(/^v/, '')
}

export async function checkZizmorVersion(binPath: string): Promise<boolean> {
  try {
    const result = await spawn(binPath, ['--version'], { stdio: 'pipe' })
    const output = String(result.stdout).trim()
    return ZIZMOR.version ? output.includes(bareVersion(ZIZMOR.version)) : false
  } catch {
    return false
  }
}

/**
 * Resolve the Socket API token from env → keychain. Re-exported from
 * `lib/api-token.mts` so call sites can keep importing `findApiToken` from
 * `installers.mts` (back-compat) while the canonical resolver stays a single
 * source of truth.
 *
 * The previous in-file implementation read `.env` / `.env.local` which is a
 * CLAUDE.md token-hygiene violation (dotfiles leak; tokens belong in env or the
 * OS keychain). It also skipped the keychain entirely, which caused
 * sfw-enterprise → sfw-free silent downgrades when the token was only in the
 * macOS Keychain.
 */
export function findApiToken(): string | undefined {
  return findApiTokenCanonical().token
}

// The host platform-arch key used to index a tool's `platforms` map, e.g.
// `darwin-arm64`, `linux-x64`, `win-arm64`. Single source of the key format so
// every installer resolves the same way.
export function hostPlatformKey(): string {
  return `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
}

// Resolve a tool's asset entry for `hostKey`, applying the win-arm64→win-x64
// fallback: Windows-on-ARM runs win-x64 binaries under emulation and upstreams
// rarely ship a native win-arm64 asset, so an ARM-Windows host gets the win-x64
// build rather than a spurious "unsupported platform". Pure (host key passed in)
// so it's unit-testable; `resolvePlatformEntry` supplies the live host key.
export function pickPlatformEntry(
  platforms: ToolEntry['platforms'],
  hostKey: string,
): PlatformEntry | undefined {
  const direct = platforms?.[hostKey]
  if (direct) {
    return direct
  }
  if (hostKey === 'win-arm64') {
    return platforms?.['win-x64']
  }
  return undefined
}

// The host-key + resolved-entry pair. `platformKey` is the host key (for
// messaging / install-dir paths); `entry` is resolved with the win-arm64
// fallback via pickPlatformEntry.
export function resolvePlatformEntry(platforms: ToolEntry['platforms']): {
  entry: PlatformEntry | undefined
  platformKey: string
} {
  const platformKey = hostPlatformKey()
  return { entry: pickPlatformEntry(platforms, platformKey), platformKey }
}

/**
 * Common path for tools downloaded from GitHub Releases: PATH check → download
 * + sha256-verify → cache hit / extract → chmod 0o755. Full implementation in
 * `github-release.mts`; see that file's docblock for the archive-shape matrix.
 */
export async function installGitHubReleaseTool(
  config: InstallGitHubToolConfig,
): Promise<boolean> {
  return runInstallGitHubReleaseTool(config)
}

/**
 * Variant of `installGitHubReleaseTool` for projects that don't tag with a `v`
 * prefix (astral-sh/uv). Full implementation in `github-release.mts`.
 */
export async function installGitHubReleaseToolWithTag(
  config: InstallGitHubToolConfig & { tag: string },
): Promise<boolean> {
  return runInstallGitHubReleaseToolWithTag(config)
}

export async function setupActionlint(): Promise<boolean> {
  return installGitHubReleaseTool({
    name: 'actionlint',
    displayName: 'actionlint',
    tool: ACTIONLINT,
    binaryNameInArchive: 'actionlint',
    finalBinaryName: 'actionlint',
  })
}

/**
 * Full implementation in `agentshield.mts`.
 */
export async function setupAgentShield(): Promise<boolean> {
  return runSetupAgentShield()
}

export async function setupCdxgen(): Promise<boolean> {
  // cdxgen ships per-platform SEA binaries (slim variant by default —
  // no bundled bun/deno runtimes, ~3× smaller than the full flavor).
  // Falls through to the generic GitHub-release-tool helper. Platforms
  // that aren't in the asset map quietly skip via the helper's
  // "unsupported platform" warning path — none today (the slim matrix
  // covers all 8 fleet targets).
  return installGitHubReleaseTool({
    name: 'cdxgen',
    displayName: 'cdxgen',
    tool: CDXGEN,
    binaryNameInArchive: 'cdxgen',
    finalBinaryName: 'cdxgen',
  })
}

/**
 * Full implementation in `janus.mts`.
 */
export async function setupJanus(): Promise<boolean> {
  return runSetupJanus()
}

/**
 * Best-effort `janus init` so a repo that just received the janus binary has a
 * `.janus/` queue without a manual step. Full implementation in `janus.mts`.
 */
export async function ensureJanusQueue(janusBin: string): Promise<void> {
  return runEnsureJanusQueue(janusBin)
}

interface NpmToolInstallConfig {
  /**
   * Logical tool name (used for log banner + bin name).
   */
  readonly name: string
  /**
   * Human-readable display name for log output.
   */
  readonly displayName: string
  /**
   * Tool config entry from external-tools.json (must carry `purl`).
   */
  readonly tool: ToolEntry
}

/**
 * Install an npm-only tool via dlx. Mirrors the upper half of
 * `setupAgentShield()` — purl → package spec → `downloadNpmPackage`. No
 * version-mismatch verification: the dlx layer SRI-verifies the tarball against
 * the `integrity` from external-tools.json, which is the authoritative answer
 * (binary --version self-reports can drift from package.json — see the
 * AgentShield comment for the documented case).
 */
export async function setupNpmTool(
  // oxlint-disable-next-line no-shadow -- required config param name matches the module-level tool-manifest `config` by convention
  config: NpmToolInstallConfig,
): Promise<boolean> {
  const { displayName, name, tool } = {
    __proto__: null,
    ...config,
  } as typeof config
  logger.log(`=== ${displayName} ===`)
  if (!tool.purl) {
    logger.warn(`${displayName}: missing purl in external-tools.json`)
    return false
  }
  const purl = PackageURL.fromString(tool.purl)
  if (purl.type !== 'npm') {
    throw new Error(
      `${displayName}: unsupported PURL type "${purl.type}" — only npm is supported`,
    )
  }
  const npmPackage = purl.namespace
    ? `${purl.namespace}/${purl.name}`
    : purl.name!
  const version = tool.version ?? purl.version
  const packageSpec = version ? `${npmPackage}@${version}` : npmPackage
  logger.log(`Installing ${packageSpec} via dlx…`)
  const { binaryPath, installed } = await downloadNpmPackage({
    spec: packageSpec,
    binaryName: name,
  })
  logger.log(
    installed
      ? `Installed: ${binaryPath}${version ? ` (${version})` : ''}`
      : `Cached: ${binaryPath}${version ? ` (${version})` : ''}`,
  )
  return true
}

export async function setupOpengrep(): Promise<boolean> {
  // OpenGrep ships bare-binary assets for Linux/macOS (e.g.
  // `opengrep_manylinux_x86`) and a zipped binary for Windows (named
  // `opengrep-core_windows_x86.zip` containing `opengrep-core.exe`).
  // The bare-binary case is auto-detected by extension; we just need
  // the right `binaryNameInArchive` for the Windows zip case.
  const isWindows = process.platform === 'win32'
  return installGitHubReleaseTool({
    name: 'opengrep',
    displayName: 'OpenGrep',
    tool: OPENGREP,
    binaryNameInArchive: isWindows ? 'opengrep-core' : 'opengrep',
    finalBinaryName: 'opengrep',
  })
}

/**
 * Full implementation in `sfw.mts`.
 */
export async function setupSfw(apiToken: string | undefined): Promise<boolean> {
  return runSetupSfw(apiToken)
}

export async function setupSynp(): Promise<boolean> {
  return setupNpmTool({
    name: 'synp',
    displayName: 'synp',
    tool: SYNP,
  })
}

export async function setupTrivy(): Promise<boolean> {
  return installGitHubReleaseTool({
    name: 'trivy',
    displayName: 'Trivy',
    tool: TRIVY,
    binaryNameInArchive: 'trivy',
    finalBinaryName: 'trivy',
  })
}

export async function setupTrufflehog(): Promise<boolean> {
  return installGitHubReleaseTool({
    name: 'trufflehog',
    displayName: 'TruffleHog',
    tool: TRUFFLEHOG,
    binaryNameInArchive: 'trufflehog',
    finalBinaryName: 'trufflehog',
  })
}

export async function setupUv(): Promise<boolean> {
  // astral-sh/uv tags releases without a `v` prefix (`0.10.11`, not
  // `v0.10.11`), so the generic helper's `v`-prepend would 404. The
  // tarball also wraps the binary one level deep: e.g.
  // `uv-x86_64-apple-darwin/uv`. Pin the tag literally and tell the
  // helper which subdirectory holds the binary.
  const { entry: platformEntry } = resolvePlatformEntry(UV.platforms)
  const pathInArchive = platformEntry?.asset.replace(/\.(tar\.gz|zip)$/, '')
  return installGitHubReleaseToolWithTag({
    name: 'uv',
    displayName: 'uv (Python package manager)',
    tool: UV,
    binaryNameInArchive: 'uv',
    finalBinaryName: 'uv',
    pathInArchive,
    tag: UV.version!,
  })
}

/**
 * Full implementation in `zizmor.mts`.
 */
export async function setupZizmor(): Promise<boolean> {
  return runSetupZizmor()
}

/**
 * Check whether the locally-installed skillspector matches the SHA we
 * pinned. Full implementation in `skillspector.mts`.
 */
export async function checkSkillSpectorVersion(
  binPath: string,
): Promise<boolean> {
  return runCheckSkillSpectorVersion(binPath)
}

/**
 * SkillSpector setup. Full implementation in `skillspector.mts`.
 */
export async function setupSkillSpector(): Promise<boolean> {
  return runSetupSkillSpector()
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runSetupAll().catch((e: unknown) => {
    logger.error(errorMessage(e))
    process.exitCode = 1
  })
}
