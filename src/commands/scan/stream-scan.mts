import { logger } from '@socketsecurity/registry/lib/logger'

import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { SetupSdkOptions } from '../../utils/sdk.mts'

export type StreamScanOptions = {
  file?: string | undefined
  sdkOpts?: SetupSdkOptions | undefined
}

export async function streamScan(
  orgSlug: string,
  scanId: string,
  options?: StreamScanOptions | undefined,
) {
  const { file, sdkOpts } = {
    __proto__: null,
    ...options,
  } as StreamScanOptions
  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  logger.info('Requesting data from API...')

  // Note: this will write to stdout or target file. It's not a noop
  return await handleApiCall(
    sockSdk.getOrgFullScan(orgSlug, scanId, file === '-' ? undefined : file),
    { desc: 'a scan' },
  )
}
