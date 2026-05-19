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
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { PackageURL } from '@socketregistry/packageurl-js-stable'
import { Type } from '@sinclair/typebox'

import { whichSync } from '@socketsecurity/lib-stable/bin'
import { downloadBinary } from '@socketsecurity/lib-stable/dlx/binary'
import { downloadPackage } from '@socketsecurity/lib-stable/dlx/package'
import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { safeDelete } from '@socketsecurity/lib-stable/fs'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { getSocketHomePath } from '@socketsecurity/lib-stable/paths/socket'
import { spawn } from '@socketsecurity/lib-stable/spawn'
import { parseSchema } from '@socketsecurity/lib-stable/schema/parse'

const logger = getDefaultLogger()

// ── Tool config loaded from external-tools.json (self-contained) ──

const checksumEntrySchema = Type.Object({
  asset: Type.String(),
  sha256: Type.String(),
})

const toolSchema = Type.Object({
  description: Type.Optional(Type.String()),
  version: Type.Optional(Type.String()),
  purl: Type.Optional(Type.String()),
  integrity: Type.Optional(Type.String()),
  repository: Type.Optional(Type.String()),
  release: Type.Optional(Type.String()),
  checksums: Type.Optional(Type.Record(Type.String(), checksumEntrySchema)),
  ecosystems: Type.Optional(Type.Array(Type.String())),
})

