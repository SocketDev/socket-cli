#!/usr/bin/env node
// Setup script for security tools (AgentShield + zizmor).
//
// AgentShield: Scans Claude AI configuration for prompt injection and
// security issues. Already a devDep (ecc-agentshield) — this script
// verifies it is installed and accessible.
//
// Zizmor: Static analysis tool for GitHub Actions workflows. Downloads
// the correct binary for the current platform, verifies its SHA-256
// checksum, and caches it at ~/.socket/zizmor/bin/zizmor.

import { createHash } from 'node:crypto'
import { existsSync, createReadStream, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib/bin'
import { httpDownload } from '@socketsecurity/lib/http-request'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { getSocketHomePath } from '@socketsecurity/lib/paths/socket'
import { spawn, spawnSync } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const ZIZMOR_VERSION = '1.23.1'

const ZIZMOR_CHECKSUMS: Record<string, string> = {
  __proto__: null as unknown as string,
  'zizmor-aarch64-apple-darwin.tar.gz':
    '2632561b974c69f952258c1ab4b7432d5c7f92e555704155c3ac28a2910bd717',
  'zizmor-aarch64-unknown-linux-gnu.tar.gz':
    '3725d7cd7102e4d70827186389f7d5930b6878232930d0a3eb058d7e5b47e658',
  'zizmor-x86_64-apple-darwin.tar.gz':
    '89d5ed42081dd9d0433a10b7545fac42b35f1f030885c278b9712b32c66f2597',
  'zizmor-x86_64-pc-windows-msvc.zip':
    '33c2293ff02834720dd7cd8b47348aafb2e95a19bdc993c0ecaca9c804ade92a',
  'zizmor-x86_64-unknown-linux-gnu.tar.gz':
    '67a8df0a14352dd81882e14876653d097b99b0f4f6b6fe798edc0320cff27aff',
}

const ASSET_MAP: Record<string, string> = {
  __proto__: null as unknown as string,
  'darwin-arm64': 'zizmor-aarch64-apple-darwin.tar.gz',
  'darwin-x64': 'zizmor-x86_64-apple-darwin.tar.gz',
  'linux-arm64': 'zizmor-aarch64-unknown-linux-gnu.tar.gz',
  'linux-x64': 'zizmor-x86_64-unknown-linux-gnu.tar.gz',
  'win32-x64': 'zizmor-x86_64-pc-windows-msvc.zip',
}

function getZizmorBinDir(): string {
  return path.join(getSocketHomePath(), 'zizmor', 'bin')
}

function getZizmorBinPath(): string {
  const ext = process.platform === 'win32' ? '.exe' : ''
  return path.join(getZizmorBinDir(), `zizmor${ext}`)
}

function getAssetName(): string {
  const key = `${process.platform}-${process.arch}`
  const asset = ASSET_MAP[key]
  if (!asset) {
    throw new Error(`Unsupported platform: ${key}`)
  }
  return asset
}

function getDownloadUrl(asset: string): string {
  return `https://github.com/woodruffw/zizmor/releases/download/v${ZIZMOR_VERSION}/${asset}`
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk: Buffer) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

function checkAgentShield(): boolean {
  logger.log('Checking AgentShield...')

  // Check if agentshield is available via PATH or pnpm.
  const agentshieldPath = whichSync('agentshield', { nothrow: true })
  if (agentshieldPath && typeof agentshieldPath === 'string') {
    const result = spawnSync(agentshieldPath, ['--version'], {
      stdio: 'pipe',
    })
    const version =
      typeof result.stdout === 'string'
        ? result.stdout.trim()
        : result.stdout.toString().trim()
    logger.log(`AgentShield found: ${agentshieldPath} (${version})`)
    return true
  }

  logger.warn(
    'AgentShield not found. Run "pnpm install" to install ecc-agentshield.',
  )
  return false
}

async function checkZizmorVersion(binPath: string): Promise<boolean> {
  try {
    const result = await spawn(binPath, ['--version'], { stdio: 'pipe' })
    const output =
      typeof result.stdout === 'string'
        ? result.stdout.trim()
        : result.stdout.toString().trim()
    // Output format: "zizmor 1.23.1" or just "1.23.1".
    return output.includes(ZIZMOR_VERSION)
  } catch {
    return false
  }
}

async function extractTarball(
  tarballPath: string,
  destDir: string,
): Promise<void> {
  await spawn('tar', ['xzf', tarballPath, '-C', destDir], { stdio: 'pipe' })
}

async function extractZip(
  zipPath: string,
  destDir: string,
): Promise<void> {
  // Use PowerShell on Windows for zip extraction.
  await spawn(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
    ],
    { stdio: 'pipe' },
  )
}

