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

import { existsSync, promises as fs, readFileSync } from 'node:fs'

import { findApiToken as findApiTokenCanonical } from './api-token.mts'
import { setupHeadroom } from './headroom.mts'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { PackageURL } from '@socketregistry/packageurl-js-stable'
import { Type } from '@sinclair/typebox'

import { whichSync } from '@socketsecurity/lib-stable/bin/which'
import { downloadBinary } from '@socketsecurity/lib-stable/dlx/binary'
import { downloadNpmPackage } from '@socketsecurity/lib-stable/dlx/package'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { getSocketHomePath } from '@socketsecurity/lib-stable/paths/socket'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { parseSchema } from '@socketsecurity/lib-stable/schema/parse'

const logger = getDefaultLogger()

// ── Tool config loaded from external-tools.json (self-contained) ──

const platformEntrySchema = Type.Object({
  asset: Type.String(),
  integrity: Type.String(),
})

const toolSchema = Type.Object({
  description: Type.Optional(Type.String()),
  version: Type.Optional(Type.String()),
  versionDate: Type.Optional(Type.String()),
  purl: Type.Optional(Type.String()),
  integrity: Type.Optional(Type.String()),
  repository: Type.Optional(Type.String()),
  release: Type.Optional(Type.String()),
  installDir: Type.Optional(Type.String()),
  platforms: Type.Optional(Type.Record(Type.String(), platformEntrySchema)),
  ecosystems: Type.Optional(Type.Array(Type.String())),
})

