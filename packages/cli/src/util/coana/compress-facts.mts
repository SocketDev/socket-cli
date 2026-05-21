/**
 * Brotli compression for Coana facts files prior to upload.
 *
 * Key Functions: - compressSocketFactsForUpload: Brotli-compress any
 * .socket.facts.json entries in scanPaths just before upload, returning swapped
 * paths plus a cleanup callback. Coana keeps writing plain JSON; the
 * on-the-wire form to depscan is brotli (api-v0 decodes at the multipart
 * boundary).
 *
 * Integration: - Called from handleCreateNewScan immediately before
 * fetchCreateOrgFullScan. - Sibling .br files live next to the source so the
 * multipart entry name stays inside cwd (depscan strips .. traversal entries).
 */

import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createBrotliCompress } from 'node:zlib'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { DOT_SOCKET_DOT_FACTS_JSON } from '../../constants.mts'

export type CompressedScanPaths = {
  cleanup: () => Promise<void>
  paths: string[]
}

/**
 * For each `.socket.facts.json` in `scanPaths`, stream-brotli-compress a
 * sibling `.socket.facts.json.br` next to the original file and swap its path
 * in. Other paths pass through unchanged. Missing files also pass through
 * unchanged (the upload will fail downstream with the same error it would
 * have).
 *
 * Streaming + worker-thread compression keeps the event loop responsive:
 * default brotli quality (11) on a 60+MB facts file takes multiple seconds of
 * CPU, which would otherwise freeze the spinner / signal handlers / any
 * concurrent work.
 *
 * The `.br` lives next to the source rather than under the OS temp dir because
 * depscan's multipart ingest (`addStreamEntry`) rejects entries whose names
 * contain `..` traversal segments. The SDK computes the multipart entry name
 * via `path.relative(cwd, brPath)`, so an OS-tmpdir temp path turns into
 * `../../../var/folders/...` and gets dropped as `unmatchedFiles`.
 * Sibling-write keeps the relative path inside cwd, and keeps the directory
 * shape symmetric with the plain `.socket.facts.json` upload (depscan strips
 * only the `.br` suffix at ingest, so `<dir>/.socket.facts.json.br` and
 * `<dir>/.socket.facts.json` resolve to the same storage path).
 *
 * Concurrent scans against the same source directory are already racy on
 * `.socket.facts.json` itself (coana writes to a single path), so the sibling
 * `.br` doesn't introduce a new race.
 *
 * Caller MUST `await cleanup()` (typically in a `finally` block) once the
 * upload completes — successful or not — to remove the sibling files.
 */
export async function compressSocketFactsForUpload(
  scanPaths: string[],
): Promise<CompressedScanPaths> {
  const brPaths: string[] = []
  const paths = await Promise.all(
    scanPaths.map(async p => {
      if (path.basename(p) !== DOT_SOCKET_DOT_FACTS_JSON) {
        return p
      }
      if (!existsSync(p)) {
        return p
      }
      const brPath = `${p}.br`
      await pipeline(
        createReadStream(p),
        createBrotliCompress(),
        createWriteStream(brPath),
      )
      brPaths.push(brPath)
      return brPath
    }),
  )
  const cleanup = async () => {
    const targets = brPaths.splice(0)
    if (targets.length === 0) {
      return
    }
    await safeDelete(targets, { force: true })
  }
  return { __proto__: null, cleanup, paths } as CompressedScanPaths
}
