#!/usr/bin/env node
// Update script for Socket security tools.
//
// Checks for new releases of zizmor and sfw, respecting the pnpm
// minimumReleaseAge cooldown (read from pnpm-workspace.yaml) for third-party tools.
// Socket-owned tools (sfw) are excluded from cooldown.
//
// Updates embedded checksums in index.mts when new versions are found.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { httpDownload, httpRequest } from '@socketsecurity/lib/http-request'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const INDEX_FILE = path.join(__dirname, 'index.mts')

const MS_PER_MINUTE = 60_000
const DEFAULT_COOLDOWN_MINUTES = 10_080

// Read minimumReleaseAge from pnpm-workspace.yaml (minutes → ms).
function readCooldownMs(): number {
  let dir = __dirname
  for (let i = 0; i < 10; i += 1) {
    const candidate = path.join(dir, 'pnpm-workspace.yaml')
    if (existsSync(candidate)) {
      try {
        const content = readFileSync(candidate, 'utf8')
        const match = /^minimumReleaseAge:\s*(\d+)/m.exec(content)
        if (match) return Number(match[1]) * MS_PER_MINUTE
      } catch {
        // Read error.
      }
      logger.warn(`Could not read minimumReleaseAge from ${candidate}, defaulting to ${DEFAULT_COOLDOWN_MINUTES} minutes`)
      return DEFAULT_COOLDOWN_MINUTES * MS_PER_MINUTE
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  logger.warn(`pnpm-workspace.yaml not found, defaulting cooldown to ${DEFAULT_COOLDOWN_MINUTES} minutes`)
  return DEFAULT_COOLDOWN_MINUTES * MS_PER_MINUTE
}

const COOLDOWN_MS = readCooldownMs()

// ── GitHub API helpers ──

interface GhRelease {
  assets: GhAsset[]
  published_at: string
  tag_name: string
}

interface GhAsset {
  browser_download_url: string
  name: string
}

async function ghApiLatestRelease(repo: string): Promise<GhRelease> {
  const result = await spawn(
    'gh',
    ['api', `repos/${repo}/releases/latest`, '--cache', '1h'],
    { stdio: 'pipe' },
  )
  const stdout =
    typeof result.stdout === 'string'
      ? result.stdout
      : result.stdout.toString()
  return JSON.parse(stdout) as GhRelease
}

function isOlderThanCooldown(publishedAt: string): boolean {
  const published = new Date(publishedAt).getTime()
  return Date.now() - published >= COOLDOWN_MS
}

function versionFromTag(tag: string): string {
  return tag.replace(/^v/, '')
}

// ── Checksum computation ──

async function computeSha256(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath)
  return createHash('sha256').update(content).digest('hex')
}

async function downloadAndHash(url: string): Promise<string> {
  const tmpFile = path.join(tmpdir(), `security-tools-update-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  try {
    await httpDownload(url, tmpFile, { retries: 2 })
    return await computeSha256(tmpFile)
  } finally {
    await fs.unlink(tmpFile).catch(() => {})
  }
}

// ── Index file manipulation ──

function readIndexFile(): string {
  return readFileSync(INDEX_FILE, 'utf8')
}

async function writeIndexFile(content: string): Promise<void> {
  await fs.writeFile(INDEX_FILE, content, 'utf8')
}

function replaceConstant(
  source: string,
  name: string,
  oldValue: string,
  newValue: string,
): string {
  const escaped = oldValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(const ${name}\\s*=\\s*')${escaped}'`)
  return source.replace(pattern, `$1${newValue}'`)
}

function replaceChecksumValue(
  source: string,
  assetName: string,
  oldHash: string,
  newHash: string,
): string {
  // Match the specific asset line in a checksums object.
  const escaped = assetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `('${escaped}':\\s*\\n\\s*')${oldHash}'`,
  )
  if (pattern.test(source)) {
    return source.replace(pattern, `$1${newHash}'`)
  }
  // Single-line format: 'asset-name': 'hash',
  const singleLine = new RegExp(
    `('${escaped}':\\s*')${oldHash}'`,
  )
  return source.replace(singleLine, `$1${newHash}'`)
}

// ── Zizmor update ──

