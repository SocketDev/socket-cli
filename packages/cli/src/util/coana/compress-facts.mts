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
 * in. Other paths, and missing files, pass through unchanged.
 *
 * Compression is streamed onto a worker thread because brotli quality 11 on a
 * 60+MB facts file costs multiple seconds of CPU, which would otherwise freeze
 * the spinner, the signal handlers, and any concurrent work.
 *
 * The `.br` MUST be a sibling rather than a temp file. depscan drops multipart
 * entries whose names contain `..`, and an OS-tmpdir path relativizes into
 * exactly that, so the upload silently loses the facts. Detail:
 * docs/references/repo/socket-facts-compression.md.
 *
 * Caller MUST `await cleanup()`, typically in a `finally`, once the upload
 * finishes either way, or the `.br` siblings are left behind in the user's
 * tree.
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
