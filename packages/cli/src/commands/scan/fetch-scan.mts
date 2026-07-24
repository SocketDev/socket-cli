import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { sleep } from '@socketsecurity/lib-stable/promises/timers'

import { queryApiSafeTextWithStatus } from '../../util/socket/api.mjs'

import type { CResult } from '../../types.mts'
import type { SocketArtifact } from '../../util/alert/artifact.mts'

export const CACHED_POLL_INITIAL_DELAY_MS = 1000
export const CACHED_POLL_MAX_DELAY_MS = 10_000
export const CACHED_POLL_TIMEOUT_MS = 10 * 60 * 1000

export async function fetchScan(
  orgSlug: string,
  scanId: string,
): Promise<CResult<SocketArtifact[]>> {
  // Serve pre-computed results from the immutable store (`?cached=true`):
  // a 200 carries the ndjson body, a 202 means the server enqueued a
  // background job to compute them — poll with backoff until the results
  // are ready, so callers only ever observe the final scan.
  const path = `orgs/${orgSlug}/full-scans/${encodeURIComponent(scanId)}?cached=true`
  const deadline = Date.now() + CACHED_POLL_TIMEOUT_MS
  let delayMs = CACHED_POLL_INITIAL_DELAY_MS
  for (;;) {
    const result = await queryApiSafeTextWithStatus(path, 'a scan')
    if (!result.ok) {
      return result
    }
    if (result.data.status !== 202) {
      return parseArtifactsNdjson(result.data.text)
    }
    if (Date.now() >= deadline) {
      return {
        ok: false,
        message: 'Scan results not ready',
        cause: `The Socket API is still computing cached results for scan ${scanId} after ${CACHED_POLL_TIMEOUT_MS / 60_000} minutes (path: ${path}). Retry in a few minutes — the server keeps computing in the background.`,
      }
    }
    await sleep(delayMs)
    delayMs = Math.min(delayMs * 2, CACHED_POLL_MAX_DELAY_MS)
  }
}

export function parseArtifactsNdjson(
  jsonsString: string,
): CResult<SocketArtifact[]> {
  // This is nd-json; each line is a json object.
  const lines = jsonsString.split('\n').filter(Boolean)
  const data: SocketArtifact[] = []

  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    try {
      data.push(JSON.parse(line))
    } catch (e) {
      debug('Failed to parse scan result line as JSON')
      debugDir({ error: e, line })
      return {
        ok: false,
        message: 'Invalid Socket API response',
        cause:
          'The Socket API responded with at least one line that was not valid JSON. Please report if this persists.',
      }
    }
  }

  return { ok: true, data }
}
