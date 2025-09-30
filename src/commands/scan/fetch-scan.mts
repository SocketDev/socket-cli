import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'

import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketArtifact } from '../../utils/alert/artifact.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'

export async function fetchScan(
  orgSlug: string,
  scanId: string,
  options?: { sdkOpts?: SetupSdkOptions | undefined } | undefined,
): Promise<CResult<SocketArtifact[]>> {
  const { sdkOpts } = { ...options }
  const sdkResult = await setupSdk(sdkOpts)
  if (!sdkResult.ok) {
    return sdkResult
  }

  const sdk = sdkResult.data
  const result = await sdk.queryApiText(
    `orgs/${orgSlug}/full-scans/${encodeURIComponent(scanId)}`,
    {
      throws: false,
      description: 'a scan',
    },
  )

  if (!result.ok) {
    return result as CResult<SocketArtifact[]>
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
      debugFn('error', 'Failed to parse scan result line as JSON')
      debugDir('error', { error: e, line })
      return undefined
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
