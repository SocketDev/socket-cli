// GitHub-release install workflows — PATH check → download + sha256-verify →
// cache hit / extract → chmod 0o755. Lives in its own file because
// installers.mts is at the 500-line soft cap; this is the "install a tool
// shipped as a GitHub release asset" domain, used by every binary-release
// tool (actionlint, cdxgen, janus, opengrep, trivy, trufflehog, uv).

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { downloadBinary } from '@socketsecurity/lib-stable/dlx/binary'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { whichSync } from '@socketsecurity/lib-stable/bin/which'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { releaseTag, resolvePlatformEntry } from './installers.mts'
import type { ToolEntry } from './tool-config.mts'

const logger = getDefaultLogger()

export interface InstallGitHubToolOptions {
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
export async function runInstallGitHubReleaseTool(
  // oxlint-disable-next-line no-shadow -- required config param name matches the module-level tool-manifest `config` by convention
  config: InstallGitHubToolOptions,
): Promise<boolean> {
  const cfg = { __proto__: null, ...config } as InstallGitHubToolOptions
  const { binaryNameInArchive, displayName, finalBinaryName, name, tool } = cfg
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
  const finalDir = cfg.installDir ?? path.dirname(downloadPath)
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
    const extractedRel = cfg.pathInArchive
      ? path.join(cfg.pathInArchive, `${binaryNameInArchive}${ext}`)
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
 * Variant of `runInstallGitHubReleaseTool` for projects that don't tag with a
 * `v` prefix (astral-sh/uv). Takes an explicit `tag` field instead of
 * synthesizing one from `tool.version`.
 */
export async function runInstallGitHubReleaseToolWithTag(
  // oxlint-disable-next-line no-shadow -- required config param name matches the module-level tool-manifest `config` by convention
  config: InstallGitHubToolOptions & { tag: string },
): Promise<boolean> {
  const cfg = { __proto__: null, ...config } as InstallGitHubToolOptions & {
    tag: string
  }
  const { binaryNameInArchive, displayName, finalBinaryName, name, tag, tool } =
    cfg
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
    const extractedRel = cfg.pathInArchive
      ? path.join(cfg.pathInArchive, `${binaryNameInArchive}${ext}`)
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