const configSchema = Type.Object({
  description: Type.Optional(Type.String()),
  tools: Type.Record(Type.String(), toolSchema),
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// external-tools.json lives one level up at the hook root
// (.claude/hooks/fleet/setup-security-tools/external-tools.json) — keep it
// out of `lib/` so it's discoverable as a top-level config file rather
// than buried as an implementation detail. Fall back to a sibling path
// so an early-installed copy in lib/ still resolves during onboarding.
const configPath = (() => {
  const parentPath = path.join(__dirname, '..', 'external-tools.json')
  if (existsSync(parentPath)) {
    return parentPath
  }
  return path.join(__dirname, 'external-tools.json')
})()
const rawConfig = JSON.parse(readFileSync(configPath, 'utf8'))
const config = parseSchema(configSchema, rawConfig)

const ACTIONLINT = config.tools['actionlint']!
const AGENTSHIELD = config.tools['agentshield']!
const CDXGEN = config.tools['cdxgen']!
const SYNP = config.tools['synp']!
const ZIZMOR = config.tools['zizmor']!
const SFW_FREE = config.tools['sfw-free']!
const SFW_ENTERPRISE = config.tools['sfw-enterprise']!
const TRUFFLEHOG = config.tools['trufflehog']!
const TRIVY = config.tools['trivy']!
const OPENGREP = config.tools['opengrep']!
const UV = config.tools['uv']!
const JANUS = config.tools['janus']!
const SKILLSPECTOR = config.tools['skillspector']!
const HEADROOM = config.tools['headroom']!

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

type ToolEntry = (typeof config.tools)[string]
type PlatformEntry = NonNullable<ToolEntry['platforms']>[string]

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

interface InstallGitHubToolOptions {
  /**
   * Logical tool name (used for log banner + cache key).
   */
  name: string
  /**
   * Display name for human-readable logs.
   */
  displayName: string
  /**
   * Tool config entry from external-tools.json.
   */
  tool: ToolEntry
  /**
   * Name of the binary inside the archive (without extension). For bare-binary
   * assets (no archive), pass the same string used as the asset name — the
   * helper detects and skips extraction.
   */
  binaryNameInArchive: string
  /**
   * Final binary name on disk (without extension). Usually same as
   * `binaryNameInArchive`.
   */
  finalBinaryName: string
  /**
   * Optional path within the archive where the binary lives. Defaults to the
   * archive root.
   */
  pathInArchive?: string | undefined
  /**
   * Optional absolute directory to install the final binary into. When set, the
   * binary is copied here (creating parent dirs as needed) instead of landing
   * alongside the dlx-cached archive. Use for shared cross-fleet locations
   * (e.g. `~/.socket/_wheelhouse/<tool>/`) so multiple consumers reuse the same
   * install.
   */
  installDir?: string | undefined
}

/**
 * Common path for tools downloaded from GitHub Releases: PATH check → download
 * + sha256-verify → cache hit / extract → chmod 0o755.
 *
 * Handles three archive shapes: - `.tar.gz` / `.tgz` → tar xzf - `.zip` →
 * PowerShell Expand-Archive (Windows) or unzip - bare binary → copy as-is (used
 * by opengrep manylinux/osx assets)
 */
export async function installGitHubReleaseTool(
  options: InstallGitHubToolOptions,
): Promise<boolean> {
  const opts = { __proto__: null, ...options } as InstallGitHubToolOptions
  const { binaryNameInArchive, displayName, finalBinaryName, name, tool } = opts
  logger.log(`=== ${displayName} ===`)

  // Check PATH first (e.g. brew install).
  const systemBin = whichSync(finalBinaryName, { nothrow: true })
  if (systemBin && typeof systemBin === 'string') {
    logger.log(`Found on PATH: ${systemBin}`)
    return true
  }

  const { entry: platformEntry, platformKey } = resolvePlatformEntry(
    tool.platforms,
  )
  if (!platformEntry) {
    logger.warn(`${displayName}: unsupported platform ${platformKey}`)
    return false
  }
  const { asset, integrity: expectedIntegrity } = platformEntry
  const repo = tool.repository?.replace(/^[^:]+:/, '') ?? ''
  // Most GitHub release URLs use a `v` prefix on the tag (`v1.2.3`); a
  // few projects don't (`uv` uses `0.10.11`). The tool config's
  // `version` field is the bare semver — prepend `v` unless it already
  // starts with one. astral-sh/uv is the lone exception and is handled
  // by setupUv() passing the literal tag.
  const tag = releaseTag(tool.version ?? '')
  const url = `https://github.com/${repo}/releases/download/${tag}/${asset}`

  logger.log(`Downloading ${displayName} v${tool.version} (${asset})...`)
  const { binaryPath: downloadPath, downloaded } = await downloadBinary({
    url,
    name: `${name}-${tool.version}-${asset}`,
    integrity: expectedIntegrity,
  })
  logger.log(
    downloaded
      ? 'Download complete, checksum verified.'
      : `Using cached: ${downloadPath}`,
  )

  const ext = process.platform === 'win32' ? '.exe' : ''
  const finalDir = opts.installDir ?? path.dirname(downloadPath)
  await fs.mkdir(finalDir, { recursive: true })
  const finalBinPath = path.join(finalDir, `${finalBinaryName}${ext}`)
  if (existsSync(finalBinPath)) {
    logger.log(`Cached: ${finalBinPath}`)
    return true
  }

  const isTar = asset.endsWith('.tar.gz') || asset.endsWith('.tgz')
  const isZip = asset.endsWith('.zip')
  // Bare-binary assets (opengrep's manylinux/osx variants) — the asset
  // IS the binary, no extraction needed. Copy + chmod and exit.
  if (!isTar && !isZip) {
    await fs.copyFile(downloadPath, finalBinPath)
    await fs.chmod(finalBinPath, 0o755)
    logger.log(`Installed to ${finalBinPath}`)
    return true
  }

  const extractDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `${name}-extract-`),
  )
  try {
    if (isZip) {
      if (process.platform === 'win32') {
        await spawn(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `Expand-Archive -Path '${downloadPath}' -DestinationPath '${extractDir}' -Force`,
          ],
          { stdio: 'pipe' },
        )
      } else {
        await spawn('unzip', ['-q', downloadPath, '-d', extractDir], {
          stdio: 'pipe',
        })
      }
    } else {
      await spawn('tar', ['xzf', downloadPath, '-C', extractDir], {
        stdio: 'pipe',
      })
    }
    const extractedRel = opts.pathInArchive
      ? path.join(opts.pathInArchive, `${binaryNameInArchive}${ext}`)
      : `${binaryNameInArchive}${ext}`
    const extractedBin = path.join(extractDir, extractedRel)
    if (!existsSync(extractedBin)) {
      throw new Error(`Binary not found after extraction: ${extractedBin}`)
    }
    await fs.copyFile(extractedBin, finalBinPath)
    await fs.chmod(finalBinPath, 0o755)
  } finally {
    await safeDelete(extractDir).catch(e => {
      logger.warn(
        `cleanup of extract dir failed (${extractDir}): ${errorMessage(e)}`,
      )
    })
  }

  logger.log(`Installed to ${finalBinPath}`)
  return true
}