interface UpdateResult {
  reason: string
  skipped: boolean
  tool: string
  updated: boolean
}

// Map from index.mts asset names to zizmor release asset names.
const ZIZMOR_ASSETS: Record<string, string> = {
  __proto__: null as unknown as string,
  'zizmor-aarch64-apple-darwin.tar.gz':
    'zizmor-aarch64-apple-darwin.tar.gz',
  'zizmor-aarch64-unknown-linux-gnu.tar.gz':
    'zizmor-aarch64-unknown-linux-gnu.tar.gz',
  'zizmor-x86_64-apple-darwin.tar.gz':
    'zizmor-x86_64-apple-darwin.tar.gz',
  'zizmor-x86_64-pc-windows-msvc.zip':
    'zizmor-x86_64-pc-windows-msvc.zip',
  'zizmor-x86_64-unknown-linux-gnu.tar.gz':
    'zizmor-x86_64-unknown-linux-gnu.tar.gz',
}

async function updateZizmor(source: string): Promise<{
  result: UpdateResult
  source: string
}> {
  const tool = 'zizmor'
  logger.log(`=== Checking ${tool} ===`)

  let release: GhRelease
  try {
    release = await ghApiLatestRelease('woodruffw/zizmor')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logger.warn(`Failed to fetch zizmor releases: ${msg}`)
    return {
      result: { tool, skipped: true, updated: false, reason: `API error: ${msg}` },
      source,
    }
  }

  const latestVersion = versionFromTag(release.tag_name)
  // Extract current version from source.
  const currentMatch = /const ZIZMOR_VERSION = '([^']+)'/.exec(source)
  const currentVersion = currentMatch ? currentMatch[1] : ''

  logger.log(`Current: v${currentVersion}, Latest: v${latestVersion}`)

  if (latestVersion === currentVersion) {
    logger.log('Already current.')
    return {
      result: { tool, skipped: false, updated: false, reason: 'already current' },
      source,
    }
  }

  // Respect cooldown for third-party tools.
  if (!isOlderThanCooldown(release.published_at)) {
    const daysOld = ((Date.now() - new Date(release.published_at).getTime()) / 86_400_000).toFixed(1)
    const cooldownDays = (COOLDOWN_MS / 86_400_000).toFixed(0)
    logger.log(`v${latestVersion} is only ${daysOld} days old (need ${cooldownDays}). Skipping.`)
    return {
      result: { tool, skipped: true, updated: false, reason: `too new (${daysOld} days, need ${cooldownDays})` },
      source,
    }
  }

  logger.log(`Updating to v${latestVersion}...`)

  // Try to get checksums from the release's checksums.txt asset first.
  let checksumMap: Record<string, string> | undefined
  const checksumsAsset = release.assets.find(a => a.name === 'checksums.txt')
  if (checksumsAsset) {
    try {
      const resp = await httpRequest(checksumsAsset.browser_download_url)
      if (resp.ok) {
        checksumMap = { __proto__: null } as unknown as Record<string, string>
        for (const line of resp.text().split('\n')) {
          const match = /^([a-f0-9]{64})\s+(.+)$/.exec(line.trim())
          if (match) {
            checksumMap[match[2]!] = match[1]!
          }
        }
      }
    } catch {
      // Fall through to per-asset download.
    }
  }

  // Compute checksums for each platform asset.
  let updated = source
  let allFound = true
  for (const assetName of Object.keys(ZIZMOR_ASSETS)) {
    let newHash: string | undefined

    // Try checksums.txt first.
    if (checksumMap && checksumMap[assetName]) {
      newHash = checksumMap[assetName]
    } else {
      // Download and compute.
      const asset = release.assets.find(a => a.name === assetName)
      if (!asset) {
        logger.warn(`  Asset not found in release: ${assetName}`)
        allFound = false
        continue
      }
      logger.log(`  Computing checksum for ${assetName}...`)
      try {
        newHash = await downloadAndHash(asset.browser_download_url)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.warn(`  Failed to download ${assetName}: ${msg}`)
        allFound = false
        continue
      }
    }

    if (!newHash) {
      allFound = false
      continue
    }

    // Find and replace the old hash.
    const oldHashMatch = new RegExp(
      `'${assetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*\\n\\s*'([a-f0-9]{64})'`,
    ).exec(updated)
    const oldHashSingle = new RegExp(
      `'${assetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*'([a-f0-9]{64})'`,
    ).exec(updated)
    const oldHash = oldHashMatch?.[1] ?? oldHashSingle?.[1]
    if (oldHash && oldHash !== newHash) {
      updated = replaceChecksumValue(updated, assetName, oldHash, newHash)
      logger.log(`  ${assetName}: ${oldHash.slice(0, 12)}... -> ${newHash.slice(0, 12)}...`)
    } else if (oldHash === newHash) {
      logger.log(`  ${assetName}: unchanged`)
    }
  }

  if (!allFound) {
    logger.warn('Some assets could not be verified. Skipping version bump.')
    return {
      result: { tool, skipped: true, updated: false, reason: 'incomplete asset checksums' },
      source,
    }
  }

  // Update version constant.
  updated = replaceConstant(updated, 'ZIZMOR_VERSION', currentVersion!, latestVersion)
  logger.log(`Updated ZIZMOR_VERSION: ${currentVersion} -> ${latestVersion}`)

  return {
    result: { tool, skipped: false, updated: true, reason: `${currentVersion} -> ${latestVersion}` },
    source: updated,
  }
}

