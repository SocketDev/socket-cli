import { logger } from '@socketsecurity/registry/lib/logger'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputDeleteScan(
  _data: SocketSdkReturnType<'deleteOrgFullScan'>['data']
): Promise<void> {
  logger.success('Scan deleted successfully')
}
