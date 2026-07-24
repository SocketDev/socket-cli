/**
 * Release-checksum consumer: network fetch + cache for sibling-repo releases.
 *
 * Use this when your repo _consumes_ releases produced by another repo (e.g.
 * socket-addon republishes binaries from socket-btm). Composes the
 * embedded-checksum loader from `core.mts` with a `checksums.txt` fetch that
 * falls back to the network when the embedded manifest is missing a tag.
 *
 * The returned `checksums` map mixes two formats by design, keyed off
 * `source`: `embedded` (from `release-assets.json`) is SRI, `network`/`cache`
 * (parsed from the downloaded `checksums.txt`) is sha256-hex. Compare either
 * form with `@socketsecurity/lib/integrity`'s `equalHashes`/`verifyHash`,
 * which are encoding-agnostic — don't branch on `source` to reformat first.
 *
 * Repos that _produce_ releases don't need this file — see `producer.mts`.
 *
 * Fleet-canonical: byte-identical across every repo that ships
 * `scripts/fleet/build-infra/lib/release-checksums/`.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib/errors/message'
import { safeMkdir } from '@socketsecurity/lib/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'
import { getLatestRelease } from '@socketsecurity/lib/releases/github-listing'
import { downloadReleaseAsset } from '@socketsecurity/lib/releases/github-downloads'
import type { RepoConfig } from '@socketsecurity/lib/releases/github-types'

import { getEmbeddedChecksums, parseChecksums } from './core.mts'
import { REPO_ROOT } from '../../../paths.mts'

const logger = getDefaultLogger()

export interface ChecksumsResult {
  // SRI when `source` is `embedded`; sha256-hex when `source` is
  // `cache`/`network` (parsed from checksums.txt).
  checksums: Record<string, string>
  source: 'cache' | 'embedded' | 'network'
  tag: string
}

const checksumCache = new Map<string, ChecksumsResult>()

/**
 * Clear the checksum cache. Useful for testing or forcing re-download.
 */
export function clearChecksumCache(): void {
  checksumCache.clear()
}

export interface GetChecksumsOptions {
  /**
   * The producing repo whose releases we're verifying against.
   */
  repoConfig: RepoConfig
  /**
   * Tool name prefix used in the producing repo's release tag (e.g. `lief`).
   */
  tool: string
  /**
   * Specific tag to fetch. If omitted, uses the embedded tag, then `latest`.
   */
  releaseTag?: string | undefined
  /**
   * Where to cache the downloaded `checksums.txt`. Defaults to
   * `<cwd>/build/temp`.
   */
  tempDir?: string | undefined
  /**
   * Suppress info/warn logging (errors still log).
   */
  quiet?: boolean | undefined
  /**
   * If true (default), use embedded checksums when available even if a network
   * fetch could find newer ones. Set false to force a network fetch — useful
   * when bumping checksums.
   */
  preferEmbedded?: boolean | undefined
}

/**
 * Get checksums for a producing repo's release.
 *
 * Lookup priority: 1. In-memory cache (per-process) 2. Embedded checksums from
 * `release-assets.json` (works offline) 3. Download `checksums.txt` from the
 * producing repo's GitHub release.
 *
 * Network failures fall back to embedded checksums when available.
 */
export async function getReleaseChecksums(
  config: GetChecksumsOptions,
): Promise<ChecksumsResult> {
  const {
    preferEmbedded = true,
    quiet = false,
    releaseTag,
    repoConfig,
    tempDir,
    tool,
  } = { __proto__: null, ...config } as typeof config
  const toolPrefix = `${tool}-`

  const cacheKey = `${tool}:${releaseTag ?? 'latest'}`
  const cached = checksumCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const embedded = getEmbeddedChecksums()
  const toolEmbedded = embedded?.[tool]
  if (
    toolEmbedded?.checksums &&
    Object.keys(toolEmbedded.checksums).length > 0
  ) {
    if (preferEmbedded && (!releaseTag || releaseTag === toolEmbedded.tag)) {
      const result: ChecksumsResult = {
        checksums: toolEmbedded.checksums,
        source: 'embedded',
        tag: toolEmbedded.tag,
      }
      checksumCache.set(cacheKey, result)
      checksumCache.set(`${tool}:${toolEmbedded.tag}`, result)
      if (!quiet) {
        logger.info(
          `Using embedded checksums for ${tool} (${toolEmbedded.tag})`,
        )
      }
      return result
    }
  }

  const tag =
    releaseTag ??
    toolEmbedded?.tag ??
    (await getLatestRelease(toolPrefix, repoConfig))
  if (!tag) {
    if (!quiet) {
      logger.warn(`No ${tool} release found, cannot fetch checksums`)
    }
    return { checksums: {}, source: 'network', tag: '' }
  }

  const tagCacheKey = `${tool}:${tag}`
  const tagCached = checksumCache.get(tagCacheKey)
  if (tagCached) {
    if (!releaseTag) {
      checksumCache.set(cacheKey, tagCached)
    }
    return tagCached
  }

  const resolvedTempDir = tempDir ?? path.join(REPO_ROOT, 'build', 'temp')
  await safeMkdir(resolvedTempDir)
  const checksumPath = path.join(
    resolvedTempDir,
    `${tool}-checksums-${tag}.txt`,
  )

  if (existsSync(checksumPath)) {
    try {
      const content = await fs.readFile(checksumPath, 'utf8')
      const checksums = parseChecksums(content)
      const result: ChecksumsResult = { checksums, source: 'network', tag }
      checksumCache.set(tagCacheKey, result)
      if (!releaseTag) {
        checksumCache.set(cacheKey, result)
      }
      return result
    } catch {
      // Fall through to download.
    }
  }

  try {
    if (!quiet) {
      logger.info(`Downloading checksums for ${tool} release ${tag}...`)
    }
    await downloadReleaseAsset(tag, 'checksums.txt', checksumPath, repoConfig, {
      quiet: true,
    })

    const content = await fs.readFile(checksumPath, 'utf8')
    const checksums = parseChecksums(content)

    const result: ChecksumsResult = { checksums, source: 'network', tag }
    checksumCache.set(tagCacheKey, result)
    if (!releaseTag) {
      checksumCache.set(cacheKey, result)
    }

    if (!quiet) {
      logger.info(
        `Loaded ${Object.keys(checksums).length} checksums for ${tool}`,
      )
    }
    return result
  } catch (e) {
    if (
      toolEmbedded?.checksums &&
      Object.keys(toolEmbedded.checksums).length > 0
    ) {
      if (!quiet) {
        logger.warn(
          `Network fetch failed, using embedded checksums for ${tool}: ${errorMessage(e)}`,
        )
      }
      const result: ChecksumsResult = {
        checksums: toolEmbedded.checksums,
        source: 'embedded',
        tag: toolEmbedded.tag,
      }
      checksumCache.set(cacheKey, result)
      return result
    }

    if (!quiet) {
      logger.warn(
        `Failed to download checksums.txt for ${tool}: ${errorMessage(e)}`,
      )
    }
    return { checksums: {}, source: 'network', tag }
  }
}
