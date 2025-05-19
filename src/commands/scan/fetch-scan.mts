import { debugLog } from '@socketsecurity/registry/lib/debug'

import { queryApiSafeText } from '../../utils/api.mts'

import type { CResult } from '../../types.mts'
import type { components } from '@socketsecurity/sdk/types/api'

export async function fetchScan(
  orgSlug: string,
  scanId: string,
): Promise<CResult<Array<components['schemas']['SocketArtifact']>>> {
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
    } catch {
      ok = false
      debugLog('ndjson failed to parse the following line:')
      debugLog(line)
      return null
    }
  }) as unknown as Array<components['schemas']['SocketArtifact']>

  if (ok) {
    return { ok: true, data }
  }

  return {
    ok: false,
    message: 'Invalid API response',
    cause:
      'The API responded with at least one line that was not valid JSON. Please report if this persists.',
  }
}
