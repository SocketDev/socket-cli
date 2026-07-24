/**
 * Release-checksum producer: write `checksums.txt` for a directory of
 * artifacts; update a `release-assets.json` block.
 *
 * Use this when your repo _produces_ releases (e.g. socket-btm builds `.node`
 * binaries and ships them to GH Releases). The output of `writeChecksumsFile()`
 * is what consumers download and verify against via `consumer.mts`.
 *
 * `writeChecksumsFile` writes sha256-hex — `checksums.txt` stays the
 * ecosystem `shasum -c` transport format. `updateReleaseAssets` re-encodes
 * that same hex map to SRI (`@socketsecurity/lib/integrity`'s `parseHash`)
 * before embedding it as the `release-assets.json` pin; a caller that already
 * hands it an SRI string is untouched (`parseHash` is idempotent on SRI
 * input).
 *
 * Repos that only consume releases don't need this file — see `consumer.mts`.
 *
 * Fleet-canonical: byte-identical across every repo that ships
 * `scripts/fleet/build-infra/lib/release-checksums/`.
 */

import { promises as fs, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { parseHash } from '@socketsecurity/lib/integrity'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

import { computeFileHash } from './core.mts'
import type { EmbeddedChecksums } from './core.mts'

const logger = getDefaultLogger()

/**
 * Walk a directory and compute SHA-256 hashes for every regular file in it.
 *
 * Sub-paths are relative to `dir`. Symlinks and directories are not recursed —
 * pass a flat directory of artifacts.
 */
export async function hashDirectory(
  dir: string,
): Promise<Record<string, string>> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const out: Record<string, string> = { __proto__: null as never }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (!entry.isFile()) {
      continue
    }
    const filePath = path.join(dir, entry.name)
    out[entry.name] = await computeFileHash(filePath)
  }
  return out
}

export interface UpdateAssetsOptions {
  /**
   * Path to `release-assets.json`.
   */
  manifestPath: string
  /**
   * Tool key inside the manifest (e.g. `lief`, `opentui`).
   */
  tool: string
  /**
   * Release tag, e.g. `lief-20260507-76c1796`.
   */
  tag: string
  /**
   * Asset → hash map (typically the sha256-hex return value of
   * `writeChecksumsFile`; an SRI string is accepted too). Re-encoded to SRI
   * before being written to `release-assets.json`.
   */
  checksums: Record<string, string>
  /**
   * Optional human-readable description for the tool block.
   */
  description?: string | undefined
}

/**
 * Update a tool's block in `release-assets.json` in place.
 *
 * Reads the existing manifest, replaces the block for `tool` with the new
 * `tag` + `checksums` (re-encoded to SRI via `parseHash().sri`), and writes
 * the result back. Other tool blocks are preserved untouched.
 *
 * The manifest's $schema field (if present) is preserved.
 */
export function updateReleaseAssets(config: UpdateAssetsOptions): void {
  const { checksums, description, manifestPath, tag, tool } = {
    __proto__: null,
    ...config,
  } as typeof config

  let manifest: EmbeddedChecksums & {
    $schema?: string | undefined
    $comment?: string | undefined
  } = { __proto__: null as never } as never
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    // New file — start fresh.
  }

  const sriChecksums: Record<string, string> = { __proto__: null as never }
  const assetNames = Object.keys(checksums)
  for (let i = 0, { length } = assetNames; i < length; i += 1) {
    const assetName = assetNames[i]!
    sriChecksums[assetName] = parseHash(checksums[assetName]!).sri
  }

  manifest[tool] = {
    ...(description !== undefined ? { description } : {}),
    tag,
    checksums: sriChecksums,
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
}

export interface WriteChecksumsOptions {
  /**
   * Directory containing the artifacts to hash.
   */
  inputDir: string
  /**
   * Path of the `checksums.txt` to write.
   */
  outputPath: string
  /**
   * Optional ordering. If omitted, entries are sorted alphabetically.
   */
  order?: 'alphabetical' | readonly string[] | undefined
  /**
   * Suppress info logging (errors still log).
   */
  quiet?: boolean | undefined
}

/**
 * Write a `checksums.txt` file from a directory of artifacts.
 *
 * Output format: `<sha256-hex> <filename>\n`, matching the format
 * `consumer.mts:parseChecksums` expects. Filenames are sorted alphabetically by
 * default for stable diffs.
 */
export async function writeChecksumsFile(
  config: WriteChecksumsOptions,
): Promise<Record<string, string>> {
  const {
    inputDir,
    order = 'alphabetical',
    outputPath,
    quiet = false,
  } = { __proto__: null, ...config } as typeof config

  const checksums = await hashDirectory(inputDir)
  const names =
    order === 'alphabetical' ? Object.keys(checksums).toSorted() : [...order]

  const lines: string[] = []
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    const hash = checksums[name]
    if (!hash) {
      if (!quiet) {
        logger.warn(`No file matched ordering entry: ${name}`)
      }
      continue
    }
    lines.push(`${hash}  ${name}`)
  }
  // POSIX-style trailing newline.
  await fs.writeFile(outputPath, lines.join('\n') + '\n', 'utf8')
  if (!quiet) {
    logger.info(`Wrote ${lines.length} checksums to ${outputPath}`)
  }
  return checksums
}
