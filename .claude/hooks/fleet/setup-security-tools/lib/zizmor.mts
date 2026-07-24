// Zizmor installer — static analysis for GitHub Actions workflows. Downloads
// the correct archive, verifies SHA-256, extracts the binary. Lives in its
// own file because installers.mts is at the 500-line soft cap; zizmor's
// PATH-version-check + custom extraction don't fit the generic
// github-release.mts flow (no bare-binary path, PATH hit needs a version
// check, not just an existence check).

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib-stable/bin/which'
import { downloadBinary } from '@socketsecurity/lib-stable/dlx/binary'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  checkZizmorVersion,
  releaseTag,
  resolvePlatformEntry,
} from './installers.mts'
import { ZIZMOR } from './tool-config.mts'

const logger = getDefaultLogger()

export async function runSetupZizmor(): Promise<boolean> {
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
