import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'

import { queryApiSafeText } from '../../utils/api.mts'

import type { CResult } from '../../types.mts'
import type { SocketArtifact } from '../../utils/alert/artifact.mts'

export async function fetchScan(
  orgSlug: string,
  scanId: string,
): Promise<CResult<SocketArtifact[]>> {
  const result = await queryApiSafeText(
    `orgs/${orgSlug}/full-scans/${encodeURIComponent(scanId)}`,
    'a scan',
  )

  if (!result.ok) {
    return result
  }

  const jsonsString = result.data

  // This is nd-json; each line is a json object
  const lines = jsonsString.split('\n').filter(Boolean)
  let ok = true
  const data = lines.map(line => {
    try {
      return JSON.parse(line)
    } catch (e) {
      ok = false
      debugFn('error', 'caught: JSON.parse error')
      debugDir('inspect', { error: e, line })
      return null
    }
  }) as unknown as SocketArtifact[]

  if (ok) {
    return { ok: true, data }
  }

  return {
    ok: false,
    message: 'Invalid Socket API response',
    cause:
      'The Socket API responded with at least one line that was not valid JSON. Please report if this persists.',
  }
}