const configSchema = Type.Object({
  description: Type.Optional(Type.String()),
  tools: Type.Record(Type.String(), toolSchema),
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// external-tools.json lives one level up at the hook root
// (.claude/hooks/setup-security-tools/external-tools.json) — keep it
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

// ── Shared helpers ──

function findApiToken(): string | undefined {
  // SOCKET_API_KEY is the primary slot (universally supported across Socket
  // tools); SOCKET_API_TOKEN is the forward-canonical name accepted as a
  // secondary read.
  const envToken =
    process.env['SOCKET_API_KEY'] ?? process.env['SOCKET_API_TOKEN']
  if (envToken) return envToken
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
  for (const filename of ['.env.local', '.env']) {
    const filepath = path.join(projectDir, filename)
    if (existsSync(filepath)) {
      try {
        const content = readFileSync(filepath, 'utf8')
        const match =
          /^SOCKET_API_KEY\s*=\s*(.+)$/m.exec(content) ??
          /^SOCKET_API_TOKEN\s*=\s*(.+)$/m.exec(content)
        if (match) {
          return match[1]!
            .replace(/\s*#.*$/, '') // Strip inline comments.
            .trim() // Strip whitespace before quote removal.
            .replace(/^["']|["']$/g, '') // Strip surrounding quotes.
        }
      } catch (e) {
        // We already checked existsSync; ENOENT here means a race with
        // an external delete (rare, ignorable). Anything else (EACCES,
        // EISDIR, decode failure) is a real signal — log it so the
        // operator can fix the perms / encoding instead of wondering
        // why their .env-stored token isn't being picked up.
        const code = (e as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') {
          const msg = e instanceof Error ? e.message : String(e)
          logger.warn(`could not read ${filepath}: ${msg}`)
        }
      }
    }
  }
  return undefined
}

// ── AgentShield ──

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

  logger.log(`Installing ${packageSpec} via dlx...`)
  const { binaryPath, installed } = await downloadPackage({
    package: packageSpec,
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
        version?: unknown
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

// ── Generic npm-tool installer (shared by cdxgen + synp) ──

interface NpmToolInstallOptions {
  /** Logical tool name (used for log banner + bin name). */
  readonly name: string
  /** Human-readable display name for log output. */
  readonly displayName: string
  /** Tool config entry from external-tools.json (must carry `purl`). */
  readonly tool: (typeof config.tools)[string]
}

/**
 * Install an npm-only tool via dlx. Mirrors the upper half of
 * `setupAgentShield()` — purl → package spec → `downloadPackage`. No
 * version-mismatch verification: the dlx layer SRI-verifies the tarball
 * against the `integrity` from external-tools.json, which is the
 * authoritative answer (binary --version self-reports can drift from
 * package.json — see the AgentShield comment for the documented case).
 */
async function setupNpmTool(opts: NpmToolInstallOptions): Promise<boolean> {
  const { displayName, name, tool } = opts
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
  logger.log(`Installing ${packageSpec} via dlx...`)
  const { binaryPath, installed } = await downloadPackage({
    package: packageSpec,
    binaryName: name,
  })
  logger.log(
    installed
      ? `Installed: ${binaryPath}${version ? ` (${version})` : ''}`
      : `Cached: ${binaryPath}${version ? ` (${version})` : ''}`,
  )
  return true
}

// ── cdxgen ──

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

// ── synp ──

export async function setupSynp(): Promise<boolean> {
  return setupNpmTool({
    name: 'synp',
    displayName: 'synp',
    tool: SYNP,
  })
}

// ── Zizmor ──

async function checkZizmorVersion(binPath: string): Promise<boolean> {
  try {
    const result = await spawn(binPath, ['--version'], { stdio: 'pipe' })
    const output =
      typeof result.stdout === 'string'
        ? result.stdout.trim()
        : result.stdout.toString().trim()
    return ZIZMOR.version ? output.includes(ZIZMOR.version) : false
  } catch {
    return false
  }
}

export async function setupZizmor(): Promise<boolean> {
  logger.log('=== Zizmor ===')

  // Check PATH first (e.g. brew install).
  const systemBin = whichSync('zizmor', { nothrow: true })
  if (systemBin && typeof systemBin === 'string') {
    if (await checkZizmorVersion(systemBin)) {
      logger.log(`Found on PATH: ${systemBin} (v${ZIZMOR.version})`)
      return true
    }
    logger.log(`Found on PATH but wrong version (need v${ZIZMOR.version})`)
  }

  // Download archive via dlx (handles caching + checksum).
  const platformKey = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
  const platformEntry = ZIZMOR.checksums?.[platformKey]
  if (!platformEntry) {
    throw new Error(`Unsupported platform: ${platformKey}`)
  }
  const { asset, sha256: expectedSha } = platformEntry
  const repo = ZIZMOR.repository?.replace(/^[^:]+:/, '') ?? ''
  const url = `https://github.com/${repo}/releases/download/v${ZIZMOR.version}/${asset}`

  logger.log(`Downloading zizmor v${ZIZMOR.version} (${asset})...`)
  const { binaryPath: archivePath, downloaded } = await downloadBinary({
    url,
    name: `zizmor-${ZIZMOR.version}-${asset}`,
    sha256: expectedSha,
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
    logger.log(`Cached: ${binPath} (v${ZIZMOR.version})`)
    return true
  }

  const isZip = asset.endsWith('.zip')
  // mkdtemp is collision-safe, unlike Date.now()-only naming.
  const extractDir = await fs.mkdtemp(path.join(tmpdir(), 'zizmor-extract-'))
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
    if (!existsSync(extractedBin))
      throw new Error(`Binary not found after extraction: ${extractedBin}`)
    await fs.copyFile(extractedBin, binPath)
    await fs.chmod(binPath, 0o755)
  } finally {
    // Cleanup is fail-open by design — a tempdir we couldn't delete
    // (EPERM / EBUSY / ENOTEMPTY) shouldn't prevent the install from
    // reporting success — but the silent swallow loses the signal,
    // and orphaned tempdirs accumulate on the user's machine. Log
    // and continue.
    await safeDelete(extractDir).catch(e => {
      const msg = e instanceof Error ? e.message : String(e)
      logger.warn(`cleanup of extract dir failed (${extractDir}): ${msg}`)
    })
  }

  logger.log(`Installed to ${binPath}`)
  return true
}

// ── Generic GitHub-release tool installer ──

type ToolEntry = (typeof config.tools)[string]

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
async function installGitHubReleaseTool(
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

  const platformKey = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
  const platformEntry = tool.checksums?.[platformKey]
  if (!platformEntry) {
    logger.warn(`${displayName}: unsupported platform ${platformKey}`)
    return false
  }
  const { asset, sha256: expectedSha } = platformEntry
  const repo = tool.repository?.replace(/^[^:]+:/, '') ?? ''
  // Most GitHub release URLs use a `v` prefix on the tag (`v1.2.3`); a
  // few projects don't (`uv` uses `0.10.11`). The tool config's
  // `version` field is the bare semver — prepend `v` unless it already
  // starts with one. astral-sh/uv is the lone exception and is handled
  // by setupUv() passing the literal tag.
  const tagPrefix = tool.version?.startsWith('v') ? '' : 'v'
  const tag = `${tagPrefix}${tool.version}`
  const url = `https://github.com/${repo}/releases/download/${tag}/${asset}`

  logger.log(`Downloading ${displayName} v${tool.version} (${asset})...`)
  const { binaryPath: downloadPath, downloaded } = await downloadBinary({
    url,
    name: `${name}-${tool.version}-${asset}`,
    sha256: expectedSha,
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

  const extractDir = await fs.mkdtemp(path.join(tmpdir(), `${name}-extract-`))
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
      const msg = e instanceof Error ? e.message : String(e)
      logger.warn(`cleanup of extract dir failed (${extractDir}): ${msg}`)
    })
  }

  logger.log(`Installed to ${finalBinPath}`)
  return true
}

// ── TruffleHog ──

export async function setupTrufflehog(): Promise<boolean> {
  return installGitHubReleaseTool({
    name: 'trufflehog',
    displayName: 'TruffleHog',
    tool: TRUFFLEHOG,
    binaryNameInArchive: 'trufflehog',
    finalBinaryName: 'trufflehog',
  })
}

// ── Trivy ──

export async function setupTrivy(): Promise<boolean> {
  return installGitHubReleaseTool({
    name: 'trivy',
    displayName: 'Trivy',
    tool: TRIVY,
    binaryNameInArchive: 'trivy',
    finalBinaryName: 'trivy',
  })
}

// ── OpenGrep ──

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

// ── janus ──

export async function setupJanus(): Promise<boolean> {
  // janus ships darwin-arm64 only at v1.22.0. On every other platform,
  // skip the install with a quiet log rather than emitting a warning —
  // janus isn't a fleet-critical dependency, just a tool some Socket
  // workflows opt into. Install lands in the shared
  // ~/.socket/_wheelhouse/janus/<version>/ dir so every fleet member's
  // hook reuses the same binary.
  const platformKey = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
  if (!JANUS.checksums?.[platformKey]) {
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
  return installGitHubReleaseTool({
    name: 'janus',
    displayName: 'janus',
    tool: JANUS,
    binaryNameInArchive: 'janus',
    finalBinaryName: 'janus',
    installDir,
  })
}

// ── uv ──

export async function setupUv(): Promise<boolean> {
  // astral-sh/uv tags releases without a `v` prefix (`0.10.11`, not
  // `v0.10.11`), so the generic helper's `v`-prepend would 404. The
  // tarball also wraps the binary one level deep: e.g.
  // `uv-x86_64-apple-darwin/uv`. Pin the tag literally and tell the
  // helper which subdirectory holds the binary.
  const platformKey = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
  const platformEntry = UV.checksums?.[platformKey]
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
 * Variant of `installGitHubReleaseTool` for projects that don't tag with a `v`
 * prefix (astral-sh/uv). Takes an explicit `tag` field instead of synthesizing
 * one from `tool.version`.
 */
async function installGitHubReleaseToolWithTag(
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

  const platformKey = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
  const platformEntry = tool.checksums?.[platformKey]
  if (!platformEntry) {
    logger.warn(`${displayName}: unsupported platform ${platformKey}`)
    return false
  }
  const { asset, sha256: expectedSha } = platformEntry
  const repo = tool.repository?.replace(/^[^:]+:/, '') ?? ''
  const url = `https://github.com/${repo}/releases/download/${tag}/${asset}`

  logger.log(`Downloading ${displayName} ${tag} (${asset})...`)
  const { binaryPath: downloadPath, downloaded } = await downloadBinary({
    url,
    name: `${name}-${tag}-${asset}`,
    sha256: expectedSha,
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
  const extractDir = await fs.mkdtemp(path.join(tmpdir(), `${name}-extract-`))
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
      const msg = e instanceof Error ? e.message : String(e)
      logger.warn(`cleanup of extract dir failed (${extractDir}): ${msg}`)
    })
  }

  logger.log(`Installed to ${finalBinPath}`)
  return true
}

// ── SFW ──

export async function setupSfw(apiToken: string | undefined): Promise<boolean> {
  const isEnterprise = !!apiToken
  const sfwConfig = isEnterprise ? SFW_ENTERPRISE : SFW_FREE
  logger.log(
    `=== Socket Firewall (${isEnterprise ? 'enterprise' : 'free'}) ===`,
  )

  // Platform.
  const platformKey = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
  const platformEntry = sfwConfig.checksums?.[platformKey]
  if (!platformEntry) {
    throw new Error(`Unsupported platform: ${platformKey}`)
  }

  // Checksum + asset.
  const { asset, sha256 } = platformEntry
  const repo = sfwConfig.repository?.replace(/^[^:]+:/, '') ?? ''
  const url = `https://github.com/${repo}/releases/download/${sfwConfig.version}/${asset}`
  const binaryName = isEnterprise ? 'sfw' : 'sfw-free'

  // Download (with cache + checksum).
  const { binaryPath, downloaded } = await downloadBinary({
    url,
    name: binaryName,
    sha256,
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
  for (const cmd of ecosystems) {
    let realBin = whichSync(cmd, { nothrow: true, path: cleanPath })
    if (!realBin || typeof realBin !== 'string') continue
    realBin = normalizePath(realBin)

    // Bash shim (macOS/Linux/Windows Git Bash).
    const bashLines = [
      '#!/bin/bash',
      `export PATH="$(echo "$PATH" | tr ':' '\\n' | grep -vxF '${shimDir}' | paste -sd: -)"`,
    ]
    if (isEnterprise) {
      // Read API token from env at runtime — never embed secrets in
      // scripts. SOCKET_API_KEY is the primary slot (universally
      // supported); SOCKET_API_TOKEN is the forward-canonical name
      // accepted as a secondary read. Whichever name is set gets
      // exported under both so downstream tools see the value
      // regardless of which name they read.
      bashLines.push(
        'if [ -z "$SOCKET_API_KEY" ] && [ -n "$SOCKET_API_TOKEN" ]; then',
        '  SOCKET_API_KEY="$SOCKET_API_TOKEN"',
        'fi',
        'if [ -z "$SOCKET_API_KEY" ]; then',
        '  for f in .env.local .env; do',
        '    if [ -f "$f" ]; then',
        '      _val="$(grep -m1 "^SOCKET_API_KEY\\s*=" "$f" | sed "s/^[^=]*=\\s*//" | sed "s/\\s*#.*//" | sed "s/^[\"\\x27]\\(.*\\)[\"\\x27]$/\\1/")"',
        '      if [ -z "$_val" ]; then',
        '        _val="$(grep -m1 "^SOCKET_API_TOKEN\\s*=" "$f" | sed "s/^[^=]*=\\s*//" | sed "s/\\s*#.*//" | sed "s/^[\"\\x27]\\(.*\\)[\"\\x27]$/\\1/")"',
        '      fi',
        '      if [ -n "$_val" ]; then SOCKET_API_KEY="$_val"; break; fi',
        '    fi',
        '  done',
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
        // Read API token from .env files at runtime — mirrors the bash
        // shim logic. SOCKET_API_KEY is the primary slot (universally
        // supported); SOCKET_API_TOKEN is the forward-canonical name
        // accepted as a secondary read.
        cmdApiTokenBlock =
          `if not defined SOCKET_API_KEY (\r\n` +
          `  if defined SOCKET_API_TOKEN set "SOCKET_API_KEY=%SOCKET_API_TOKEN%"\r\n` +
          `)\r\n` +
          `if not defined SOCKET_API_KEY (\r\n` +
          `  for %%F in (.env.local .env) do (\r\n` +
          `    if exist "%%F" (\r\n` +
          `      for /f "tokens=1,* delims==" %%A in ('findstr /b "SOCKET_API_KEY" "%%F"') do (\r\n` +
          `        set "SOCKET_API_KEY=%%B"\r\n` +
          `      )\r\n` +
          `      for /f "tokens=1,* delims==" %%A in ('findstr /b "SOCKET_API_TOKEN" "%%F"') do (\r\n` +
          `        if not defined SOCKET_API_KEY set "SOCKET_API_KEY=%%B"\r\n` +
          `      )\r\n` +
          `    )\r\n` +
          `  )\r\n` +
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

// ── Main ──

async function main(): Promise<void> {
  logger.log('Setting up Socket security tools...\n')

  const apiToken = findApiToken()

  const agentshieldOk = await setupAgentShield()
  logger.log('')
  const zizmorOk = await setupZizmor()
  logger.log('')
  const sfwOk = await setupSfw(apiToken)
  logger.log('')
  // socket-basics SAST + secrets stack + janus (shared wheelhouse) —
  // non-fatal if any individual tool fails (the basics workflow degrades
  // cleanly when a scanner is absent; janus is opt-in and mac-only).
  // Install in parallel since they don't share state.
  const [trufflehogOk, trivyOk, opengrepOk, uvOk, janusOk] = await Promise.all([
    setupTrufflehog(),
    setupTrivy(),
    setupOpengrep(),
    setupUv(),
    setupJanus(),
  ])
  logger.log('')

  logger.log('=== Summary ===')
  logger.log(`AgentShield: ${agentshieldOk ? 'ready' : 'NOT AVAILABLE'}`)
  logger.log(`Zizmor:      ${zizmorOk ? 'ready' : 'FAILED'}`)
  logger.log(`SFW:         ${sfwOk ? 'ready' : 'FAILED'}`)
  logger.log(`TruffleHog:  ${trufflehogOk ? 'ready' : 'FAILED'}`)
  logger.log(`Trivy:       ${trivyOk ? 'ready' : 'FAILED'}`)
  logger.log(`OpenGrep:    ${opengrepOk ? 'ready' : 'FAILED'}`)
  logger.log(`uv:          ${uvOk ? 'ready' : 'FAILED'}`)
  logger.log(`janus:       ${janusOk ? 'ready' : 'FAILED'}`)

  const allOk =
    agentshieldOk &&
    zizmorOk &&
    sfwOk &&
    trufflehogOk &&
    trivyOk &&
    opengrepOk &&
    uvOk &&
    janusOk
  if (allOk) {
    logger.log('\nAll security tools ready.')
  } else {
    logger.warn('\nSome tools not available. See above.')
  }
}

main().catch((e: unknown) => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