// ── SFW update ──

const SFW_FREE_ASSET_NAMES: Record<string, string> = {
  __proto__: null as unknown as string,
  'linux-arm64': 'sfw-free-linux-arm64',
  'linux-x86_64': 'sfw-free-linux-x86_64',
  'macos-arm64': 'sfw-free-macos-arm64',
  'macos-x86_64': 'sfw-free-macos-x86_64',
  'windows-x86_64': 'sfw-free-windows-x86_64.exe',
}

const SFW_ENTERPRISE_ASSET_NAMES: Record<string, string> = {
  __proto__: null as unknown as string,
  'linux-arm64': 'sfw-linux-arm64',
  'linux-x86_64': 'sfw-linux-x86_64',
  'macos-arm64': 'sfw-macos-arm64',
  'macos-x86_64': 'sfw-macos-x86_64',
  'windows-x86_64': 'sfw-windows-x86_64.exe',
}

async function fetchSfwChecksums(
  repo: string,
  label: string,
  assetNames: Record<string, string>,
  currentChecksums: Record<string, string>,
): Promise<{
  checksums: Record<string, string>
  changed: boolean
}> {
  let release: GhRelease
  try {
    release = await ghApiLatestRelease(repo)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logger.warn(`Failed to fetch ${label} releases: ${msg}`)
    return { checksums: currentChecksums, changed: false }
  }

  logger.log(`  ${label}: latest ${release.tag_name} (published ${release.published_at.slice(0, 10)})`)

  const newChecksums: Record<string, string> = { __proto__: null } as unknown as Record<string, string>
  let changed = false

  for (const { 0: platform, 1: assetName } of Object.entries(assetNames)) {
    const asset = release.assets.find(a => a.name === assetName)
    if (!asset) {
      // Use latest/download URL pattern for sfw (uses /releases/latest/download/).
      const url = `https://github.com/${repo}/releases/latest/download/${assetName}`
      logger.log(`    Computing checksum for ${assetName}...`)
      try {
        const hash = await downloadAndHash(url)
        newChecksums[platform] = hash
        if (currentChecksums[platform] !== hash) {
          logger.log(`    ${platform}: ${(currentChecksums[platform] ?? '').slice(0, 12)}... -> ${hash.slice(0, 12)}...`)
          changed = true
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.warn(`    Failed to download ${assetName}: ${msg}`)
        newChecksums[platform] = currentChecksums[platform] ?? ''
      }
    } else {
      logger.log(`    Computing checksum for ${assetName}...`)
      try {
        const hash = await downloadAndHash(asset.browser_download_url)
        newChecksums[platform] = hash
        if (currentChecksums[platform] !== hash) {
          logger.log(`    ${platform}: ${(currentChecksums[platform] ?? '').slice(0, 12)}... -> ${hash.slice(0, 12)}...`)
          changed = true
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.warn(`    Failed to download ${assetName}: ${msg}`)
        newChecksums[platform] = currentChecksums[platform] ?? ''
      }
    }
  }

  return { checksums: newChecksums, changed }
}

function extractChecksums(
  source: string,
  objectName: string,
): Record<string, string> {
  const result: Record<string, string> = { __proto__: null } as unknown as Record<string, string>
  // Find the object in source.
  const objPattern = new RegExp(
    `const ${objectName}[^{]*\\{[^}]*?(?:'([^']+)':\\s*'([a-f0-9]{64})'[,\\s]*)+`,
    's',
  )
  const objMatch = objPattern.exec(source)
  if (!objMatch) return result

  const block = objMatch[0]
  const entryPattern = /'([^']+)':\s*\n?\s*'([a-f0-9]{64})'/g
  let match: RegExpExecArray | null
  while ((match = entryPattern.exec(block)) !== null) {
    if (match[1] !== '__proto__') {
      result[match[1]!] = match[2]!
    }
  }
  return result
}

