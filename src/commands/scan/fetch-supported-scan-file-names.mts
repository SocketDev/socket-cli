/** @fileoverview Supported scan files API fetcher for Socket CLI. Retrieves list of supported package manifest filenames and ecosystems from Socket API. Used for scan target detection and validation. */

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchSupportedScanFileNamesOptions = BaseFetchOptions & {
  spinner?: Spinner | undefined
}

export async function fetchSupportedScanFileNames(
  options?: FetchSupportedScanFileNamesOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getReportSupportedFiles'>['data']>> {
  // Note: withSdk doesn't support spinner option yet, so we ignore it here
  // The spinner handling would need to be done in handleApiCall
  return await withSdk(
    sdk => sdk.getSupportedScanFiles(),
    'supported scan file types',
    options,
  )
}
