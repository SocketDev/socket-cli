/**
 * Coana integration utilities for Socket CLI.
 * Manages reachability analysis via Coana tech CLI.
 *
 * Key Functions:
 * - compressSocketFactsForUpload: Brotli-compress any .socket.facts.json
 *   entries in scanPaths just before upload, returning swapped paths plus a
 *   cleanup callback. Coana keeps writing plain JSON; the on-the-wire form
 *   to depscan is brotli (api-v0 decodes at the multipart boundary).
 * - extractReachabilityErrors: Extract per-component reachability errors
 * - extractTier1ReachabilityScanId: Extract scan ID from socket facts file
 *
 * Integration:
 * - Works with @coana-tech/cli for reachability analysis
 * - Processes socket facts JSON files
 * - Extracts tier 1 reachability scan identifiers
 */

import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createBrotliCompress } from 'node:zlib'

import { readJsonSync } from '@socketsecurity/registry/lib/fs'

import constants from '../constants.mts'

const { DOT_SOCKET_DOT_FACTS_JSON } = constants

export type CompressedScanPaths = {
  paths: string[]
  cleanup: () => Promise<void>
}

/**
 * For each `.socket.facts.json` in `scanPaths`, stream-brotli-compress a
 * sibling `.socket.facts.json.br` next to the original file and swap its
 * path in. Other paths pass through unchanged. Missing files also pass
 * through unchanged (the upload will fail downstream with the same error
 * it would have).
 *
 * Streaming + worker-thread compression keeps the event loop responsive:
 * default brotli quality (11) on a 60+MB facts file takes multiple seconds
 * of CPU, which would otherwise freeze the spinner / signal handlers /
 * any concurrent work.
 *
 * The `.br` lives next to the source rather than under the OS temp dir
 * because depscan's multipart ingest (`addStreamEntry`) rejects entries
 * whose names contain `..` traversal segments. The SDK computes the
 * multipart entry name via `path.relative(cwd, brPath)`, so an OS-tmpdir
 * temp path turns into `../../../var/folders/...` and gets dropped as
 * `unmatchedFiles`. Sibling-write keeps the relative path inside cwd, and
 * keeps the directory shape symmetric with the plain `.socket.facts.json`
 * upload (depscan strips only the `.br` suffix at ingest, so
 * `<dir>/.socket.facts.json.br` and `<dir>/.socket.facts.json` resolve to
 * the same storage path).
 *
 * Concurrent scans against the same source directory are already racy on
 * `.socket.facts.json` itself (coana writes to a single path), so the
 * sibling `.br` doesn't introduce a new race.
 *
 * Caller MUST `await cleanup()` (typically in a `finally` block) once the
 * upload completes — successful or not — to remove the sibling files.
 */
export async function compressSocketFactsForUpload(
  scanPaths: string[],
): Promise<CompressedScanPaths> {
  const brPaths: string[] = []
  const cleanup = async () => {
    const targets = brPaths.splice(0)
    // `recursive: true` defends against the (defensive) case where a sibling
    // path was somehow created as a directory — `rm` would otherwise throw
    // on the first such entry and skip the rest. `force: true` no-ops on
    // missing paths so the function stays idempotent.
    await Promise.all(targets.map(t => rm(t, { recursive: true, force: true })))
  }
  // Use `allSettled` (not `all`) so a failure in one entry doesn't leak the
  // others' in-flight pipelines past our `catch`. If we used `all`, the
  // first rejection would bubble out while sibling pipelines were still
  // writing bytes — `cleanup()` would race with those writes and could
  // remove a `.br` only to have it re-created after we returned.
  const results = await Promise.allSettled(
    scanPaths.map(async p => {
      if (path.basename(p) !== DOT_SOCKET_DOT_FACTS_JSON) {
        return p
      }
      if (!existsSync(p)) {
        return p
      }
      const brPath = `${p}.br`
      // Track the sibling path BEFORE the pipeline starts so a
      // partially-written `.br` is removed even if the pipeline rejects.
      // `rm({ force: true })` no-ops on missing files, so tracking before
      // creation is safe.
      brPaths.push(brPath)
      await pipeline(
        createReadStream(p),
        createBrotliCompress(),
        createWriteStream(brPath),
      )
      return brPath
    }),
  )
  const failure = results.find(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  )
  if (failure) {
    // All pipelines have settled, so cleanup() can safely remove every
    // `.br` we tracked (succeeded or partial) without racing live writes.
    await cleanup()
    throw failure.reason
  }
  const paths = results.map(r => (r as PromiseFulfilledResult<string>).value)
  return { paths, cleanup }
}

export type ReachabilityError = {
  componentName: string
  componentVersion: string
  ghsaId: string
  subprojectPath: string
}

export function extractReachabilityErrors(
  socketFactsFile: string,
): ReachabilityError[] {
  const json = readJsonSync(socketFactsFile, { throws: false }) as
    | {
        components?: Array<{
          name?: string
          reachability?: Array<{
            ghsa_id?: string
            reachability?: Array<{
              subprojectPath?: string
              type?: string
            }>
          }>
          version?: string
        }>
      }
    | null
    | undefined
  if (!json || !Array.isArray(json.components)) {
    return []
  }
  const errors: ReachabilityError[] = []
  for (const component of json.components) {
    if (!Array.isArray(component.reachability)) {
      continue
    }
    for (const ghsaEntry of component.reachability) {
      if (!Array.isArray(ghsaEntry.reachability)) {
        continue
      }
      for (const entry of ghsaEntry.reachability) {
        if (entry.type === 'error') {
          errors.push({
            componentName: String(component.name ?? ''),
            componentVersion: String(component.version ?? ''),
            ghsaId: String(ghsaEntry.ghsa_id ?? ''),
            subprojectPath: String(entry.subprojectPath ?? ''),
          })
        }
      }
    }
  }
  return errors
}

export function extractTier1ReachabilityScanId(
  socketFactsFile: string,
): string | undefined {
  const json = readJsonSync(socketFactsFile, { throws: false })
  const tier1ReachabilityScanId = String(
    json?.['tier1ReachabilityScanId'] ?? '',
  ).trim()
  return tier1ReachabilityScanId.length > 0
    ? tier1ReachabilityScanId
    : undefined
}
