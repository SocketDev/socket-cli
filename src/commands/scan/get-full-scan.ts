import { Spinner } from '@socketsecurity/registry/lib/spinner'

import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api.ts'
import { setupSdk } from '../../utils/sdk.ts'

import type { SocketSdkResultType } from '@socketsecurity/sdk'

export async function getFullScan(
  orgSlug: string,
  fullScanId: string,
  file: string | undefined,
  apiToken: string
): Promise<SocketSdkResultType<'getOrgFullScan'>> {
  const spinner = new Spinner({ text: 'Streaming scan...' }).start()

  const socketSdk = await setupSdk(apiToken)
  const data = await handleApiCall(
    socketSdk.getOrgFullScan(
      orgSlug,
      fullScanId,
      file === '-' ? undefined : file
    ),
    'Streaming a scan'
  )

  if (data?.success) {
    spinner.stop(file ? `Full scan details written to ${file}` : '')
  } else {
    handleUnsuccessfulApiResponse('getOrgFullScan', data, spinner)
  }

  return data
}
