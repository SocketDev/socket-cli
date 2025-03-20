import { logger } from '@socketsecurity/registry/lib/logger'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'
export async function handleDeleteRepo(
  _data: SocketSdkReturnType<'deleteOrgRepo'>['data']
): Promise<void> {
  logger.success('Repository deleted successfully')
}