async function updateSfw(source: string): Promise<{
  results: UpdateResult[]
  source: string
}> {
  logger.log('=== Checking SFW ===')
  // Socket-owned tools: no cooldown.
  logger.log('Socket-owned tool: cooldown excluded.')

  const results: UpdateResult[] = []

  // Extract current checksums from source.
  const currentFree = extractChecksums(source, 'SFW_FREE_CHECKSUMS')
  const currentEnterprise = extractChecksums(source, 'SFW_ENTERPRISE_CHECKSUMS')

  // Check sfw-free.
  logger.log('')
  const free = await fetchSfwChecksums(
    'SocketDev/sfw-free',
    'sfw-free',
    SFW_FREE_ASSET_NAMES,
    currentFree,
  )

  let updated = source
  if (free.changed) {
    for (const { 0: platform, 1: hash } of Object.entries(free.checksums)) {
      if (currentFree[platform] && currentFree[platform] !== hash) {
        updated = replaceChecksumValue(updated, platform, currentFree[platform]!, hash)
      }
    }
    results.push({ tool: 'sfw-free', skipped: false, updated: true, reason: 'checksums updated' })
  } else {
    results.push({ tool: 'sfw-free', skipped: false, updated: false, reason: 'already current' })
  }

  // Check sfw enterprise.
  logger.log('')
  const enterprise = await fetchSfwChecksums(
    'SocketDev/firewall-release',
    'sfw-enterprise',
    SFW_ENTERPRISE_ASSET_NAMES,
    currentEnterprise,
  )

  if (enterprise.changed) {
    for (const { 0: platform, 1: hash } of Object.entries(enterprise.checksums)) {
      if (currentEnterprise[platform] && currentEnterprise[platform] !== hash) {
        updated = replaceChecksumValue(updated, platform, currentEnterprise[platform]!, hash)
      }
    }
    results.push({ tool: 'sfw-enterprise', skipped: false, updated: true, reason: 'checksums updated' })
  } else {
    results.push({ tool: 'sfw-enterprise', skipped: false, updated: false, reason: 'already current' })
  }

  return { results, source: updated }
}

// ── Main ──

async function main(): Promise<void> {
  logger.log('Checking for security tool updates...\n')

  let source = readIndexFile()
  const allResults: UpdateResult[] = []

  // 1. Check zizmor (third-party, respects cooldown).
  const zizmor = await updateZizmor(source)
  source = zizmor.source
  allResults.push(zizmor.result)
  logger.log('')

  // 2. Check sfw (Socket-owned, no cooldown).
  const sfw = await updateSfw(source)
  source = sfw.source
  allResults.push(...sfw.results)
  logger.log('')

  // Write updated index.mts if anything changed.
  const anyUpdated = allResults.some(r => r.updated)
  if (anyUpdated) {
    await writeIndexFile(source)
    logger.log('Updated index.mts with new checksums.\n')
  }

  // Report.
  logger.log('=== Summary ===')
  for (const r of allResults) {
    const status = r.updated ? 'UPDATED' : r.skipped ? 'SKIPPED' : 'CURRENT'
    logger.log(`  ${r.tool}: ${status} (${r.reason})`)
  }

  if (!anyUpdated) {
    logger.log('\nNo updates needed.')
  }
}

main().catch((e: unknown) => {
  logger.error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})
