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
import { mkdtemp, rm } from 'node:fs/promises'
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
 * `.socket.facts.json.br` into a fresh temp dir SIDE-BY-SIDE with the
 * original file (inside the source's parent directory) and swap its path
 * in. Other paths pass through unchanged. Missing files also pass through
 * unchanged (the upload will fail downstream with the same error it would
 * have).
 *
 * Streaming + worker-thread compression keeps the event loop responsive:
 * default brotli quality (11) on a 60+MB facts file takes multiple seconds
 * of CPU, which would otherwise freeze the spinner / signal handlers /
 * any concurrent work.
 *
 * The temp dir lives next to the source rather than under the OS temp dir
 * because depscan's multipart ingest (`addStreamEntry`) rejects entries
 * whose names contain `..` traversal segments. The SDK computes the
 * multipart entry name via `path.relative(cwd, brPath)`, so an OS-tmpdir
 * temp path turns into `../../../var/folders/...` and gets dropped as
 * `unmatchedFiles`. Keeping the temp file inside cwd-or-below keeps the
 * relative path traversal-free.
 *
 * Each compressed file gets its own `mkdtemp` directory so the filename
 * stays `.socket.facts.json.br` (no index/suffix collision) and
 * concurrent scans against the same source dir don't race on the same
 * path. The api-v0 boundary uses the `.br` filename suffix to trigger
 * streaming decode.
 *
 * Caller MUST `await cleanup()` (typically in a `finally` block) once the
 * upload completes — successful or not — to remove the temp dirs.
 */
export async function compressSocketFactsForUpload(
  scanPaths: string[],
): Promise<CompressedScanPaths> {
  const tmpDirs: string[] = []
  const paths = await Promise.all(
    scanPaths.map(async p => {
      if (path.basename(p) !== DOT_SOCKET_DOT_FACTS_JSON) {
        return p
      }
      if (!existsSync(p)) {
        return p
      }
      const td = await mkdtemp(path.join(path.dirname(p), '.socket-br-'))
      tmpDirs.push(td)
      const brPath = path.join(td, `${DOT_SOCKET_DOT_FACTS_JSON}.br`)
      await pipeline(
        createReadStream(p),
        createBrotliCompress(),
        createWriteStream(brPath),
      )
      return brPath
    }),
  )
  const cleanup = async () => {
    const dirs = tmpDirs.splice(0)
    await Promise.all(
      dirs.map(d => rm(d, { recursive: true, force: true })),
    )
  }
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
