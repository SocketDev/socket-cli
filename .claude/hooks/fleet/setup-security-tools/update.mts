#!/usr/bin/env node
// Update script for Socket security tools.
//
// Checks for new releases of zizmor, agentshield, and sfw, respecting
// the soak time for third-party tools (zizmor + agentshield). The
// window is sourced from pnpm-workspace.yaml's `minimumReleaseAge`
// (minutes) — same field that gates npm package adoption — so the
// policy reads identically across the fleet whether you're talking
// about npm deps or security-tool versions. Socket-owned tools (sfw)
// skip the soak (we trust our own publishing pipeline).
//
// Updates external-tools.json when new versions or checksums are found.

import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { httpDownload } from '@socketsecurity/lib-stable/http-request/download'
import { httpRequest } from '@socketsecurity/lib-stable/http-request/request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = path.join(__dirname, 'external-tools.json')

const MS_PER_MINUTE = 60_000
const MINUTES_PER_DAY = 1440
// 10080 minutes = 7 days. The fleet-wide soak default is 7 days; we
// store it in minutes here because pnpm's `minimumReleaseAge` field
// is in minutes too, so the conversion is one place.
const DEFAULT_SOAK_MINUTES = 10_080

// Format a soak time for log output. The pnpm unit
// (`minimumReleaseAge`) is minutes, so we lead with minutes and
// append the day conversion in parentheses. The user editing
// pnpm-workspace.yaml needs to know the field is in minutes; the
// parenthetical day count saves them the mental arithmetic.
//
// Examples:
//   10080  →  "10080 minutes (7 days)"
//   1500   →  "1500 minutes (1.04 days)"
//   60     →  "60 minutes (0.04 days)"
export function formatSoakWindow(minutes: number): string {
  const days = minutes / MINUTES_PER_DAY
  const daysLabel = Number.isInteger(days)
    ? `${days} day${days === 1 ? '' : 's'}`
    : `${days.toFixed(2)} days`
  return `${minutes} minutes (${daysLabel})`
}

