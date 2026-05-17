/**
 * Release-checksum core: format primitives + embedded-checksum loader + verify.
 *
 * This file is the **shared core** used by every fleet repo that publishes
 * artifacts whose integrity is gated by SHA-256 checksums. It contains no
 * network code and no producer code — see `consumer.mts` for the network
 * fetch path, and `producer.mts` for the writer side.
 *
 * Fleet-canonical: byte-identical across every repo that ships
 * `packages/build-infra/lib/release-checksums/`. Drift caught by
 * sync-scaffolding.
 */

import crypto from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ---------------------------------------------------------------------------
// Public types — match the JSON Schema at packages/build-infra/release-assets.schema.json.
// ---------------------------------------------------------------------------

export interface ToolConfig {
  description?: string
  tag: string
  checksums: Record<string, string>
}

export type EmbeddedChecksums = Record<string, ToolConfig>

export interface VerifyResult {
  actual?: string
  expected?: string
  source?: string
  skipped?: boolean
  valid: boolean
}

// ---------------------------------------------------------------------------
// Embedded loader.
//
// Reads `packages/build-infra/release-assets.json` from the repo root.
// Lazy + cached: file is read at most once per process. The `null` sentinel
// distinguishes "tried and failed" from "not yet tried" so we don't retry
// on every call.
// ---------------------------------------------------------------------------

let embeddedChecksums: EmbeddedChecksums | undefined | null

export function getEmbeddedChecksums(): EmbeddedChecksums | undefined {
  if (embeddedChecksums === null) {
    return undefined
  }
  if (embeddedChecksums === undefined) {
    try {
      const checksumPath = path.join(
        __dirname,
        '..',
        '..',
        'release-assets.json',
      )
      embeddedChecksums = JSON.parse(
        readFileSync(checksumPath, 'utf8'),
      ) as EmbeddedChecksums
    } catch {
      embeddedChecksums = null
      return undefined
    }
  }
  return embeddedChecksums
}

export function getEmbeddedChecksum(
  tool: string,
  assetName: string,
): { checksum: string; tag: string } | undefined {
  const embedded = getEmbeddedChecksums()
  if (!embedded) {
    return undefined
  }
  const toolConfig = embedded[tool]
  if (!toolConfig?.checksums) {
    return undefined
  }
  const checksum = toolConfig.checksums[assetName]
  if (!checksum) {
    return undefined
  }
  return { checksum, tag: toolConfig.tag }
}

// ---------------------------------------------------------------------------
// Format primitives.
// ---------------------------------------------------------------------------

/**
 * Compute SHA256 hash of a file as lowercase hex.
 */
export async function computeFileHash(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  const stream = createReadStream(filePath)
  for await (const chunk of stream) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

/**
 * Parse `checksums.txt` content into a map.
 *
 * Format: one entry per line, `<sha256-hex>  <filename>` (two spaces or any
 * whitespace between hash and name). Blank lines are skipped. Lines that
 * don't match the expected shape are silently ignored — defensive against
 * tools that prepend a header or comments.
 */
export function parseChecksums(content: string): Record<string, string> {
  const checksums: Record<string, string> = { __proto__: null as never }
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    const match = trimmed.match(/^([a-f0-9]{64})\s+(.+)$/)
    if (match) {
      checksums[match[2]!] = match[1]!
    }
  }
  return checksums
}

// ---------------------------------------------------------------------------
// Verify.
// ---------------------------------------------------------------------------

interface VerifyOptions {
  filePath: string
  assetName: string
  tool: string
  quiet?: boolean
}

/**
 * Verify a downloaded file against the embedded SHA-256 in `release-assets.json`.
 *
 * Embedded checksums are the source of truth. Three outcomes:
 *
 * 1. Embedded match found and SHA-256 agrees → `{ valid: true }`.
 * 2. Embedded match found but SHA-256 disagrees → `{ valid: false }` with
 *    `actual` + `expected` populated. **Fail loudly.**
 * 3. Tool is in `release-assets.json` but `assetName` isn't listed → return
 *    `{ valid: false }`. The likely cause is a stale embedded manifest;
 *    bump `tag` + `checksums` in `release-assets.json` and re-run.
 * 4. Tool isn't in `release-assets.json` at all → return
 *    `{ valid: true, skipped: true }` with a warning. This is the
 *    "release-assets.json doesn't track this tool yet" path; callers that
 *    need strict verification should treat `skipped` as a failure.
 */
export async function verifyReleaseChecksum(
  options: VerifyOptions,
): Promise<VerifyResult> {
  const { assetName, filePath, quiet = false, tool } = options

  const embedded = getEmbeddedChecksum(tool, assetName)
  if (embedded) {
    const actual = await computeFileHash(filePath)
    if (actual !== embedded.checksum) {
      return {
        actual,
        expected: embedded.checksum,
        source: 'embedded',
        valid: false,
      }
    }
    return {
      actual,
      expected: embedded.checksum,
      source: 'embedded',
      valid: true,
    }
  }

  const embeddedData = getEmbeddedChecksums()
  const toolBlock = embeddedData?.[tool]
  if (toolBlock?.checksums && Object.keys(toolBlock.checksums).length > 0) {
    if (!quiet) {
      logger.fail(
        `No embedded checksum for ${assetName} in release-assets.json (tool: ${tool})`,
      )
      logger.fail(`Bump the tag + checksums in release-assets.json to update`)
    }
    return { source: 'embedded', valid: false }
  }

  if (!quiet) {
    logger.warn(`No checksums found for ${tool}, skipping verification`)
  }
  return { skipped: true, valid: true }
}