/**
 * Variant of `installGitHubReleaseTool` for projects that don't tag with a `v`
 * prefix (astral-sh/uv). Takes an explicit `tag` field instead of synthesizing
 * one from `tool.version`.
 */
export async function installGitHubReleaseToolWithTag(
  options: InstallGitHubToolOptions & { tag: string },
): Promise<boolean> {
  const opts = { __proto__: null, ...options } as InstallGitHubToolOptions & {
    tag: string
  }
  const { binaryNameInArchive, displayName, finalBinaryName, name, tag, tool } =
    opts
  logger.log(`=== ${displayName} ===`)

  const systemBin = whichSync(finalBinaryName, { nothrow: true })
  if (systemBin && typeof systemBin === 'string') {
    logger.log(`Found on PATH: ${systemBin}`)
    return true
  }

  const { entry: platformEntry, platformKey } = resolvePlatformEntry(
    tool.platforms,
  )
  if (!platformEntry) {
    logger.warn(`${displayName}: unsupported platform ${platformKey}`)
    return false
  }
  const { asset, integrity: expectedIntegrity } = platformEntry
  const repo = tool.repository?.replace(/^[^:]+:/, '') ?? ''
  const url = `https://github.com/${repo}/releases/download/${tag}/${asset}`

  logger.log(`Downloading ${displayName} ${tag} (${asset})...`)
  const { binaryPath: downloadPath, downloaded } = await downloadBinary({
    url,
    name: `${name}-${tag}-${asset}`,
    integrity: expectedIntegrity,
  })
  logger.log(
    downloaded
      ? 'Download complete, checksum verified.'
      : `Using cached: ${downloadPath}`,
  )

  const ext = process.platform === 'win32' ? '.exe' : ''
  const finalBinPath = path.join(
    path.dirname(downloadPath),
    `${finalBinaryName}${ext}`,
  )
  if (existsSync(finalBinPath)) {
    logger.log(`Cached: ${finalBinPath}`)
    return true
  }

  const isZip = asset.endsWith('.zip')
  const extractDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `${name}-extract-`),
  )
  try {
    if (isZip) {
      if (process.platform === 'win32') {
        await spawn(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `Expand-Archive -Path '${downloadPath}' -DestinationPath '${extractDir}' -Force`,
          ],
          { stdio: 'pipe' },
        )
      } else {
        await spawn('unzip', ['-q', downloadPath, '-d', extractDir], {
          stdio: 'pipe',
        })
      }
    } else {
      await spawn('tar', ['xzf', downloadPath, '-C', extractDir], {
        stdio: 'pipe',
      })
    }
    const extractedRel = opts.pathInArchive
      ? path.join(opts.pathInArchive, `${binaryNameInArchive}${ext}`)
      : `${binaryNameInArchive}${ext}`
    const extractedBin = path.join(extractDir, extractedRel)
    if (!existsSync(extractedBin)) {
      throw new Error(`Binary not found after extraction: ${extractedBin}`)
    }
    await fs.copyFile(extractedBin, finalBinPath)
    await fs.chmod(finalBinPath, 0o755)
  } finally {
    await safeDelete(extractDir).catch(e => {
      logger.warn(
        `cleanup of extract dir failed (${extractDir}): ${errorMessage(e)}`,
      )
    })
  }

  logger.log(`Installed to ${finalBinPath}`)
  return true
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