async function setupZizmor(): Promise<boolean> {
  logger.log('Checking zizmor...')

  // Check if zizmor is already available on PATH (e.g. via brew).
  const systemZizmor = whichSync('zizmor', { nothrow: true })
  if (systemZizmor && typeof systemZizmor === 'string') {
    const versionOk = await checkZizmorVersion(systemZizmor)
    if (versionOk) {
      logger.log(`zizmor found on PATH: ${systemZizmor} (v${ZIZMOR_VERSION})`)
      return true
    }
    logger.log(
      `zizmor found on PATH but version mismatch (expected v${ZIZMOR_VERSION})`,
    )
  }

  // Check if cached binary exists and matches expected version.
  const binPath = getZizmorBinPath()
  if (existsSync(binPath)) {
    const versionOk = await checkZizmorVersion(binPath)
    if (versionOk) {
      logger.log(`zizmor already cached at ${binPath} (v${ZIZMOR_VERSION})`)
      return true
    }
    logger.log('Cached zizmor binary has wrong version, re-downloading...')
  }

  // Determine asset and checksum.
  const asset = getAssetName()
  const expectedSha256 = ZIZMOR_CHECKSUMS[asset]
  if (!expectedSha256) {
    throw new Error(`No checksum for asset: ${asset}`)
  }
  const url = getDownloadUrl(asset)
  const isZip = asset.endsWith('.zip')

  logger.log(`Downloading zizmor v${ZIZMOR_VERSION}...`)
  logger.log(`Asset: ${asset}`)

  // Download tarball to temp location with SHA-256 verification.
  const tmpDir = tmpdir()
  const tmpFile = path.join(tmpDir, `zizmor-download-${Date.now()}-${asset}`)

  try {
    await httpDownload(url, tmpFile, {
      sha256: expectedSha256,
      retries: 2,
      retryDelay: 1_000,
      timeout: 120_000,
    })
    logger.log('Download complete, checksum verified.')

    // Double-check checksum (httpDownload already verifies, but belt-and-suspenders).
    const actualSha256 = await sha256File(tmpFile)
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`,
      )
    }

    // Extract to temp directory.
    const extractDir = path.join(tmpDir, `zizmor-extract-${Date.now()}`)
    await fs.mkdir(extractDir, { recursive: true })

    if (isZip) {
      await extractZip(tmpFile, extractDir)
    } else {
      await extractTarball(tmpFile, extractDir)
    }

    // Find the zizmor binary in the extracted files.
    const ext = process.platform === 'win32' ? '.exe' : ''
    const extractedBin = path.join(extractDir, `zizmor${ext}`)
    if (!existsSync(extractedBin)) {
      throw new Error(
        `Expected binary not found at ${extractedBin} after extraction`,
      )
    }

    // Move to final destination.
    const binDir = getZizmorBinDir()
    await fs.mkdir(binDir, { recursive: true })
    await fs.copyFile(extractedBin, binPath)
    await fs.chmod(binPath, 0o755)

    // Clean up temp files.
    await fs.rm(extractDir, { recursive: true, force: true })

    logger.log(`Installed zizmor to ${binPath}`)

    // Verify installation.
    const versionOk = await checkZizmorVersion(binPath)
    if (!versionOk) {
      throw new Error('Installed zizmor binary failed version check')
    }

    logger.log(`zizmor v${ZIZMOR_VERSION} ready.`)
    return true
  } finally {
    // Clean up downloaded tarball.
    if (existsSync(tmpFile)) {
      await fs.unlink(tmpFile).catch(() => {})
    }
  }
}

async function main(): Promise<void> {
  logger.log('Setting up security tools...')
  logger.log('')

  const agentshieldOk = checkAgentShield()
  logger.log('')

  const zizmorOk = await setupZizmor()
  logger.log('')

  // Summary.
  logger.log('=== Setup Summary ===')
  logger.log(
    `AgentShield: ${agentshieldOk ? 'ready' : 'NOT AVAILABLE (run pnpm install)'}`,
  )
  logger.log(`zizmor:      ${zizmorOk ? 'ready' : 'FAILED'}`)
  logger.log('')

  if (agentshieldOk && zizmorOk) {
    logger.log('All security tools are ready.')
  } else {
    logger.warn('Some tools are not available. See above for details.')
  }
}

main().catch((e: unknown) => {
  logger.error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})