// Read the soak time from pnpm-workspace.yaml (the
// `minimumReleaseAge` field, in minutes) and convert to ms. The
// regex literal MUST match pnpm's exact field name — this isn't
// renameable. User-facing log messages call it "soak time" to
// match the rest of the fleet's terminology.
export function readSoakWindowMs(): number {
  let dir = __dirname
  for (let i = 0; i < 10; i += 1) {
    const candidate = path.join(dir, 'pnpm-workspace.yaml')
    if (existsSync(candidate)) {
      try {
        const content = readFileSync(candidate, 'utf8')
        const match = /^minimumReleaseAge:\s*(?<value>\d+)/m.exec(content)
        if (match) {
          return Number(match.groups!.value) * MS_PER_MINUTE
        }
      } catch {
        // Read error.
      }
      logger.warn(
        `Could not read soak time (minimumReleaseAge) from ${candidate}; defaulting to ${formatSoakWindow(DEFAULT_SOAK_MINUTES)}`,
      )
      return DEFAULT_SOAK_MINUTES * MS_PER_MINUTE
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  logger.warn(
    `pnpm-workspace.yaml not found; defaulting soak time to ${formatSoakWindow(DEFAULT_SOAK_MINUTES)}`,
  )
  return DEFAULT_SOAK_MINUTES * MS_PER_MINUTE
}

const SOAK_WINDOW_MS = readSoakWindowMs()

// Soak Time bypass: if the operator explicitly sets one of these env
// vars to a truthy value, we accept the latest release regardless of
// how old it is. Used in emergency-patch situations (e.g. a CVE in
// zizmor that lands a same-day fix). All three spellings are accepted
// because the canonical name spelled three ways across CLAUDE.md and
// human notes; documented in the README.
const SOAK_TIME_BYPASS = Boolean(
  process.env['SOCKET_SOAKTIME_BYPASS'] ||
  process.env['SOCKET_SOAK_TIME_BYPASS'] ||
  process.env['SOCKET_SOAK_BYPASS'],
)

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

export async function ghApiLatestRelease(repo: string): Promise<GhRelease> {
  const result = await spawn(
    'gh',
    ['api', `repos/${repo}/releases/latest`, '--cache', '1h'],
    { stdio: 'pipe' },
  )
  const stdout =
    typeof result.stdout === 'string' ? result.stdout : String(result.stdout)
  return JSON.parse(stdout) as GhRelease
}

export function isOlderThanSoakWindow(publishedAt: string): boolean {
  const published = new Date(publishedAt).getTime()
  return Date.now() - published >= SOAK_WINDOW_MS
}

export function versionFromTag(tag: string): string {
  return tag.replace(/^v/, '')
}

// ── Config file I/O ──

interface ToolConfig {
  description?: string | undefined
  version: string
  repository?: string | undefined
  assets?: Record<string, string> | undefined
  platforms?: Record<string, string> | undefined
  checksums?: Record<string, string> | undefined
  ecosystems?: string[] | undefined
}

interface Config {
  description?: string | undefined
  tools: Record<string, ToolConfig>
}

export function readConfig(): Config {
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Config
}

export async function writeConfig(config: Config): Promise<void> {
  await fs.writeFile(
    CONFIG_FILE,
    JSON.stringify(config, undefined, 2) + '\n',
    'utf8',
  )
}

// ── Checksum computation ──

export async function computeSha256(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(content).digest('hex')
}

export async function downloadAndHash(url: string): Promise<string> {
  const tmpFile = path.join(
    os.tmpdir(),
    `security-tools-update-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  try {
    await httpDownload(url, tmpFile, { retries: 2 })
    return await computeSha256(tmpFile)
  } finally {
    await safeDelete(tmpFile)
  }
}

// ── Zizmor update ──

interface UpdateResult {
  reason: string
  skipped: boolean
  tool: string
  updated: boolean
}

// Update a third-party GitHub-release-based tool (zizmor, agentshield,
// any other release-checksum tool). Caller picks the tool name and the
// default repo (used when external-tools.json doesn't pin a different
// one). Soak time applies because these are third-party.
export async function updateGithubReleaseTool(
  config: Config,
  tool: string,
  defaultRepo: string,
): Promise<UpdateResult> {
  logger.log(`=== Checking ${tool} ===`)

  const toolConfig = config.tools[tool]
  if (!toolConfig) {
    return { tool, skipped: true, updated: false, reason: 'not in config' }
  }

  const repo = toolConfig.repository?.replace(/^[^:]+:/, '') ?? defaultRepo

  let release: GhRelease
  try {
    release = await ghApiLatestRelease(repo)
  } catch (e) {
    const msg = errorMessage(e)
    logger.warn(`Failed to fetch ${tool} releases: ${msg}`)
    return { tool, skipped: true, updated: false, reason: `API error: ${msg}` }
  }

  const latestVersion = versionFromTag(release.tag_name)
  const currentVersion = toolConfig.version

  logger.log(`Current: v${currentVersion}, Latest: v${latestVersion}`)

  if (latestVersion === currentVersion) {
    logger.log('Already current.')
    return { tool, skipped: false, updated: false, reason: 'already current' }
  }

  // Respect the soak time for third-party tools, unless the
  // operator explicitly bypasses via SOCKET_SOAKTIME_BYPASS=1 (or
  // SOCKET_SOAK_TIME_BYPASS / SOCKET_SOAK_BYPASS).
  if (!isOlderThanSoakWindow(release.published_at)) {
    const ageDays = (
      (Date.now() - new Date(release.published_at).getTime()) /
      86_400_000
    ).toFixed(1)
    const soakMinutes = SOAK_WINDOW_MS / MS_PER_MINUTE
    const soakLabel = formatSoakWindow(soakMinutes)
    if (SOAK_TIME_BYPASS) {
      logger.log(
        `v${latestVersion} is only ${ageDays} days old; soak time is ${soakLabel}. SOAK_TIME_BYPASS set — accepting anyway.`,
      )
    } else {
      logger.log(
        `v${latestVersion} is only ${ageDays} days old; soak time is ${soakLabel}. Skipping (set SOCKET_SOAKTIME_BYPASS=1 to override).`,
      )
      return {
        tool,
        skipped: true,
        updated: false,
        reason: `inside soak time (${ageDays} days old, need ${soakLabel})`,
      }
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
        const lines = resp.text().split('\n')
        for (let i = 0, { length } = lines; i < length; i += 1) {
          const line = lines[i]!
          const match = /^(?<hash>[a-f0-9]{64})\s+(?<filename>.+)$/.exec(
            line.trim(),
          )
          if (match) {
            checksumMap[match.groups!.filename!] = match.groups!.hash!
          }
        }
      }
    } catch {
      // Fall through to per-asset download.
    }
  }

  // Compute checksums for each asset in the config.
  const currentChecksums = toolConfig.checksums ?? {}
  const newChecksums: Record<string, string> = {
    __proto__: null,
  } as unknown as Record<string, string>
  let allFound = true

  const assetNames = Object.keys(currentChecksums)
  for (let i = 0, { length } = assetNames; i < length; i += 1) {
    const assetName = assetNames[i]!
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
        const msg = errorMessage(e)
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
      logger.log(
        `  ${assetName}: ${oldHash.slice(0, 12)}... -> ${newHash.slice(0, 12)}...`,
      )
    } else if (oldHash === newHash) {
      logger.log(`  ${assetName}: unchanged`)
    }
  }

  if (!allFound) {
    logger.warn('Some assets could not be verified. Skipping version bump.')
    return {
      tool,
      skipped: true,
      updated: false,
      reason: 'incomplete asset checksums',
    }
  }

  // Update config.
  toolConfig.version = latestVersion
  toolConfig.checksums = newChecksums
  logger.log(`Updated ${tool}: ${currentVersion} -> ${latestVersion}`)

  return {
    tool,
    skipped: false,
    updated: true,
    reason: `${currentVersion} -> ${latestVersion}`,
  }
}

// Thin wrappers preserve the per-tool default-repo knowledge in one
// place. Callers from main() pass the same Config; the soak time
// still applies to both because they're both third-party.
export function updateZizmor(config: Config): Promise<UpdateResult> {
  return updateGithubReleaseTool(config, 'zizmor', 'zizmorcore/zizmor')
}

export function updateAgentshield(config: Config): Promise<UpdateResult> {
  return updateGithubReleaseTool(config, 'agentshield', 'SocketDev/agentshield')
}

// ── SFW update ──

export async function updateSfwTool(
  config: Config,
  toolName: string,
): Promise<UpdateResult> {
  const toolConfig = config.tools[toolName]
  if (!toolConfig) {
    return {
      tool: toolName,
      skipped: true,
      updated: false,
      reason: 'not in config',
    }
  }

  const repo = toolConfig.repository?.replace(/^[^:]+:/, '')
  if (!repo) {
    return {
      tool: toolName,
      skipped: true,
      updated: false,
      reason: 'no repository',
    }
  }

  let release: GhRelease
  try {
    release = await ghApiLatestRelease(repo)
  } catch (e) {
    const msg = errorMessage(e)
    logger.warn(`Failed to fetch ${toolName} releases: ${msg}`)
    return {
      tool: toolName,
      skipped: true,
      updated: false,
      reason: `API error: ${msg}`,
    }
  }

  logger.log(
    `  ${toolName}: latest ${release.tag_name} (published ${release.published_at.slice(0, 10)})`,
  )

  const currentChecksums = toolConfig.checksums ?? {}
  const platforms = toolConfig.platforms ?? {}
  const prefix = toolName === 'sfw-enterprise' ? 'sfw' : 'sfw-free'
  const newChecksums: Record<string, string> = {
    __proto__: null,
  } as unknown as Record<string, string>
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
        logger.log(
          `    ${sfwPlatform}: ${(currentChecksums[sfwPlatform] ?? '').slice(0, 12)}... -> ${hash.slice(0, 12)}...`,
        )
        changed = true
      }
    } catch (e) {
      const msg = errorMessage(e)
      logger.warn(`    Failed to download ${assetName}: ${msg}`)
      allFound = false
    }
  }

  if (!allFound) {
    logger.warn(
      `  Some ${toolName} assets could not be downloaded. Skipping update.`,
    )
    return {
      tool: toolName,
      skipped: true,
      updated: false,
      reason: 'incomplete downloads',
    }
  }

  if (changed) {
    toolConfig.version = versionFromTag(release.tag_name)
    toolConfig.checksums = newChecksums
    return {
      tool: toolName,
      skipped: false,
      updated: true,
      reason: 'checksums updated',
    }
  }

  return {
    tool: toolName,
    skipped: false,
    updated: false,
    reason: 'already current',
  }
}

export async function updateSfw(config: Config): Promise<UpdateResult[]> {
  logger.log('=== Checking SFW ===')
  logger.log('Socket-owned tool: soak time not enforced.')

  const results: UpdateResult[] = []

  logger.log('')
  results.push(await updateSfwTool(config, 'sfw-free'))

  logger.log('')
  results.push(await updateSfwTool(config, 'sfw-enterprise'))

  return results
}

// ── Main ──

async function main(): Promise<void> {
  logger.log('Checking for security tool updates…')
  logger.log('')

  const config = readConfig()
  const allResults: UpdateResult[] = []

  // 1. Check zizmor (third-party, respects soak time).
  allResults.push(await updateZizmor(config))
  logger.log('')

  // 2. Check agentshield (third-party, respects soak time).
  // Only runs if external-tools.json has an `agentshield` entry —
  // updateGithubReleaseTool returns skipped:'not in config' otherwise,
  // so this is safe to leave wired even on repos that don't yet list it.
  allResults.push(await updateAgentshield(config))
  logger.log('')

  // 3. Check sfw (Socket-owned, soak time not enforced).
  const sfwResults = await updateSfw(config)
  allResults.push(...sfwResults)
  logger.log('')

  // Write updated config if anything changed.
  const anyUpdated = allResults.some(r => r.updated)
  if (anyUpdated) {
    await writeConfig(config)
    logger.log('Updated external-tools.json.')
    logger.log('')
  }

  // Report.
  logger.log('=== Summary ===')
  for (let i = 0, { length } = allResults; i < length; i += 1) {
    const r = allResults[i]!
    const status = r.updated ? 'UPDATED' : r.skipped ? 'SKIPPED' : 'CURRENT'
    logger.log(`  ${r.tool}: ${status} (${r.reason})`)
  }

  if (!anyUpdated) {
    logger.log('')
    logger.log('No updates needed.')
  }
}

main().catch((e: unknown) => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