export async function setupAgentShield(): Promise<boolean> {
  logger.log('=== AgentShield ===')
  const purl = PackageURL.fromString(AGENTSHIELD.purl!)
  if (purl.type !== 'npm') {
    throw new Error(
      `Unsupported PURL type "${purl.type}" — only npm is supported`,
    )
  }
  const npmPackage = purl.namespace
    ? `${purl.namespace}/${purl.name}`
    : purl.name!
  const version = AGENTSHIELD.version ?? purl.version
  const packageSpec = version ? `${npmPackage}@${version}` : npmPackage

  logger.log(`Installing ${packageSpec} via dlx…`)
  const { binaryPath, installed } = await downloadNpmPackage({
    spec: packageSpec,
    binaryName: 'agentshield',
  })

  // Verify the installed package matches the pinned version.
  //
  // Don't trust the binary's --version self-report: ecc-agentshield's
  // compiled bundle has a hardcoded version string that has drifted
  // from the published package.json (e.g. binary reports "1.5.0"
  // while npm latest + published package.json both say "1.4.0").
  // That's an upstream packaging issue; the authoritative answer
  // is the dlx-cached package.json, which is what npm actually
  // delivered after integrity-hash verification.
  if (version) {
    const pkgJsonPath = path.join(
      path.dirname(binaryPath),
      '..',
      'ecc-agentshield',
      'package.json',
    )
    let installedVersion: string | undefined
    try {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
        version?: unknown | undefined
      }
      if (typeof pkgJson.version === 'string') {
        installedVersion = pkgJson.version
      }
    } catch {
      // Fall through — treat as unverifiable rather than fail.
    }
    if (installedVersion && installedVersion !== version) {
      logger.warn(
        `Version mismatch: pinned ${version}, installed ${installedVersion}`,
      )
      return false
    }
    const reportedVersion = installedVersion ?? version
    logger.log(
      installed
        ? `Installed: ${binaryPath} (${reportedVersion})`
        : `Cached: ${binaryPath} (${reportedVersion})`,
    )
  } else {
    logger.log(installed ? `Installed: ${binaryPath}` : `Cached: ${binaryPath}`)
  }
  return true
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

export async function setupJanus(): Promise<boolean> {
  // janus ships a darwin-arm64 binary only (upstream builds one platform; the
  // version is pinned in external-tools.json). On every other platform,
  // skip the install with a quiet log rather than emitting a warning —
  // janus isn't a fleet-critical dependency, just a tool some Socket
  // workflows opt into. Install lands in the shared
  // ~/.socket/_wheelhouse/janus/<version>/ dir so every fleet member's
  // hook reuses the same binary.
  const { entry: janusEntry, platformKey } = resolvePlatformEntry(
    JANUS.platforms,
  )
  if (!janusEntry) {
    logger.log('=== janus ===')
    logger.log(`Skipped: no janus build for ${platformKey} (mac-arm64 only)`)
    return true
  }
  const installDir = path.join(
    getSocketHomePath(),
    '_wheelhouse',
    'janus',
    JANUS.version!,
    platformKey,
  )
  const installed = await installGitHubReleaseTool({
    name: 'janus',
    displayName: 'janus',
    tool: JANUS,
    binaryNameInArchive: 'janus',
    finalBinaryName: 'janus',
    installDir,
  })
  if (installed) {
    await ensureJanusQueue(path.join(installDir, 'janus'))
  }
  return installed
}

/**
 * Best-effort `janus init` so a repo that just received the janus binary has a
 * `.janus/` queue without a manual step. Per docs/agents.md/fleet/release-vs-
 * cascade.md, `.janus/` is gitignored + created per-repo at setup (never seeded
 * from the release — the queue is repo-local + dynamic, and `janus init` is the
 * canonical creator). Idempotent (skips when `.janus/` already exists) and
 * NON-FATAL: a failure never fails the security-tools setup — the multi-Janus
 * shim simply treats a missing queue as "not adopted yet".
 */
export async function ensureJanusQueue(janusBin: string): Promise<void> {
  const repoRoot = process.cwd()
  if (existsSync(path.join(repoRoot, '.janus'))) {
    return
  }
  try {
    await spawn(janusBin, ['init'], { cwd: repoRoot, stdio: 'ignore' })
    logger.log('janus: initialized .janus/ queue')
  } catch {
    // Non-fatal: `janus init` is a convenience, not a setup gate.
  }
}

