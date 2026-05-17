#!/usr/bin/env node
// Update script for Socket security tools.
//
// Checks for new releases of zizmor and sfw, respecting the pnpm
// minimumReleaseAge cooldown (read from pnpm-workspace.yaml) for third-party tools.
// Socket-owned tools (sfw) are excluded from cooldown.
//
// Updates external-tools.json when new versions or checksums are found.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { httpDownload, httpRequest } from '@socketsecurity/lib-stable/http-request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { spawn } from '@socketsecurity/lib-stable/spawn'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = path.join(__dirname, 'external-tools.json')

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

// ── Config file I/O ──

interface ToolConfig {
  description?: string
  version: string
  repository?: string
  assets?: Record<string, string>
  platforms?: Record<string, string>
  checksums?: Record<string, string>
  ecosystems?: string[]
}

interface Config {
  description?: string
  tools: Record<string, ToolConfig>
}

function readConfig(): Config {
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Config
}

async function writeConfig(config: Config): Promise<void> {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, undefined, 2) + '\n', 'utf8')
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

// ── Zizmor update ──

interface UpdateResult {
  reason: string
  skipped: boolean
  tool: string
  updated: boolean
}

async function updateZizmor(config: Config): Promise<UpdateResult> {
  const tool = 'zizmor'
  logger.log(`=== Checking ${tool} ===`)

  const toolConfig = config.tools[tool]
  if (!toolConfig) {
    return { tool, skipped: true, updated: false, reason: 'not in config' }
  }

  const repo = toolConfig.repository?.replace(/^[^:]+:/, '') ?? 'zizmorcore/zizmor'

  let release: GhRelease
  try {
    release = await ghApiLatestRelease(repo)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logger.warn(`Failed to fetch zizmor releases: ${msg}`)
    return { tool, skipped: true, updated: false, reason: `API error: ${msg}` }
  }

  const latestVersion = versionFromTag(release.tag_name)
  const currentVersion = toolConfig.version

  logger.log(`Current: v${currentVersion}, Latest: v${latestVersion}`)

  if (latestVersion === currentVersion) {
    logger.log('Already current.')
    return { tool, skipped: false, updated: false, reason: 'already current' }
  }

  // Respect cooldown for third-party tools.
  if (!isOlderThanCooldown(release.published_at)) {
    const daysOld = ((Date.now() - new Date(release.published_at).getTime()) / 86_400_000).toFixed(1)
    const cooldownDays = (COOLDOWN_MS / 86_400_000).toFixed(0)
    logger.log(`v${latestVersion} is only ${daysOld} days old (need ${cooldownDays}). Skipping.`)
    return { tool, skipped: true, updated: false, reason: `too new (${daysOld} days, need ${cooldownDays})` }
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

  // Compute checksums for each asset in the config.
  const currentChecksums = toolConfig.checksums ?? {}
  const newChecksums: Record<string, string> = { __proto__: null } as unknown as Record<string, string>
  let allFound = true

  for (const assetName of Object.keys(currentChecksums)) {
    let newHash: string | undefined

    // Try checksums.txt first.
    if (checksumMap?.[assetName]) {
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

    newChecksums[assetName] = newHash
    const oldHash = currentChecksums[assetName]
    if (oldHash && oldHash !== newHash) {
      logger.log(`  ${assetName}: ${oldHash.slice(0, 12)}... -> ${newHash.slice(0, 12)}...`)
    } else if (oldHash === newHash) {
      logger.log(`  ${assetName}: unchanged`)
    }
  }

  if (!allFound) {
    logger.warn('Some assets could not be verified. Skipping version bump.')
    return { tool, skipped: true, updated: false, reason: 'incomplete asset checksums' }
  }

  // Update config.
  toolConfig.version = latestVersion
  toolConfig.checksums = newChecksums
  logger.log(`Updated zizmor: ${currentVersion} -> ${latestVersion}`)

  return { tool, skipped: false, updated: true, reason: `${currentVersion} -> ${latestVersion}` }
}

// ── SFW update ──

async function updateSfwTool(
  config: Config,
  toolName: string,
): Promise<UpdateResult> {
  const toolConfig = config.tools[toolName]
  if (!toolConfig) {
    return { tool: toolName, skipped: true, updated: false, reason: 'not in config' }
  }

  const repo = toolConfig.repository?.replace(/^[^:]+:/, '')
  if (!repo) {
    return { tool: toolName, skipped: true, updated: false, reason: 'no repository' }
  }

  let release: GhRelease
  try {
    release = await ghApiLatestRelease(repo)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logger.warn(`Failed to fetch ${toolName} releases: ${msg}`)
    return { tool: toolName, skipped: true, updated: false, reason: `API error: ${msg}` }
  }

  logger.log(`  ${toolName}: latest ${release.tag_name} (published ${release.published_at.slice(0, 10)})`)

  const currentChecksums = toolConfig.checksums ?? {}
  const platforms = toolConfig.platforms ?? {}
  const prefix = toolName === 'sfw-enterprise' ? 'sfw' : 'sfw-free'
  const newChecksums: Record<string, string> = { __proto__: null } as unknown as Record<string, string>
  let changed = false
  let allFound = true

  for (const { 0: _, 1: sfwPlatform } of Object.entries(platforms)) {
    const suffix = sfwPlatform.startsWith('windows') ? '.exe' : ''
    const assetName = `${prefix}-${sfwPlatform}${suffix}`
    const asset = release.assets.find(a => a.name === assetName)
    const url = asset
      ? asset.browser_download_url
      : `https://github.com/${repo}/releases/download/${release.tag_name}/${assetName}`
    logger.log(`    Computing checksum for ${assetName}...`)
    try {
      const hash = await downloadAndHash(url)
      newChecksums[sfwPlatform] = hash
      if (currentChecksums[sfwPlatform] !== hash) {
        logger.log(`    ${sfwPlatform}: ${(currentChecksums[sfwPlatform] ?? '').slice(0, 12)}... -> ${hash.slice(0, 12)}...`)
        changed = true
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.warn(`    Failed to download ${assetName}: ${msg}`)
      allFound = false
    }
  }

  if (!allFound) {
    logger.warn(`  Some ${toolName} assets could not be downloaded. Skipping update.`)
    return { tool: toolName, skipped: true, updated: false, reason: 'incomplete downloads' }
  }

  if (changed) {
    toolConfig.version = release.tag_name
    toolConfig.checksums = newChecksums
    return { tool: toolName, skipped: false, updated: true, reason: 'checksums updated' }
  }

  return { tool: toolName, skipped: false, updated: false, reason: 'already current' }
}

async function updateSfw(config: Config): Promise<UpdateResult[]> {
  logger.log('=== Checking SFW ===')
  logger.log('Socket-owned tool: cooldown excluded.')

  const results: UpdateResult[] = []

  logger.log('')
  results.push(await updateSfwTool(config, 'sfw-free'))

  logger.log('')
  results.push(await updateSfwTool(config, 'sfw-enterprise'))

  return results
}

// ── Main ──

async function main(): Promise<void> {
  logger.log('Checking for security tool updates...\n')

  const config = readConfig()
  const allResults: UpdateResult[] = []

  // 1. Check zizmor (third-party, respects cooldown).
  allResults.push(await updateZizmor(config))
  logger.log('')

  // 2. Check sfw (Socket-owned, no cooldown).
  const sfwResults = await updateSfw(config)
  allResults.push(...sfwResults)
  logger.log('')

  // Write updated config if anything changed.
  const anyUpdated = allResults.some(r => r.updated)
  if (anyUpdated) {
    await writeConfig(config)
    logger.log('Updated external-tools.json.\n')
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