interface NpmToolInstallOptions {
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
  readonly tool: (typeof config.tools)[string]
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
  options: NpmToolInstallOptions,
): Promise<boolean> {
  const { displayName, name, tool } = {
    __proto__: null,
    ...options,
  } as typeof options
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

export async function setupSfw(apiToken: string | undefined): Promise<boolean> {
  const isEnterprise = !!apiToken
  const sfwConfig = isEnterprise ? SFW_ENTERPRISE : SFW_FREE
  logger.log(
    `=== Socket Firewall (${isEnterprise ? 'enterprise' : 'free'}) ===`,
  )

  // Platform.
  const { entry: platformEntry, platformKey } = resolvePlatformEntry(
    sfwConfig.platforms,
  )
  if (!platformEntry) {
    throw new Error(`Unsupported platform: ${platformKey}`)
  }

  // Integrity + asset.
  const { asset, integrity } = platformEntry
  const repo = sfwConfig.repository?.replace(/^[^:]+:/, '') ?? ''
  const url = `https://github.com/${repo}/releases/download/${releaseTag(sfwConfig.version)}/${asset}`
  const binaryName = isEnterprise ? 'sfw' : 'sfw-free'

  // Download (with cache + integrity check).
  const { binaryPath, downloaded } = await downloadBinary({
    url,
    name: binaryName,
    integrity,
  })
  logger.log(
    downloaded ? `Downloaded to ${binaryPath}` : `Cached at ${binaryPath}`,
  )

  // Create shims.
  const isWindows = process.platform === 'win32'

  const shimDir = path.join(getSocketHomePath(), 'sfw', 'shims')
  await fs.mkdir(shimDir, { recursive: true })
  const ecosystems = [...(sfwConfig.ecosystems ?? [])]
  if (isEnterprise && process.platform === 'linux') {
    ecosystems.push('go')
  }
  const cleanPath = (process.env['PATH'] ?? '')
    .split(path.delimiter)
    .filter(p => p !== shimDir)
    .join(path.delimiter)
  const sfwBin = normalizePath(binaryPath)
  const created: string[] = []
  for (let i = 0, { length } = ecosystems; i < length; i += 1) {
    const cmd = ecosystems[i]!
    let realBin = whichSync(cmd, { nothrow: true, path: cleanPath })
    if (!realBin || typeof realBin !== 'string') {
      continue
    }
    realBin = normalizePath(realBin)

    // Bash shim (macOS/Linux/Windows Git Bash).
    const bashLines = [
      '#!/bin/bash',
      `export PATH="$(echo "$PATH" | tr ':' '\\n' | grep -vxF '${shimDir}' | paste -sd: -)"`,
    ]
    if (isEnterprise) {
      // Read API token from env at runtime — never embed secrets in
      // scripts. Either SOCKET_API_KEY or SOCKET_API_TOKEN is accepted;
      // whichever is set gets exported under both so downstream tools
      // see the value regardless of which name they read.
      //
      // Dotfile fallback (`.env` / `.env.local`) is intentionally NOT
      // checked here per CLAUDE.md token-hygiene: tokens belong in env
      // (CI) or the OS keychain (dev local), never in dotfiles. The
      // shell-rc bridge installed by setup-security-tools writes the
      // export line into ~/.zshenv so every new shell already has the
      // env var set.
      bashLines.push(
        'if [ -z "$SOCKET_API_KEY" ] && [ -n "$SOCKET_API_TOKEN" ]; then',
        '  SOCKET_API_KEY="$SOCKET_API_TOKEN"',
        'fi',
        'if [ -n "$SOCKET_API_KEY" ]; then',
        '  export SOCKET_API_KEY',
        '  SOCKET_API_TOKEN="$SOCKET_API_KEY"',
        '  export SOCKET_API_TOKEN',
        'fi',
      )
    }
    bashLines.push(`exec "${sfwBin}" "${realBin}" "$@"`)
    const bashContent = bashLines.join('\n') + '\n'
    const bashPath = path.join(shimDir, cmd)
    if (
      !existsSync(bashPath) ||
      (await fs.readFile(bashPath, 'utf8').catch(() => '')) !== bashContent
    ) {
      await fs.writeFile(bashPath, bashContent, { mode: 0o755 })
    }
    created.push(cmd)

    // Windows .cmd shim (strips shim dir from PATH, then execs through sfw).
    if (isWindows) {
      let cmdApiTokenBlock = ''
      if (isEnterprise) {
        // Mirror the bash-shim env-only resolution. Dotfile fallback
        // (`.env` / `.env.local`) is intentionally not read here — see
        // the bash-shim comment for the token-hygiene rationale. The
        // Windows CredentialManager shell-rc bridge installed by
        // setup-security-tools writes the env var for every new
        // session.
        cmdApiTokenBlock =
          `if not defined SOCKET_API_KEY (\r\n` +
          `  if defined SOCKET_API_TOKEN set "SOCKET_API_KEY=%SOCKET_API_TOKEN%"\r\n` +
          `)\r\n` +
          `if defined SOCKET_API_KEY set "SOCKET_API_TOKEN=%SOCKET_API_KEY%"\r\n`
      }
      const cmdContent =
        `@echo off\r\n` +
        `set "PATH=;%PATH%;"\r\n` +
        `set "PATH=%PATH:;${shimDir};=%"\r\n` +
        `set "PATH=%PATH:~1,-1%"\r\n` +
        cmdApiTokenBlock +
        `"${sfwBin}" "${realBin}" %*\r\n`
      const cmdPath = path.join(shimDir, `${cmd}.cmd`)
      if (
        !existsSync(cmdPath) ||
        (await fs.readFile(cmdPath, 'utf8').catch(() => '')) !== cmdContent
      ) {
        await fs.writeFile(cmdPath, cmdContent)
      }
    }
  }

  if (created.length) {
    logger.log(`Shims: ${created.join(', ')}`)
    logger.log(`Shim dir: ${shimDir}`)
    logger.log(`Activate: export PATH="${shimDir}:$PATH"`)
  } else {
    logger.warn('No supported package managers found on PATH.')
  }
  return !!created.length
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

export async function setupZizmor(): Promise<boolean> {
  logger.log('=== Zizmor ===')

  // Check PATH first (e.g. brew install).
  const systemBin = whichSync('zizmor', { nothrow: true })
  if (systemBin && typeof systemBin === 'string') {
    if (await checkZizmorVersion(systemBin)) {
      logger.log(`Found on PATH: ${systemBin} (${releaseTag(ZIZMOR.version)})`)
      return true
    }
    logger.log(
      `Found on PATH but wrong version (need ${releaseTag(ZIZMOR.version)})`,
    )
  }

  // Download archive via dlx (handles caching + checksum).
  const { entry: platformEntry, platformKey } = resolvePlatformEntry(
    ZIZMOR.platforms,
  )
  if (!platformEntry) {
    throw new Error(`Unsupported platform: ${platformKey}`)
  }
  const { asset, integrity: expectedIntegrity } = platformEntry
  const repo = ZIZMOR.repository?.replace(/^[^:]+:/, '') ?? ''
  const url = `https://github.com/${repo}/releases/download/${releaseTag(ZIZMOR.version)}/${asset}`

  logger.log(`Downloading zizmor ${releaseTag(ZIZMOR.version)} (${asset})...`)
  const { binaryPath: archivePath, downloaded } = await downloadBinary({
    url,
    name: `zizmor-${ZIZMOR.version}-${asset}`,
    integrity: expectedIntegrity,
  })
  logger.log(
    downloaded
      ? 'Download complete, checksum verified.'
      : `Using cached archive: ${archivePath}`,
  )

  // Extract binary from the cached archive.
  const ext = process.platform === 'win32' ? '.exe' : ''
  const binPath = path.join(path.dirname(archivePath), `zizmor${ext}`)
  if (existsSync(binPath) && (await checkZizmorVersion(binPath))) {
    logger.log(`Cached: ${binPath} (${releaseTag(ZIZMOR.version)})`)
    return true
  }

  const isZip = asset.endsWith('.zip')
  // mkdtemp is collision-safe, unlike Date.now()-only naming.
  const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zizmor-extract-'))
  try {
    if (isZip) {
      await spawn(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force`,
        ],
        { stdio: 'pipe' },
      )
    } else {
      await spawn('tar', ['xzf', archivePath, '-C', extractDir], {
        stdio: 'pipe',
      })
    }
    const extractedBin = path.join(extractDir, `zizmor${ext}`)
    if (!existsSync(extractedBin)) {
      throw new Error(`Binary not found after extraction: ${extractedBin}`)
    }
    await fs.copyFile(extractedBin, binPath)
    await fs.chmod(binPath, 0o755)
  } finally {
    // Cleanup is fail-open by design — a tempdir we couldn't delete
    // (EPERM / EBUSY / ENOTEMPTY) shouldn't prevent the install from
    // reporting success — but the silent swallow loses the signal,
    // and orphaned tempdirs accumulate on the user's machine. Log
    // and continue.
    await safeDelete(extractDir).catch(e => {
      logger.warn(
        `cleanup of extract dir failed (${extractDir}): ${errorMessage(e)}`,
      )
    })
  }

  logger.log(`Installed to ${binPath}`)
  return true
}

// Check whether the locally-installed skillspector matches the SHA we
// pinned. The CLI doesn't print a SHA via --version (no upstream releases
// exist), so we fall back to comparing the installed package metadata
// version string. Fail-closed: any check error means "not the right version".
export async function checkSkillSpectorVersion(
  binPath: string,
): Promise<boolean> {
  try {
    const result = await spawn(binPath, ['--version'], { stdio: 'pipe' })
    const output = String(result.stdout).trim()
    // skillspector --version prints "skillspector <semver-from-pyproject>".
    // The pinned SHA may correspond to any pyproject version; treat any
    // non-empty output as "installed". The strict version check would
    // require a new upstream invariant.
    return output.length > 0
  } catch {
    return false
  }
}

// SkillSpector — installed from a LOCKED uv project (no pipx). Upstream
// NVIDIA/skillspector has no PyPI release / no GH releases / no tags, so a git
// SHA IS the pin — but a bare `pipx install git+…@sha` re-resolves the whole
// dependency closure freshly on every machine. Instead we ship a uv project
// (`skillspector/pyproject.toml` + `skillspector/uv.lock`) that manifests every
// transitive version; `uv sync --locked` installs that exact closure into the
// project's own `.venv` and FAILS if the lock drifts from the manifest. The
// fleet uv pin (0.11.21) + the lock's `exclude-newer` make the install
// reproducible across machines and across time. The three-way pin (lock ⇔
// pyproject rev ⇔ external-tools.json version) is enforced by
// skillspector-pin-is-consistent.mts.
//
// Requirements:
//   - uv on PATH (the bootstrap installs it). If absent, point at the bootstrap.
//   - Python 3.12+ (upstream requirement) — uv provisions one if missing.
export async function setupSkillSpector(): Promise<boolean> {
  logger.log('=== SkillSpector ===')

  // Pinned SHA — see SKILLSPECTOR.version in external-tools.json. Surfaced in
  // logs + asserted against the lock by skillspector-pin-is-consistent.mts.
  const sha = SKILLSPECTOR.version
  if (!sha) {
    logger.error(
      'skillspector entry in external-tools.json is missing `version`',
    )
    return false
  }

  // The locked uv project sits beside this lib dir's parent (the hook root),
  // next to external-tools.json: setup-security-tools/skillspector/.
  const projectDir = path.join(__dirname, '..', 'skillspector')
  const pyproject = path.join(projectDir, 'pyproject.toml')
  const uvLock = path.join(projectDir, 'uv.lock')
  if (!existsSync(pyproject) || !existsSync(uvLock)) {
    logger.error(
      'SkillSpector uv project is missing its pyproject.toml/uv.lock',
    )
    logger.error(`  where: ${projectDir}`)
    logger.error(
      '  fix:   restore the project files (run `uv lock` to rebuild)',
    )
    return false
  }

  // Resolve uv (the bootstrap installs it to PATH). No auto-bootstrap here —
  // uv provisioning is the from-scratch setup's job, not a security-tool step.
  const uvBin = whichSync('uv', { nothrow: true })
  if (!uvBin || typeof uvBin !== 'string') {
    logger.error('uv not on PATH. Run the from-scratch bootstrap first:')
    logger.error('  pnpm run setup    # installs uv (+ node, pnpm, sfw, …)')
    return false
  }

  // `uv sync --locked` installs the lock's exact closure into the project venv
  // and hard-fails on lock drift — the verification-grade, reproducible path.
  logger.log(`Syncing locked uv project (skillspector@${sha})`)
  try {
    const result = await spawn(
      uvBin,
      ['sync', '--locked', '--project', projectDir],
      { stdio: 'pipe' },
    )
    const stdout = String(result.stdout).trim()
    if (stdout) {
      logger.log(stdout)
    }
  } catch (e) {
    logger.error(`uv sync --locked failed: ${errorMessage(e)}`)
    return false
  }

  // The entry point lands in the project's venv. POSIX: .venv/bin/skillspector;
  // Windows: .venv/Scripts/skillspector.exe.
  const venvBin =
    process.platform === 'win32'
      ? path.join(projectDir, '.venv', 'Scripts', 'skillspector.exe')
      : path.join(projectDir, '.venv', 'bin', 'skillspector')
  if (!existsSync(venvBin)) {
    logger.error(
      'uv sync succeeded but the skillspector entry point is absent.',
    )
    logger.error(`  expected: ${venvBin}`)
    return false
  }
  if (!(await checkSkillSpectorVersion(venvBin))) {
    logger.error(`Installed but --version check failed: ${venvBin}`)
    return false
  }
  logger.log(`Installed at: ${venvBin}`)
  return true
}

async function main(): Promise<void> {
  logger.log('Setting up Socket security tools…')
  logger.log('')

  const apiToken = findApiToken()

  const agentshieldOk = await setupAgentShield()
  logger.log('')
  const zizmorOk = await setupZizmor()
  logger.log('')
  const sfwOk = await setupSfw(apiToken)
  logger.log('')
  // socket-basics SAST + secrets stack + janus (shared wheelhouse) +
  // npm-only tools (cdxgen, synp) — non-fatal if any individual tool
  // fails (the basics workflow degrades cleanly when a scanner is
  // absent; janus is opt-in and mac-only; cdxgen + synp are consumed
  // by socket-cli scan/lockfile codepaths). Install in parallel since
  // they don't share state.
  const [
    actionlintOk,
    cdxgenOk,
    headroomOk,
    janusOk,
    opengrepOk,
    skillspectorOk,
    synpOk,
    trivyOk,
    trufflehogOk,
    uvOk,
  ] = await Promise.all([
    setupActionlint(),
    setupCdxgen(),
    setupHeadroom(HEADROOM.version!),
    setupJanus(),
    setupOpengrep(),
    setupSkillSpector(),
    setupSynp(),
    setupTrivy(),
    setupTrufflehog(),
    setupUv(),
  ])
  logger.log('')

  logger.log('=== Summary ===')
  logger.log(`actionlint:   ${actionlintOk ? 'ready' : 'FAILED'}`)
  logger.log(`AgentShield:  ${agentshieldOk ? 'ready' : 'NOT AVAILABLE'}`)
  logger.log(`cdxgen:       ${cdxgenOk ? 'ready' : 'FAILED'}`)
  // headroom-ai is opt-in like SkillSpector — installs from a locked uv project
  // into the _dlx store (needs uv on PATH). OPTIONAL, not part of allOk.
  logger.log(`headroom-ai:  ${headroomOk ? 'ready' : 'OPTIONAL (uv required)'}`)
  logger.log(`janus:        ${janusOk ? 'ready' : 'FAILED'}`)
  logger.log(`OpenGrep:     ${opengrepOk ? 'ready' : 'FAILED'}`)
  logger.log(`SFW:          ${sfwOk ? 'ready' : 'FAILED'}`)
  // SkillSpector is opt-in — installs from a locked uv project (needs uv on
  // PATH). Don't fail the umbrella run if it isn't installed; surface it as
  // "OPTIONAL" so the operator knows it's an extra they can enable.
  logger.log(
    `SkillSpector: ${skillspectorOk ? 'ready' : 'OPTIONAL (uv required)'}`,
  )
  logger.log(`synp:         ${synpOk ? 'ready' : 'FAILED'}`)
  logger.log(`Trivy:        ${trivyOk ? 'ready' : 'FAILED'}`)
  logger.log(`TruffleHog:   ${trufflehogOk ? 'ready' : 'FAILED'}`)
  logger.log(`uv:           ${uvOk ? 'ready' : 'FAILED'}`)
  logger.log(`Zizmor:       ${zizmorOk ? 'ready' : 'FAILED'}`)

  const allOk =
    actionlintOk &&
    agentshieldOk &&
    cdxgenOk &&
    janusOk &&
    opengrepOk &&
    sfwOk &&
    synpOk &&
    trivyOk &&
    trufflehogOk &&
    uvOk &&
    zizmorOk
  if (allOk) {
    logger.log('')
    logger.log('All security tools ready.')
  } else {
    logger.error('')
    logger.warn('Some tools not available. See above.')
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    logger.error(errorMessage(e))
    process.exitCode = 1
  })
}
